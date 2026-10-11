import { ChevronRight, Database } from 'lucide-react'
import { Link } from 'react-router'
import { CopyButton } from '@/components/CopyButton'
import { Badge } from '@/components/ui/badge'
import type { Api, DataImport } from '@/lib/api-types'
import { formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format'
import { FeedTypeIcon } from './FeedTypeIcon'
import { feedTypeInfo } from '@/lib/feed-types'
import { ImportBadge } from './ImportStatus'
import { importPercent, isImportActive } from '@/lib/imports'
import { Progress } from '@/components/ui/progress'

// One API on the brand page. The whole card opens the API ("stretched link": the title's
// link covers the card), while the copy button stays clickable on top of it.
export function ApiCard({
  api,
  brandSlug,
  latestImport,
}: {
  api: Api
  brandSlug: string
  latestImport: DataImport | null // of the API's data source, to show progress / failure
}) {
  const importing = isImportActive(latestImport)
  const percent = latestImport ? importPercent(latestImport) : null

  return (
    <article className="group relative flex h-full flex-col gap-4 rounded-2xl border bg-background p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring">
      <div className="flex items-start gap-3">
        <FeedTypeIcon feedType={api.feedType} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">
            <Link
              to={`/brands/${brandSlug}/apis/${api.slug}`}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {api.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{feedTypeInfo(api.feedType).label} feed</p>
        </div>
        <Badge variant="outline" className="text-muted-foreground capitalize">
          {api.status}
        </Badge>
      </div>

      <div className="relative z-10 flex items-center gap-1 rounded-xl border bg-muted/50 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={api.path}>
          {api.path}
        </code>
        <CopyButton value={api.path} label={`Copy the path of ${api.name}`} />
      </div>

      <div className="mt-auto flex flex-col gap-2">
        {importing && (
          <Progress value={percent ?? 0} className={percent === null ? 'animate-pulse' : undefined} aria-label={`Import progress of ${api.name}`} />
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <Database className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={api.dataSource.name}>
              {api.dataSource.name}
            </span>
            {api.dataSource.hasData && !importing && (
              <span className="shrink-0">· {formatNumber(api.dataSource.rowCount)} rows</span>
            )}
          </span>
          {latestImport && (importing || latestImport.status === 'failed') ? (
            <ImportBadge dataImport={latestImport} />
          ) : (
            <span className="flex shrink-0 items-center gap-1" title={formatDateTime(api.updatedAt)}>
              {formatRelativeTime(api.updatedAt)}
              <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
