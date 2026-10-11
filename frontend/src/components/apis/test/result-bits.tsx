import { cn } from '@/lib/utils'

// Small pieces shared by "Call it" and the self-check.

// HTTP status as a coloured pill: 2xx green, anything else red.
export function StatusPill({ status }: { status: number }) {
  const ok = status >= 200 && status < 300
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 font-mono text-xs font-medium',
        ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive',
      )}
    >
      HTTP {status}
    </span>
  )
}

// Pretty JSON in a scrollable box (long answers scroll inside it; the page doesn't grow wider).
export function JsonBlock({ value, label, className }: { value: unknown; label: string; className?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className={cn(
        'max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      {text}
    </pre>
  )
}
