import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Link } from 'react-router'
import { ImportStatusCard } from '@/components/apis/ImportStatus'
import { CopyButton } from '@/components/CopyButton'
import type { DataSource } from '@/lib/api-types'
import { formatNumber } from '@/lib/format'
import { isImportActive } from '@/lib/imports'
import { cn } from '@/lib/utils'
import { useApiPage } from './context'

// "/brands/:slug/apis/:apiSlug" (index tab): import status, what's next, and the API's details.
export function OverviewTab() {
  const { api, dataSource } = useApiPage()
  const latest = dataSource.latestImport
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        {latest && <ImportStatusCard dataImport={latest} hasOlderVersion={dataSource.hasData} />}
        <NextSteps dataSource={dataSource} designed={api.designVersion > 0} published={api.status === 'published'} />
      </div>

      <dl className="grid min-w-0 grid-cols-1 content-start gap-4 rounded-2xl border bg-background p-5 text-sm">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Data</dt>
          <dd className="mt-1 truncate font-medium" title={dataSource.name}>
            {dataSource.name}
          </dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">
            {dataSource.hasData
              ? `${formatNumber(dataSource.rowCount)} rows · ${dataSource.columns.length} columns`
              : isImportActive(latest)
                ? 'Importing…'
                : 'No data yet'}
            {dataSource.usedBy.length > 1 && ` · shared by ${dataSource.usedBy.length} APIs`}
          </dd>
          <dd className="mt-2">
            <Link to="data" className="text-xs font-medium text-primary hover:underline">
              Open the Data tab
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Id column</dt>
          <dd className="mt-1 font-mono text-xs">{dataSource.idColumn}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Columns</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {dataSource.columns.slice(0, 12).map((column) => (
              <span key={column} className="max-w-40 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]" title={column}>
                {column}
              </span>
            ))}
            {dataSource.columns.length > 12 && (
              <span className="px-1 text-xs text-muted-foreground">+{dataSource.columns.length - 12} more</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">API ID</dt>
          <dd className="mt-1 flex items-center gap-1">
            <span className="min-w-0 truncate font-mono text-xs">{api.id}</span>
            <CopyButton value={api.id} label="Copy API ID" />
          </dd>
        </div>
      </dl>
    </div>
  )
}

// What's done and what comes next for this API (the later phases).
function NextSteps({ dataSource, designed, published }: { dataSource: DataSource; designed: boolean; published: boolean }) {
  const importing = isImportActive(dataSource.latestImport)
  const steps = [
    {
      title: dataSource.hasData || importing ? 'Data uploaded' : 'Data not imported',
      text: dataSource.hasData
        ? `${formatNumber(dataSource.rowCount)} rows are ready.`
        : importing
          ? 'The import is running.'
          : 'The import failed (see above). Upload a corrected file in the Data tab.',
      state: dataSource.hasData ? 'done' : importing ? 'running' : 'failed',
    },
    designed
      ? { title: 'Response designed', text: 'Change it any time in the Design tab.', state: 'done' }
      : { title: 'Design the response', text: 'Pick the fields Jivox receives, their names and types (Design tab).', state: 'todo' },
    published
      ? { title: 'Published', text: 'Jivox can call it with one of its tokens. Test it any time in the Test tab.', state: 'done' }
      : { title: 'Tokens and testing', text: 'Create a token, try the API and run the self-check (Test tab), then publish.', state: 'todo' },
    { title: 'Contract and Jivox', text: 'Generate the contract/1 document and activate it on Jivox.', state: 'todo' },
  ] as const

  return (
    <section aria-labelledby="next-heading" className="rounded-2xl border bg-background p-5">
      <h2 id="next-heading" className="font-semibold">
        Getting this API live
      </h2>
      <ol className="mt-4 space-y-4">
        {steps.map((step) => (
          <li key={step.title} className="flex gap-3">
            {step.state === 'done' ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
            ) : step.state === 'failed' ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-label="Failed" />
            ) : step.state === 'running' ? (
              <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-primary" aria-label="In progress" />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/40" aria-label="Not done yet" />
            )}
            <div>
              <p className={cn('text-sm font-medium', step.state === 'todo' && 'text-muted-foreground')}>{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
