import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, switchesApi } from './api'
import type { ActiveSwitch, SwitchesState } from './api-types'
import { clockOffset, nextEnd, running, SWITCHES_POLL_MS } from './switches'
import { usePolling } from './use-polling'

export type SwitchesHandle = {
  state: SwitchesState | null
  error: ApiError | null
  on: ActiveSwitch[] // still running at `now` (an ended one disappears at once, before the server says so)
  now: number // the server's time, ticking (for "ends in …")
  refresh: () => Promise<void>
  apply: (next: SwitchesState) => void // the answer of a change (PUT / DELETE): shown at once
}

// The API's test switches for the whole API page (task 7.6): the banner on every tab, the Test tab's
// card and the agent panels read the same state. Looked at every 30 s and when the browser tab
// comes back, and right when the first switch ends. Answers are numbered: an older one (a slow
// poll) never replaces a newer one (the change you just made).
export function useSwitches(brandSlug: string, apiSlug: string): SwitchesHandle {
  const key = `${brandSlug}/${apiSlug}`
  // Each answer is kept with the API it belongs to: another API's never shows here, not even briefly.
  const [stored, setStored] = useState<{ key: string; data: SwitchesState } | null>(null)
  const state = stored?.key === key ? stored.data : null
  const [error, setError] = useState<ApiError | null>(null)
  const [offset, setOffset] = useState(0)
  const [tick, setTick] = useState(() => Date.now())
  const asked = useRef(0)
  const shown = useRef(0)

  const take = useCallback((n: number, next: SwitchesState, forKey: string) => {
    if (n < shown.current) return
    shown.current = n
    setStored({ key: forKey, data: next })
    setError(null)
    setOffset(clockOffset(next.now))
    setTick(Date.now())
  }, [])

  const refresh = useCallback(async () => {
    const n = ++asked.current
    try {
      take(n, await switchesApi.list(brandSlug, apiSlug), key)
    } catch (err) {
      if (n >= shown.current) setError(err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong'))
    }
  }, [brandSlug, apiSlug, key, take])

  const apply = useCallback((next: SwitchesState) => take(++asked.current, next, key), [take, key])

  useEffect(() => {
    void refresh()
  }, [refresh])
  usePolling(true, SWITCHES_POLL_MS, refresh)

  // The clock for "ends in 42 min" (every 15 s is enough for minutes).
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  // Look again right after the first switch ends (the server then writes its "ended" line).
  const end = state ? nextEnd(state.switches) : null
  useEffect(() => {
    if (end === null) return
    const wait = Math.max(0, end - (Date.now() + offset)) + 500
    const timer = setTimeout(() => void refresh(), Math.min(wait, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [end, offset, refresh])

  const now = tick + offset
  return { state, error, on: state ? running(state.switches, now) : [], now, refresh, apply }
}
