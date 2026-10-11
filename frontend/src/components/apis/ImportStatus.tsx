import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import type { DataImport } from '@/lib/api-types'
import { importPercent, isImportActive, isImportFinishing } from '@/lib/imports'
import { formatDuration, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const SERVER_SIDE_FAILURES = new Set(['INTERRUPTED', 'INTERNAL_ERROR'])

// "12 added · 1,228 updated · 3 removed"
function importCounts(dataImport: DataImport) {
  const parts = [
    dataImport.inserted && `${formatNumber(dataImport.inserted)} added`,
    dataImport.updated && `${formatNumber(dataImport.updated)} updated`,
    dataImport.unchanged && `${formatNumber(dataImport.unchanged)} unchanged`,
    dataImport.deleted && `${formatNumber(dataImport.deleted)} removed`,
  ].filter(Boolean)
  return parts.join(' · ')
}

// The big card on the API page: progress while running, then the result.
// aria-live: screen readers hear "Imported 500,000 rows" when it finishes.
// hasOlderVersion: the data source still has a live version (a failed NEW version changes nothing).
export function ImportStatusCard({ dataImport, hasOlderVersion = false }: { dataImport: DataImport; hasOlderVersion?: boolean }) {
  const fileName = dataImport.fileName ?? 'your data'
  const percent = importPercent(dataImport)

  if (isImportActive(dataImport)) {
    return (
      <div className="rounded-2xl border bg-background p-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
            {dataImport.status === 'queued'
              ? `Waiting to import ${fileName}`
              : isImportFinishing(dataImport)
                ? `Finishing up ${fileName}…`
                : `Importing ${fileName}`}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatNumber(dataImport.processedRows)}
            {dataImport.estimatedRows ? ` / about ${formatNumber(dataImport.estimatedRows)}` : ''} rows
            {percent !== null && ` · ${percent}%`}
          </p>
        </div>
        <Progress
          value={percent ?? 0}
          className={cn('mt-4 h-2', percent === null && 'animate-pulse')}
          aria-label="Import progress"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          You can leave this page. The import keeps running, and this card updates by itself.
        </p>
      </div>
    )
  }

  if (dataImport.status === 'succeeded') {
    const took =
      dataImport.startedAt && dataImport.finishedAt
        ? new Date(dataImport.finishedAt).getTime() - new Date(dataImport.startedAt).getTime()
        : null
    return (
      <div
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 animate-in fade-in duration-300"
        aria-live="polite"
      >
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Imported {formatNumber(dataImport.processedRows)} {dataImport.processedRows === 1 ? 'row' : 'rows'}
          {took !== null && (took < 1000 ? ' in under a second' : ` in ${formatDuration(took)}`)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {fileName}
          {dataImport.mode !== 'initial' && importCounts(dataImport) && ` · ${importCounts(dataImport)}`}
        </p>
      </div>
    )
  }

  // failed
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 animate-in fade-in duration-300" role="alert">
      <p className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        The import of {fileName} failed.{' '}
        {hasOlderVersion ? 'The current version is still live, unchanged.' : 'Nothing was saved.'}
      </p>
      {dataImport.problems.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {dataImport.problems.map((problem, index) => (
            <li key={index} className="flex gap-2">
              {problem.row !== null && (
                <span className="shrink-0 rounded-md bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive">
                  row {formatNumber(problem.row)}
                </span>
              )}
              <span className="min-w-0 break-words">{problem.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {/* INTERRUPTED / INTERNAL_ERROR: the server's fault, not the file's */}
        {SERVER_SIDE_FAILURES.has(dataImport.errorCode ?? '')
          ? 'Nothing is wrong with the file: upload it again (Data tab → Upload new version).'
          : 'Fix the file and upload it again (Data tab → Upload new version).'}
      </p>
    </div>
  )
}

// Small status line for lists and cards.
export function ImportBadge({ dataImport }: { dataImport: DataImport }) {
  const percent = importPercent(dataImport)
  if (isImportActive(dataImport)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {dataImport.status === 'queued'
          ? 'Waiting'
          : isImportFinishing(dataImport)
            ? 'Finishing…'
            : `Importing${percent !== null ? ` ${percent}%` : '…'}`}
      </span>
    )
  }
  if (dataImport.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3" aria-hidden="true" />
        Import failed
      </span>
    )
  }
  return null
}
