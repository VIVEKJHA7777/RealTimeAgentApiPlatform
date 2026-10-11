import { CalendarDays } from 'lucide-react'
import { useId, useRef } from 'react'
import { dateInputBounds, EXPIRY_PRESETS, expiryHint, expiryToIso, type ExpiryChoice } from '@/lib/tokens'
import { cn } from '@/lib/utils'

// "Expires": Never · 30 days · 90 days · 1 year · Pick a date (P4-12). A radio group of chips;
// arrow keys move between them (one tab stop), like native radios. Below: what the choice means.
export function ExpiryPicker({
  value,
  onChange,
  label = 'Expires',
  error,
}: {
  value: ExpiryChoice
  onChange: (choice: ExpiryChoice) => void
  label?: string
  error?: string
}) {
  const id = useId()
  const dateRef = useRef<HTMLInputElement>(null)
  const bounds = dateInputBounds()
  const options = [...EXPIRY_PRESETS, { label: 'Pick a date', choice: { kind: 'date', date: '' } as ExpiryChoice }]
  const selected = options.findIndex((o) =>
    o.choice.kind === 'days' ? value.kind === 'days' && value.days === o.choice.days : o.choice.kind === value.kind,
  )
  const result = expiryToIso(value)
  const hintId = `${id}-hint`

  // focusDate: a CLICK on "Pick a date" jumps to the date box; arrow keys keep focus on the chips
  // (otherwise the next arrow would change the date instead of moving between choices).
  function choose(index: number, focusDate = false) {
    const option = options[index]
    if (option.choice.kind === 'date') {
      onChange({ kind: 'date', date: value.kind === 'date' ? value.date : '' })
      if (focusDate) requestAnimationFrame(() => dateRef.current?.focus())
    } else onChange(option.choice)
  }

  return (
    <div className="grid gap-2">
      <span id={`${id}-label`} className="text-sm leading-none font-medium select-none">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={hintId}
        className="flex flex-wrap gap-1.5"
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
          if (!step) return
          event.preventDefault()
          const next = (selected + step + options.length) % options.length
          choose(next)
          ;(event.currentTarget.querySelectorAll('[role=radio]')[next] as HTMLElement | undefined)?.focus()
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={index === selected}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => choose(index, true)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              index === selected
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.choice.kind === 'date' && <CalendarDays className="size-3.5" aria-hidden="true" />}
            {option.label}
          </button>
        ))}
      </div>
      {value.kind === 'date' && (
        <input
          ref={dateRef}
          type="date"
          aria-label="Expiry date"
          aria-invalid={'error' in result || undefined}
          min={bounds.min}
          max={bounds.max}
          value={value.date}
          onChange={(event) => onChange({ kind: 'date', date: event.target.value })}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive sm:w-56 dark:bg-input/30 dark:[color-scheme:dark]"
        />
      )}
      <p id={hintId} className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
        {error ??
          ('error' in result
            ? value.kind === 'date' && value.date === ''
              ? 'Pick the last day it should work (it stops at the end of that day, your time).'
              : result.error
            : result.iso === null
              ? 'Works until you revoke it.'
              : `${expiryHint(result.iso)} (your time).`)}
      </p>
    </div>
  )
}
