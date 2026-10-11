import { Database, Upload } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import type { FeedType } from '@/lib/api-types'
import { formatBytes, formatNumber } from '@/lib/format'
import { FeedTypeIcon } from '../FeedTypeIcon'
import { feedTypeInfo } from '@/lib/feed-types'

export type Phase = { kind: 'idle' } | { kind: 'uploading'; loaded: number; total: number } | { kind: 'creating' }

// Step 3: everything at a glance, then the upload's progress while it's being created.
export function ReviewStep({
  brandSlug,
  name,
  slug,
  feedType,
  data,
  phase,
}: {
  brandSlug: string
  name: string
  slug: string
  feedType: FeedType
  data:
    | { kind: 'upload'; fileName: string; fileSize: number; idColumn: string; dataName: string; rows: number | null; exactRows: boolean }
    | { kind: 'existing'; name: string; idColumn: string; rowCount: number; hasData: boolean; importing: boolean }
  phase: Phase
}) {
  const percent = phase.kind === 'uploading' && phase.total > 0 ? Math.round((phase.loaded / phase.total) * 100) : 0
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex items-center gap-4 rounded-xl border p-4">
        <FeedTypeIcon feedType={feedType} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{name.trim()}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            /v1/{brandSlug}/<span className="text-primary">{slug.trim()}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{feedTypeInfo(feedType).label} feed · starts as a draft</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-xl border p-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Data</dt>
          <dd className="mt-1 flex items-center gap-2">
            {data.kind === 'upload' ? <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="truncate font-medium" title={data.kind === 'upload' ? data.dataName.trim() : data.name}>
              {data.kind === 'upload' ? data.dataName.trim() : data.name}
            </span>
          </dd>
          <dd className="mt-0.5 truncate text-xs text-muted-foreground">
            {data.kind === 'upload'
              ? `New upload: ${data.fileName} · ${formatBytes(data.fileSize)}`
              : 'Existing data of this brand'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Rows</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {data.kind === 'upload'
              ? data.rows === null
                ? 'Counted during import'
                : `${data.exactRows ? '' : 'About '}${formatNumber(data.rows)}`
              : data.hasData
                ? formatNumber(data.rowCount)
                : data.importing
                  ? 'Importing…'
                  : 'No data yet'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Id column</dt>
          <dd className="mt-1">
            <span className="inline-block max-w-full truncate rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary" title={data.idColumn}>
              {data.idColumn}
            </span>
          </dd>
        </div>
      </dl>

      {data.kind === 'upload' && (
        <p className="text-xs text-muted-foreground">
          The file is uploaded once, then imported in the background. You'll see the import's progress on the API page.
        </p>
      )}

      {phase.kind !== 'idle' && (
        <div className="rounded-xl border bg-muted/40 p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{phase.kind === 'uploading' ? 'Uploading the file…' : 'Creating the API…'}</span>
            {phase.kind === 'uploading' && (
              <span className="text-muted-foreground tabular-nums">
                {formatBytes(phase.loaded)} / {formatBytes(phase.total)} · {percent}%
              </span>
            )}
          </div>
          <Progress
            value={phase.kind === 'uploading' ? percent : 100}
            className="mt-3 h-2"
            aria-label={phase.kind === 'uploading' ? 'Upload progress' : 'Creating the API'}
          />
          {phase.kind === 'uploading' && (
            <p className="mt-2 text-xs text-muted-foreground">Keep this page open until the upload is done.</p>
          )}
        </div>
      )}
    </div>
  )
}
