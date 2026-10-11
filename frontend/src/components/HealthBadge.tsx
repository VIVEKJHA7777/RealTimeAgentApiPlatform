import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { getHealth } from '@/lib/api'
import { cn } from '@/lib/utils'

type HealthState = 'checking' | 'ok' | 'db-down' | 'offline'

const LABELS: Record<HealthState, string> = {
  checking: 'Checking…',
  ok: 'Backend OK · DB OK',
  'db-down': 'Backend OK · DB down',
  offline: 'Backend offline',
}

const DOT_COLORS: Record<HealthState, string> = {
  checking: 'bg-gray-400',
  ok: 'bg-green-500',
  'db-down': 'bg-red-500',
  offline: 'bg-red-500',
}

const POLL_INTERVAL_MS = 5000

// Shows whether the backend and database are up. Re-checks every 5 seconds.
export function HealthBadge() {
  const [state, setState] = useState<HealthState>('checking')

  useEffect(() => {
    // Set to true when the component unmounts, so we never update a removed component.
    let cancelled = false

    async function check() {
      try {
        const health = await getHealth()
        if (!cancelled) setState(health.db === 'up' ? 'ok' : 'db-down')
      } catch {
        if (!cancelled) setState('offline')
      }
    }

    check()
    const timer = setInterval(check, POLL_INTERVAL_MS)

    // Cleanup: runs when the component is removed from the page.
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <Badge
      variant="outline"
      className="gap-2"
      data-testid="health-badge"
      title={LABELS[state]}
      aria-label={LABELS[state]}
    >
      <span className={cn('size-2 rounded-full', DOT_COLORS[state])} />
      {/* On phones only the coloured dot is shown, to keep the header on one line */}
      <span className="hidden sm:inline">{LABELS[state]}</span>
    </Badge>
  )
}
