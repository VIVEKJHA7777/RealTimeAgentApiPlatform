import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useState } from 'react'
import { useApiPage } from '@/components/apis/api-page/context'
import { ImportStatusCard } from '@/components/apis/ImportStatus'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { dataSourcesApi } from '@/lib/api'
import { formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format'
import { isImportActive, isImportWorthShowing } from '@/lib/imports'
import { ImportHistory } from './ImportHistory'
import { RecordsView } from './RecordsView'
import { UploadVersionDialog } from './UploadVersionDialog'

// "/brands/:slug/apis/:apiSlug/data": the data this API answers from.
//   summary + Download CSV + Upload new version · latest import (while running / just finished /
//   failed) · rows (pages, search, row details) · import history
export function DataTab() {
  const { organization, api, dataSource, refresh } = useApiPage()
  const [uploadOpen, setUploadOpen] = useState(false)
  const brandSlug = organization.slug
  const latest = dataSource.latestImport
  const importing = isImportActive(latest)
  const usedBy = dataSource.usedBy

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="Data summary" className="flex flex-col gap-4 rounded-2xl border bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileSpreadsheet className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold" title={dataSource.name}>
              {dataSource.name}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
              <span>{dataSource.hasData ? `${formatNumber(dataSource.rowCount)} rows` : 'No data yet'}</span>
              <span>{dataSource.columns.length} columns</span>
              <span>
                id <span className="font-mono text-foreground">{dataSource.idColumn}</span>
              </span>
              {dataSource.lastImportAt && (
                <span title={formatDateTime(dataSource.lastImportAt)}>updated {formatRelativeTime(dataSource.lastImportAt)}</span>
              )}
              <span title={usedBy.map((ref) => ref.name).join(', ')}>
                used by {usedBy.length} {usedBy.length === 1 ? 'API' : 'APIs'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {dataSource.hasData ? (
            <Button asChild variant="outline">
              {/* A plain link: the browser streams the file to disk (500 000 rows never pass through JS). */}
              <a href={dataSourcesApi.downloadUrl(brandSlug, dataSource.id)} download>
                <Download />
                Download CSV
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <Download />
              Download CSV
            </Button>
          )}
          {importing ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* a span: disabled buttons don't receive the hover that shows the tooltip */}
                <span tabIndex={0}>
                  <Button disabled>
                    <Upload />
                    Upload new version
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>An import is running. Wait until it finishes.</TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload new version
            </Button>
          )}
        </div>
      </section>

      {latest && isImportWorthShowing(latest, dataSource.lastImportAt) && (
        <ImportStatusCard dataImport={latest} hasOlderVersion={dataSource.hasData} />
      )}

      {dataSource.hasData ? (
        <RecordsView brandSlug={brandSlug} dataSource={dataSource} />
      ) : (
        !importing && (
          <div className="rounded-2xl border border-dashed bg-background px-6 py-10 text-center">
            <p className="font-medium">No data yet</p>
            <p className="mt-1 text-sm text-muted-foreground">The first import didn't finish. Upload a corrected file to fill this data.</p>
            <Button className="mt-4" onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload a file
            </Button>
          </div>
        )
      )}

      <ImportHistory brandSlug={brandSlug} dataSource={dataSource} />

      <UploadVersionDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        brandSlug={brandSlug}
        api={api}
        dataSource={dataSource}
        onStarted={refresh}
      />
    </div>
  )
}
