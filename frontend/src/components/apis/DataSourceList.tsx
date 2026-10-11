import { FileSpreadsheet } from 'lucide-react'
import type { DataSource } from '@/lib/api-types'
import { formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format'
import { DataSourceActions } from './DataSourceActions'
import { ImportBadge } from './ImportStatus'
import { isImportActive } from '@/lib/imports'

// The brand's data sources: shows that data is SHARED between APIs ("used by 2 APIs").
// ⋯ per row: Download CSV · Delete data (when no API uses it). New versions: an API's Data tab.
export function DataSourceList({
  brandSlug,
  dataSources,
  onChanged,
}: {
  brandSlug: string
  dataSources: DataSource[]
  onChanged: () => Promise<void> | void
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-background">
      {dataSources.map((dataSource) => {
        const latest = dataSource.latestImport
        const showBadge = latest && (isImportActive(latest) || (latest.status === 'failed' && !dataSource.hasData))
        const used = dataSource.usedBy.length
        return (
          <li key={dataSource.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm sm:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileSpreadsheet className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{dataSource.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {dataSource.hasData
                    ? `${formatNumber(dataSource.rowCount)} rows · ${dataSource.columns.length} columns · id: ${dataSource.idColumn}`
                    : `No data yet · id: ${dataSource.idColumn}`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 pl-11 text-xs text-muted-foreground sm:pl-0">
              {showBadge ? <ImportBadge dataImport={latest} /> : null}
              <span title={dataSource.usedBy.map((api) => api.name).join(', ') || undefined}>
                {used === 0 ? 'Not used' : `Used by ${used} ${used === 1 ? 'API' : 'APIs'}`}
              </span>
              {dataSource.lastImportAt && (
                <span className="hidden md:inline" title={formatDateTime(dataSource.lastImportAt)}>
                  Updated {formatRelativeTime(dataSource.lastImportAt)}
                </span>
              )}
              <DataSourceActions brandSlug={brandSlug} dataSource={dataSource} onDeleted={onChanged} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
