import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type SearchSelectOption = {
  value: string
  label?: string // shown instead of the value
  hint?: string // small, right side ("id", "empty")
  disabled?: boolean
}

// A single-choice dropdown for LONG lists (file columns: up to 200). Replaces the native
// <select> there: on macOS the native menu grows to the screen height while you scroll and
// widens to its longest option (reported by the user, task 3.7). This list has a fixed width
// (22rem, or the trigger's if wider) and height, and scrolls inside itself; long names wrap;
// a search box appears for long lists.
// Keyboard: ↑ ↓ Home End move, Enter picks, typing filters, Escape closes.
export function SearchSelect({
  options,
  value,
  onChange,
  label,
  placeholder = 'Choose…',
  invalid,
  id,
  className,
  renderValue,
}: {
  options: SearchSelectOption[]
  value: string
  onChange: (value: string) => void
  label: string // accessible name (the visible label may be elsewhere)
  placeholder?: string
  invalid?: boolean
  id?: string
  className?: string // the trigger
  renderValue?: (option: SearchSelectOption) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const searchable = options.length > 8

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return options.filter((o) => words.every((w) => `${o.value} ${o.label ?? ''}`.toLowerCase().includes(w)))
  }, [options, search])
  const selected = options.find((o) => o.value === value)

  function show(index: number) {
    setActive(index)
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function pick(option: SearchSelectOption) {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const last = visible.length - 1
    if (event.key === 'ArrowDown') show(Math.min(last, active + 1))
    else if (event.key === 'ArrowUp') show(Math.max(0, active - 1))
    else if (event.key === 'Home' && !searchable) show(0)
    else if (event.key === 'End' && !searchable) show(last)
    else if (event.key === 'Enter' && visible[active]) pick(visible[active])
    else return
    event.preventDefault()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch('')
        // Open on the chosen option, scrolled into view.
        const index = Math.max(0, options.findIndex((o) => o.value === value))
        setActive(index)
        if (next) requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'center' }))
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`${label}: ${selected ? (selected.label ?? selected.value) : 'none'}`}
          aria-invalid={invalid || undefined}
          title={selected?.label ?? selected?.value}
          className={cn(
            'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected ? (renderValue ? renderValue(selected) : (selected.label ?? selected.value)) : placeholder}
          </span>
          {selected?.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{selected.hint}</span>}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[max(var(--radix-popover-trigger-width),min(22rem,calc(100vw-2rem)))] max-w-[calc(100vw-2rem)] gap-0 p-0"
        onKeyDown={searchable ? undefined : onKeyDown}
      >
        {searchable && (
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search"
              role="combobox"
              aria-label={label}
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={searchable ? -1 : 0}
          aria-activedescendant={!searchable && visible[active] ? `${listId}-${active}` : undefined}
          className="max-h-72 overflow-y-auto overscroll-contain p-1 outline-none"
        >
          {visible.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No match for “{search}”.</p>}
          {visible.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-index={index}
              onMouseMove={() => active !== index && setActive(index)}
              onClick={() => pick(option)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                index === active && 'bg-muted',
                option.disabled && 'cursor-default opacity-50',
              )}
            >
              <Check className={cn('size-3.5 shrink-0', option.value === value ? 'text-primary' : 'invisible')} aria-hidden="true" />
              {/* Long names wrap (the box keeps its width; nothing is cut off). */}
              <span className="min-w-0 flex-1 break-all">{option.label ?? option.value}</span>
              {option.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{option.hint}</span>}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
