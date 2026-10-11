import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react'
import { dataSourcesApi } from '@/lib/api'
import type { DataImport, DataSource } from '@/lib/api-types'
import { formatBytes, formatDateTime, formatDuration, formatNumber, formatRelativeTime } from '@/lib/format'
import { IMPORT_MODE_LABELS, isImportActive } from '@/lib/imports'
import { useRequest } from '@/lib/use-request'

// The last 20 imports of a data source (newest first): what was uploaded when, and the result.
// Reloads by itself when the latest import changes (started, finished).
export function ImportHistory({ brandSlug, dataSource }: { brandSlug: string; dataSource: DataSource }) {
  const latest = dataSource.latestImport
  const history = useRequest(
    `imports:${dataSource.id}:${latest?.id ?? ''}:${latest?.status ?? ''}`,
    () => dataSourcesApi.imports(brandSlug, dataSource.id).then((res) => res.imports),
    { keepPreviousData: true },
  )

  return (
    <section aria-labelledby="history-heading" className="rounded-2xl border bg-background">
      <h2 id="history-heading" className="border-b px-5 py-3 font-semibold">
        Import history
      </h2>
      {history.error && !history.data ? (
        <p className="px-5 py-4 text-sm text-destructive">{history.error.message}</p>
      ) : !history.data ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y">
          {history.data.map((item) => (
            <HistoryItem key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}

function HistoryItem({ item }: { item: DataImport }) {
  const when = item.finishedAt ?? item.startedAt ?? item.createdAt
  const took =
    item.startedAt && item.finishedAt ? new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime() : null
  const summary =
    item.status === 'succeeded'
      ? item.mode === 'initial'
        ? `${formatNumber(item.inserted)} rows`
        : [
            `${formatNumber(item.inserted)} added`,
            `${formatNumber(item.updated)} updated`,
            `${formatNumber(item.unchanged)} unchanged`,
            ...(item.mode === 'replace' ? [`${formatNumber(item.deleted)} removed`] : []),
          ].join(' · ')
      : item.status === 'failed'
        ? item.problems[0]?.message ?? 'Failed'
        : `${formatNumber(item.processedRows)} rows so far`

  const head = (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      {item.status === 'succeeded' ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Succeeded" />
      ) : item.status === 'failed' ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
      ) : (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-label="Running" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{IMPORT_MODE_LABELS[item.mode]}</span>
          <span className="truncate text-muted-foreground" title={item.fileName ?? undefined}>
            {item.fileName}
            {item.fileSize !== null && ` · ${formatBytes(item.fileSize)}`}
          </span>
        </p>
        <p className={item.status === 'failed' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{summary}</p>
      </div>
      <span className="shrink-0 text-right text-xs text-muted-foreground" title={formatDateTime(when)}>
        {formatRelativeTime(when)}
        {took !== null && item.status === 'succeeded' && <span className="block">{took < 1000 ? 'under 1 s' : formatDuration(took)}</span>}
      </span>
    </div>
  )

  // Failed imports can be opened to see every problem (up to 5, with row numbers).
  if (item.status === 'failed' && item.problems.length > 1 && !isImportActive(item)) {
    return (
      <li>
        <details className="group px-5 py-3">
          <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
            {head}
          </summary>
          <ul className="mt-2 space-y-1 pl-12 text-xs">
            {item.problems.map((problem, index) => (
              <li key={index} className="text-muted-foreground">
                {problem.row !== null && <span className="font-mono text-destructive">row {formatNumber(problem.row)}: </span>}
                {problem.message}
              </li>
            ))}
          </ul>
        </details>
      </li>
    )
  }
  return <li className="flex px-5 py-3 pl-11">{head}</li>
}
