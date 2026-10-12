import { useCallback, useState } from 'react'

// An open / closed section whose choice is remembered in this browser (localStorage, per viewer).
// Until the person chooses, `auto` decides (e.g. "open when something needs attention").
// Storage can be missing or blocked (private window, previews): then it simply isn't remembered.
export function useRememberedOpen(key: string, auto: boolean): [boolean, (open: boolean) => void] {
  const [chosen, setChosen] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? null : v === '1'
    } catch {
      return null
    }
  })
  const set = useCallback(
    (open: boolean) => {
      setChosen(open)
      try {
        localStorage.setItem(key, open ? '1' : '0')
      } catch {
        // not remembered: fine
      }
    },
    [key],
  )
  return [chosen ?? auto, set]
}
