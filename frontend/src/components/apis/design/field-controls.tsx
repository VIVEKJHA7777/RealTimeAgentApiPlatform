import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { SearchSelect, type SearchSelectOption } from '@/components/SearchSelect'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ColumnInfo, FieldType, JivoxField, Tier } from '@/lib/api-types'
import { FIELD_TYPES, TYPE_LABELS, fieldControlClass, fitPercent, matchColumn } from '@/lib/design'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const TIER_STYLE: Record<Tier, string> = {
  mandatory: 'bg-destructive/10 text-destructive',
  expected: 'bg-primary/10 text-primary',
  optional: 'bg-muted text-muted-foreground',
}

export function TierBadge({ tier, className }: { tier: Tier | 'id'; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium',
        tier === 'id' ? 'bg-primary/10 text-primary' : TIER_STYLE[tier],
        className,
      )}
    >
      {tier}
    </span>
  )
}

const triggerClass = fieldControlClass

const TIER_ORDER: Tier[] = ['mandatory', 'expected', 'optional']

// ───────────── Jivox field: searchable list of the feed type's columns ─────────────
export function JivoxFieldPicker({
  fields,
  used,
  columns,
  onPick,
  children,
  align = 'start',
  label = 'Choose a Jivox field',
}: {
  fields: JivoxField[] // without the id column
  used: Set<string> // already in the design (shown, not pickable)
  columns: string[] // our columns: "match: priceUSD" hints
  onPick: (field: JivoxField) => void
  children: ReactNode // the trigger (asChild)
  align?: 'start' | 'end'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return fields
      .filter((f) => words.every((w) => `${f.name} ${f.description}`.toLowerCase().includes(w)))
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
  }, [fields, search])
  const pickable = visible.filter((f) => !used.has(f.name))

  function pick(field: JivoxField) {
    onPick(field)
    setOpen(false)
    setSearch('')
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.max(0, Math.min(pickable.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))
      setActive(next)
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' && pickable[active]) {
      event.preventDefault()
      pick(pickable[active])
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setActive(0)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search Jivox fields"
            aria-label={label}
            role="combobox"
            aria-expanded="true"
            aria-controls="jivox-field-list"
            aria-activedescendant={pickable[active] ? `jivox-${pickable[active].name}` : undefined}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} id="jivox-field-list" role="listbox" aria-label={label} className="max-h-80 overflow-y-auto p-1">
          {visible.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No field matches “{search}”.</p>}
          {visible.map((field, i) => {
            const isUsed = used.has(field.name)
            const index = pickable.indexOf(field)
            const match = isUsed ? null : matchColumn(field.name, columns)
            const header = i === 0 || visible[i - 1].tier !== field.tier
            return (
              <div key={field.name}>
                {header && <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground capitalize">{field.tier}</p>}
                <div
                  id={`jivox-${field.name}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={isUsed}
                  data-index={index}
                  onMouseEnter={() => index >= 0 && setActive(index)}
                  onClick={() => !isUsed && pick(field)}
                  className={cn(
                    'flex cursor-pointer gap-2 rounded-md px-2 py-1.5',
                    index === active && 'bg-muted',
                    isUsed && 'cursor-default opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[13px]">{field.name}</span>
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{field.typeHint}</span>
                      {match && (
                        <span className="rounded bg-emerald-500/10 px-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                          match: {match}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {isUsed ? 'Already in this design' : field.description}
                      {!isUsed && field.example && <span className="text-muted-foreground/80"> · e.g. {field.example}</span>}
                    </p>
                  </div>
                  {isUsed && <Check className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// The trigger for a row's Jivox field (name + tier).
export function JivoxFieldButton({ field, name, invalid, ...props }: { field?: JivoxField; name: string; invalid?: boolean } & React.ComponentProps<'button'>) {
  return (
    <button type="button" aria-invalid={invalid || undefined} className={triggerClass} title={name} {...props}>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{name || <span className="font-sans text-muted-foreground">Choose…</span>}</span>
      {field && <TierBadge tier={field.tier} />}
      <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

// ───────────── Your column: the data's column NAMES (R3), scrolling inside a fixed box ─────────────
export function ColumnSelect({
  value,
  columns,
  info,
  onChange,
  invalid,
  id,
  label,
}: {
  value: string
  columns: string[]
  info: Map<string, ColumnInfo>
  onChange: (column: string) => void
  invalid?: boolean
  id?: string
  label: string
}) {
  const missing = value !== '' && !columns.includes(value)
  const options: SearchSelectOption[] = [
    // A saved column the data no longer has: shown, so the problem is visible.
    ...(missing ? [{ value, hint: 'not in the data' }] : []),
    ...columns.map((column) => {
      const columnInfo = info.get(column)
      return { value: column, hint: columnInfo?.isId ? 'id' : columnInfo && columnInfo.filled === 0 ? 'empty' : undefined }
    }),
  ]
  return (
    <SearchSelect
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      invalid={invalid || missing}
      placeholder="Choose a column"
      className="font-mono text-[13px]"
    />
  )
}

// ───────────── Type: detected + changeable + "leave out of the contract" (R5) ─────────────
export function TypePicker({
  type,
  typeInContract,
  onMismatch,
  onEmpty,
  info,
  suggested,
  jivoxHint,
  onChange,
  invalid,
  label,
}: {
  type: FieldType
  typeInContract: boolean
  onMismatch: 'send' | 'default'
  onEmpty: 'empty_string' | 'omit'
  info?: ColumnInfo
  suggested: FieldType
  jivoxHint?: FieldType
  onChange: (patch: { type?: FieldType; typeInContract?: boolean; onMismatch?: 'send' | 'default'; onEmpty?: 'empty_string' | 'omit' }) => void
  invalid?: boolean
  label: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${type}${typeInContract ? '' : ', not in contract'}`} aria-invalid={invalid || undefined} className={triggerClass}>
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{type}</span>
          {!typeInContract && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground" title="Left out of the contract">
              not in contract
            </span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="max-h-(--radix-popover-content-available-height) w-72 min-h-0 gap-1 overflow-y-auto overscroll-contain p-1"
      >
        <div role="radiogroup" aria-label={label}>
          {FIELD_TYPES.map((option) => {
            const percent = fitPercent(info, option)
            const selected = option === type
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${option}, ${TYPE_LABELS[option]}${option === suggested ? ', suggested' : ''}${percent !== null ? `, ${percent}% fit` : ''}`}
                onClick={() => {
                  onChange({ type: option })
                  setOpen(false)
                }}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted', selected && 'bg-muted')}
              >
                <Check className={cn('size-4 shrink-0', selected ? 'text-primary' : 'invisible')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[13px]">{option}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{TYPE_LABELS[option]}</span>
                </span>
                {option === suggested ? (
                  <span className="rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                    suggested{percent !== null && percent < 100 ? ` · ${percent}% fit` : ''}
                  </span>
                ) : (
                  percent !== null && <span className={cn('text-[11px]', percent < 95 ? 'text-muted-foreground/70' : 'text-muted-foreground')}>{percent}% fit</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="mx-1 border-t" />
        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
          <input
            type="checkbox"
            aria-label="Leave the type out of the contract"
            className="mt-0.5 size-4 accent-primary"
            checked={!typeInContract}
            onChange={(e) => onChange({ typeInContract: !e.target.checked })}
          />
          <span className="text-sm">
            Leave the type out of the contract
            <span className="block text-xs text-muted-foreground">
              Jivox then uses its own type{jivoxHint ? ` (probably ${jivoxHint})` : ''}. Your API still sends it as {type}.
            </span>
          </span>
        </label>
        <div className="mx-1 border-t" />
        <div role="radiogroup" aria-label={`When a value isn't ${type}`} className="px-2 py-1.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">When a value isn't {type}</p>
          {(
            [
              ['send', 'Send it as written', 'As text. Good for testing; Jivox may reject it.'],
              ['default', 'Treat it as empty', 'The default is sent, else as below.'],
            ] as const
          ).map(([value, title, hint]) => (
            <label key={value} className="flex cursor-pointer items-start gap-2 rounded-md py-1">
              <input
                type="radio"
                name={`mismatch-${label}`}
                className="mt-0.5 size-4 accent-primary"
                checked={onMismatch === value}
                onChange={() => onChange({ onMismatch: value })}
              />
              <span className="text-sm">
                {title}
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mx-1 border-t" />
        <div role="radiogroup" aria-label="When a value is empty (and no default)" className="px-2 py-1.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">When a value is empty (and no default)</p>
          {(
            [
              ['empty_string', 'Send ""', `The key is always there.${type === 'string' ? '' : ` "" isn't ${type}: Jivox may reject it.`}`],
              ['omit', 'Leave the key out', 'Strict: the item has no such key.'],
            ] as const
          ).map(([value, title, hint]) => (
            <label key={value} className="flex cursor-pointer items-start gap-2 rounded-md py-1">
              <input
                type="radio"
                name={`empty-${label}`}
                className="mt-0.5 size-4 accent-primary"
                checked={onEmpty === value}
                onChange={() => onChange({ onEmpty: value })}
              />
              <span className="text-sm">
                <span className={value === 'empty_string' ? 'font-mono' : undefined}>{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {info && (
          <p className="px-2 pb-1 text-[11px] text-muted-foreground">
            Fit measured on {formatNumber(info.filled)} non-empty values of the first rows.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

