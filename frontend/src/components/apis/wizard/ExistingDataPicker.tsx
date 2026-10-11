import { FileSpreadsheet } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { DataSource } from '@/lib/api-types'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ImportBadge } from '../ImportStatus'
import { isImportActive } from '@/lib/imports'

const SHOWN_COLUMNS = 6 // column chips per card; the rest as "+N more" (all names on hover)

// "Use existing data": the brand's data sources as selectable cards.
export function ExistingDataPicker({
  dataSources,
  value,
  onChange,
  error,
}: {
  dataSources: DataSource[]
  value: string | null
  onChange: (id: string) => void
  error?: string
}) {
  return (
    <div>
      {/* grid-cols-1: without it a file with many columns stretches the card past the screen */}
      <RadioGroup value={value ?? ''} onValueChange={onChange} aria-label="Your data" className="grid-cols-1 gap-3">
        {dataSources.map((dataSource) => {
          const selected = dataSource.id === value
          const latest = dataSource.latestImport
          const used = dataSource.usedBy.length
          const hidden = dataSource.columns.length - SHOWN_COLUMNS
          return (
            <label
              key={dataSource.id}
              className={cn(
                'flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ring/20',
                // selected: filled + ring, clearly different from the light hover border
                selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/30 hover:bg-muted/40',
              )}
            >
              <RadioGroupItem value={dataSource.id} className="mt-0.5" />
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileSpreadsheet className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{dataSource.name}</span>
                  {latest && (isImportActive(latest) || latest.status === 'failed') && <ImportBadge dataImport={latest} />}
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{dataSource.hasData ? `${formatNumber(dataSource.rowCount)} rows` : 'No data yet'}</span>
                  <span>
                    id column <span className="font-mono text-foreground">{dataSource.idColumn}</span>
                  </span>
                  <span>{used === 0 ? 'Not used yet' : `Used by ${used} ${used === 1 ? 'API' : 'APIs'}`}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1" title={dataSource.columns.join(', ')}>
                  {dataSource.columns.slice(0, SHOWN_COLUMNS).map((column) => (
                    <span key={column} className="max-w-40 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {column}
                    </span>
                  ))}
                  {hidden > 0 && (
                    <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                      +{hidden} more {hidden === 1 ? 'column' : 'columns'}
                    </span>
                  )}
                </div>
              </div>
            </label>
          )
        })}
      </RadioGroup>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
