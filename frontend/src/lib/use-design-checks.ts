import { useEffect, useRef, useState } from 'react'
import { ApiError, designApi } from './api'
import type { DesignInput, DesignPreview, ErrorDetail, FieldType, ValueCheck } from './api-types'

// The value, once it has stopped changing for `ms` (typing doesn't fire a request per key).
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export type PreviewState =
  | { status: 'ok'; preview: DesignPreview }
  | { status: 'invalid'; problems: ErrorDetail[] } // the draft breaks a rule (same checks as a save)
  | { status: 'no-data'; message: string }
  | { status: 'error'; message: string; problems?: ErrorDetail[] }

// Live preview of the design being edited (nothing saved): ~0.6 s after the last change.
// Only the answer to the LATEST draft is kept (a slow older answer can't overwrite it).
// `loading` = the shown result belongs to an older draft.
// `context` = anything else the answer depends on (feed type, which data and its version):
// when it changes, the preview re-runs too.
// `enabled` = false until the saved design is loaded (checking an empty placeholder draft would
// flash "key required" problems on the screen).
export function useDesignPreview(
  brandSlug: string,
  apiSlug: string,
  design: DesignInput,
  ids: string[],
  context: string,
  enabled: boolean,
) {
  // `enabled` is part of the key: the debounced key lags ~0.6 s behind, so checking `enabled`
  // alone would still send the placeholder draft once loading finishes.
  const key = JSON.stringify({ design, ids, context, enabled })
  const debouncedKey = useDebouncedValue(key, 600)
  const [result, setResult] = useState<{ key: string; state: PreviewState } | null>(null)
  const latest = useRef(0)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const input = JSON.parse(debouncedKey) as { design: DesignInput; ids: string[]; enabled: boolean }
    if (!input.enabled) return
    const request = ++latest.current
    designApi
      .preview(brandSlug, apiSlug, { design: input.design, ids: input.ids.length > 0 ? input.ids : undefined })
      .then((preview): PreviewState => ({ status: 'ok', preview }))
      .catch((err: unknown): PreviewState => {
        const error = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong')
        if (error.code === 'DESIGN_INVALID') return { status: 'invalid', problems: error.details }
        if (error.code === 'NO_DATA') return { status: 'no-data', message: error.message }
        return { status: 'error', message: error.message, problems: error.details }
      })
      .then((state) => {
        if (request === latest.current) setResult({ key: debouncedKey, state })
      })
  }, [brandSlug, apiSlug, debouncedKey, retry])

  return {
    state: result?.state ?? null,
    loading: result?.key !== key,
    reload: () => setRetry((n) => n + 1),
  }
}

const pairKey = (column: string, type: FieldType) => `${column}\u0000${type}`

// "How many rows can't be sent as this type?" per (column, type), counted over EVERY row.
// Answers are cached per version of the data (`dataKey`): changing a type and back costs nothing.
export function useValueChecks(
  brandSlug: string,
  apiSlug: string,
  pairs: { sourceColumn: string; type: FieldType }[],
  dataKey: string,
) {
  const [cache, setCache] = useState<Map<string, ValueCheck & { rows: number }>>(new Map())
  const wanted = [...new Set(pairs.map((p) => pairKey(p.sourceColumn, p.type)))].sort().join('\u0001')
  const debouncedWanted = useDebouncedValue(wanted, 400)
  const cacheRef = useRef(cache)
  useEffect(() => {
    cacheRef.current = cache
  })

  useEffect(() => {
    const missing = debouncedWanted
      .split('\u0001')
      .filter((k) => k !== '' && !cacheRef.current.has(`${dataKey}\u0002${k}`))
    if (missing.length === 0) return
    const fields = missing.map((k) => {
      const [sourceColumn, type] = k.split('\u0000')
      return { sourceColumn, type: type as FieldType }
    })
    let cancelled = false
    designApi
      .checkValues(brandSlug, apiSlug, fields)
      .then(({ rows, fields: checks }) => {
        if (cancelled) return
        setCache((previous) => {
          const next = new Map(previous)
          for (const check of checks) next.set(`${dataKey}\u0002${pairKey(check.sourceColumn, check.type)}`, { ...check, rows })
          return next
        })
      })
      // Unknown column (data changed), busy (429), offline: no counts shown; the next change retries.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [brandSlug, apiSlug, debouncedWanted, dataKey])

  return (column: string, type: FieldType) => cache.get(`${dataKey}\u0002${pairKey(column, type)}`) ?? null
}
