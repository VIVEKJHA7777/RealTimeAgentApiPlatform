import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { SearchSelect } from '@/components/SearchSelect'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const MAX_CHIPS = 4

// "Which column identifies a row?" The server suggests columns that were unique and always
// filled in the rows it scanned; any other column can still be chosen from the list.
export function IdColumnPicker({
  columns,
  candidates,
  rowsScanned,
  value,
  onChange,
  error,
}: {
  columns: string[]
  candidates: string[]
  rowsScanned: number
  value: string | null
  onChange: (column: string) => void
  error?: string
}) {
  const chips = candidates.slice(0, MAX_CHIPS)
  const others = columns.filter((column) => !chips.includes(column))
  const isCandidate = value !== null && candidates.includes(value)

  // min-w-0: a <fieldset> is min-content wide by default, so long column names would widen the page.
  return (
    <fieldset aria-describedby="id-column-help" className="min-w-0">
      <legend className="text-sm font-medium">Which column identifies a row?</legend>
      <p id="id-column-help" className="mt-1 text-xs text-muted-foreground">
        Jivox asks for rows by this value (for example a SKU). It must be filled in and different in every row.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Suggested id columns">
        {chips.map((column, index) => {
          const selected = value === column
          return (
            <button
              key={column}
              type="button"
              role="radio"
              aria-checked={selected}
              title={column}
              onClick={() => onChange(column)}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                selected ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:border-primary/40 hover:bg-muted',
              )}
            >
              {selected && <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 truncate font-mono text-xs">{column}</span>
              {index === 0 && (
                <span className="rounded-full bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  recommended
                </span>
              )}
            </button>
          )
        })}

        {others.length > 0 && (
          // Not a native <select>: on macOS its menu grows to the screen height while scrolling a
          // long list (files can have 200 columns). SearchSelect scrolls inside a fixed box.
          <div className="w-56 max-w-full">
            <SearchSelect
              label="Choose another column as the id"
              options={others.map((column) => ({ value: column }))}
              value={value !== null && others.includes(value) ? value : ''}
              onChange={onChange}
              placeholder={chips.length ? 'Other column' : 'Choose a column'}
              className={cn(
                'rounded-full pl-3',
                value !== null && others.includes(value) ? 'border-primary font-mono text-xs text-primary' : 'text-muted-foreground',
              )}
            />
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : value === null ? null : isCandidate ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Unique and filled in the first {formatNumber(rowsScanned)} rows. The whole file is checked during the import.
        </p>
      ) : (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          "{value}" is empty or repeats within the first {formatNumber(rowsScanned)} rows, so it can't identify rows.
        </p>
      )}
      {chips.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          No column was unique and filled in every scanned row. Check the file, or choose a column anyway.
        </p>
      )}
    </fieldset>
  )
}
