import { useEffect, useRef } from 'react'

// Calls `tick` every `intervalMs` while `active` is true, e.g. to follow an import's progress.
// - Pauses while the browser tab is hidden (no requests nobody looks at) and ticks once at
//   once when the tab is shown again.
// - Waits for one tick to finish before scheduling the next, so slow answers never pile up.
export function usePolling(active: boolean, intervalMs: number, tick: () => Promise<unknown> | void) {
  const tickRef = useRef(tick)
  useEffect(() => {
    tickRef.current = tick
  })

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const schedule = () => {
      if (stopped || document.visibilityState === 'hidden') return
      timer = setTimeout(run, intervalMs)
    }
    const run = async () => {
      try {
        await tickRef.current()
      } catch {
        // a failed tick is retried at the next interval
      }
      schedule()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        void run()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, intervalMs])
}
