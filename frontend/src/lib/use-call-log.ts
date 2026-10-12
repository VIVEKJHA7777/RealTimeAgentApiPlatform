import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, logsApi } from './api'
import type { LogEntry, LogToken } from './api-types'
import { apiFilters, LOGS_PAGE, LOGS_POLL_MS, type FilterState } from './logs'
import { usePolling } from './use-polling'

const MAX_SHOWN = 500 // the log keeps 500 per API: never more lines than that in the list

type State = {
  entries: LogEntry[]
  next: string | null // older page cursor
  matching: number
  total: number
  kept: number
  tokens: Record<string, LogToken>
  loading: boolean // the first page (filters changed / reload)
  error: ApiError | null
  loadingOlder: boolean
}
const EMPTY: State = { entries: [], next: null, matching: 0, total: 0, kept: 500, tokens: {}, loading: true, error: null, loadingOlder: false }

// The Logs tab's list (task 7.5): the first page for the filters, then every 3 s "anything newer
// than what I have?" (new lines slide in at the top, highlighted for a few seconds), "Load older"
// at the bottom. Answers for old filters are ignored (`generation`). While `paused`, nothing moves.
export function useCallLog(brandSlug: string, apiSlug: string, filters: FilterState, paused: boolean) {
  const [state, setState] = useState<State>(EMPTY)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const generation = useRef(0)
  const cursor = useRef<string | null>(null) // the log's newest id when we last asked
  const filtersRef = useRef(filters)
  const entriesRef = useRef<LogEntry[]>([])
  useEffect(() => {
    filtersRef.current = filters
    entriesRef.current = state.entries
  })
  const key = `${brandSlug}/${apiSlug}/${JSON.stringify(filters)}`

  const load = useCallback(async () => {
    const g = ++generation.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const page = await logsApi.list(brandSlug, apiSlug, { ...apiFilters(filtersRef.current), limit: LOGS_PAGE })
      if (g !== generation.current) return
      cursor.current = page.newestId
      setFresh(new Set())
      setState({ entries: page.entries, next: page.next, matching: page.matching, total: page.total, kept: page.kept, tokens: page.tokens, loading: false, error: null, loadingOlder: false })
    } catch (err) {
      if (g !== generation.current) return
      setState((s) => ({ ...s, loading: false, error: err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong') }))
    }
  }, [brandSlug, apiSlug])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the filters
  useEffect(() => void load(), [key, load])

  const poll = useCallback(async () => {
    const g = generation.current
    const since = cursor.current
    const page = await logsApi.list(brandSlug, apiSlug, { ...apiFilters(filtersRef.current), limit: LOGS_PAGE, ...(since && { after: since }) })
    if (g !== generation.current) return
    // The log got smaller than what we've seen (Clear, here or in another tab), or more arrived
    // than one page: start over.
    const shrank = since !== null && (page.newestId === null || BigInt(page.newestId) < BigInt(since))
    if (page.gap || shrank || (since === null && page.entries.length > 0)) {
      if (since === null && !page.gap) {
        cursor.current = page.newestId
        setFresh(new Set(page.entries.map((e) => e.id)))
        setState((s) => ({ ...s, entries: page.entries, next: page.next, matching: page.matching, total: page.total, tokens: { ...s.tokens, ...page.tokens } }))
        return
      }
      return load()
    }
    cursor.current = page.newestId
    const known = new Set(entriesRef.current.map((e) => e.id))
    const added = page.entries.filter((e) => !known.has(e.id))
    if (added.length > 0) setFresh(new Set(added.map((e) => e.id)))
    setState((s) => {
      const have = new Set(s.entries.map((e) => e.id))
      return { ...s, entries: [...added.filter((e) => !have.has(e.id)), ...s.entries].slice(0, MAX_SHOWN), matching: page.matching, total: page.total, tokens: { ...s.tokens, ...page.tokens } }
    })
  }, [brandSlug, apiSlug, load])

  usePolling(!paused && !state.loading && state.error === null, LOGS_POLL_MS, poll)

  // The highlight fades by its own timer (the next poll must not cut it short).
  useEffect(() => {
    if (fresh.size === 0) return
    const timer = setTimeout(() => setFresh(new Set()), 4000)
    return () => clearTimeout(timer)
  }, [fresh])

  const loadOlder = useCallback(async () => {
    const g = generation.current
    const before = state.next
    if (!before) return
    setState((s) => ({ ...s, loadingOlder: true }))
    try {
      const page = await logsApi.list(brandSlug, apiSlug, { ...apiFilters(filtersRef.current), limit: LOGS_PAGE, before })
      if (g !== generation.current) return
      setState((s) => {
        const known = new Set(s.entries.map((e) => e.id))
        return { ...s, entries: [...s.entries, ...page.entries.filter((e) => !known.has(e.id))].slice(0, MAX_SHOWN), next: page.next, tokens: { ...s.tokens, ...page.tokens }, loadingOlder: false }
      })
    } catch (err) {
      if (g === generation.current) setState((s) => ({ ...s, loadingOlder: false }))
      throw err
    }
  }, [brandSlug, apiSlug, state.next])

  return { ...state, fresh, reload: load, loadOlder, pollNow: poll }
}
