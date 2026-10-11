import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

// What we last received, and FOR WHICH key.
type RequestState<T> = { key: string; data?: T; error?: ApiError; loading: boolean }

// Loads data for a page: const { data, error, loading, reload } = useRequest(key, fetcher)
//
// - `key` identifies WHAT is loaded (e.g. "organization:acme-shoes-k3x9q2"). When it changes,
//   the hook reports `loading` until the answer for the NEW key arrives (old data is never
//   shown under a new key).
// - Out-of-date answers are ignored: if you open brand A then quickly brand B, A's slower
//   answer can't overwrite B's page. (Each request gets a number; only the latest counts.)
// - refetchOnFocus: reload quietly when the user comes back to this tab (e.g. after creating
//   a brand in another tab). A quiet reload keeps the current data if it fails.
// - keepPreviousData: while a NEW key loads, keep returning the previous key's data (with
//   loading: true). For pages of a table: the old page stays visible instead of a flash.
export function useRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
  { refetchOnFocus = false, keepPreviousData = false }: { refetchOnFocus?: boolean; keepPreviousData?: boolean } = {},
) {
  const [state, setState] = useState<RequestState<T>>({ key, loading: true })
  const latestRequest = useRef(0)
  const fetcherRef = useRef(fetcher)
  const keyRef = useRef(key)
  useEffect(() => {
    fetcherRef.current = fetcher
    keyRef.current = key
  })

  const run = useCallback(async (forKey: string, quiet: boolean) => {
    const requestNumber = ++latestRequest.current
    try {
      const data = await fetcherRef.current()
      if (requestNumber === latestRequest.current) setState({ key: forKey, data, loading: false })
    } catch (err) {
      if (requestNumber !== latestRequest.current) return // a newer request is in charge
      const error = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong')
      setState((previous) =>
        quiet && previous.key === forKey && previous.data !== undefined
          ? previous // a failed quiet reload keeps showing the data we already have
          : { key: forKey, error, loading: false },
      )
    }
  }, [])

  // Load whenever the key changes.
  useEffect(() => {
    void run(key, false)
  }, [key, run])

  // Optional quiet reload when the tab becomes visible again.
  useEffect(() => {
    if (!refetchOnFocus) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run(keyRef.current, true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refetchOnFocus, run])

  // "Try again" button: show the loading state, then load.
  const reload = useCallback(() => {
    setState({ key, loading: true })
    void run(key, false)
  }, [key, run])

  // Quiet reload (no loading state; keeps the current data if it fails), e.g. while polling.
  const refresh = useCallback(() => run(key, true), [key, run])

  // Stored state belongs to an older key? Then we're still loading the current one.
  const current =
    state.key === key
      ? state
      : { loading: true, data: keepPreviousData ? state.data : undefined, error: undefined }
  return { data: current.data, error: current.error, loading: current.loading, reload, refresh }
}
