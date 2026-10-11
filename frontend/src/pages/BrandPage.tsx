import { ChevronRight, Database, Link2, Plus, SearchX, Upload, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ApiCard } from '@/components/apis/ApiCard'
import { DataSourceList } from '@/components/apis/DataSourceList'
import { isImportActive } from '@/lib/imports'
import { BrandAvatar } from '@/components/brands/BrandAvatar'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState, ErrorState } from '@/components/PageStates'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apisApi, dataSourcesApi, organizationsApi } from '@/lib/api'
import type { Organization } from '@/lib/api-types'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { usePolling } from '@/lib/use-polling'
import { useRequest } from '@/lib/use-request'

// "/brands/:slug": one brand, its APIs and its data. The backend only returns the brand if the
// logged-in user owns it; someone else's brand and a non-existent one are both 404.
export function BrandPage() {
  const { slug = '' } = useParams()
  const { data, error, loading, reload } = useRequest(`organization:${slug}`, () =>
    organizationsApi.get(slug).then((res) => res.organization),
  )

  return (
    <div className="mx-auto max-w-5xl animate-in fade-in duration-300">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/" className="transition-colors hover:text-foreground">
          Brands
        </Link>
        <ChevronRight className="size-4" />
        <span className="truncate text-foreground">
          {data?.name ?? (loading ? '…' : error?.code === 'ORGANIZATION_NOT_FOUND' ? 'Not found' : 'Brand')}
        </span>
      </nav>

      <div className="mt-6">
        {loading ? (
          <BrandSkeleton />
        ) : error?.code === 'ORGANIZATION_NOT_FOUND' ? (
          <EmptyState
            icon={SearchX}
            title="Brand not found"
            description="This brand doesn't exist, or it belongs to another account."
            action={
              <Button asChild variant="outline">
                <Link to="/">Back to your brands</Link>
              </Button>
            }
          />
        ) : error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : (
          <BrandDetails organization={data!} />
        )}
      </div>
    </div>
  )
}

function BrandDetails({ organization }: { organization: Organization }) {
  const brandSlug = organization.slug
  // APIs and data are loaded together: the API cards show their data's import progress.
  const content = useRequest(
    `brand-content:${brandSlug}`,
    async () => {
      const [{ apis }, { dataSources }] = await Promise.all([
        apisApi.list(brandSlug),
        dataSourcesApi.list(brandSlug),
      ])
      return { apis, dataSources }
    },
    { refetchOnFocus: true },
  )

  // While any import runs, refresh quietly every 1.5 s so the progress bars move.
  const importing = content.data?.dataSources.some((ds) => isImportActive(ds.latestImport)) ?? false
  usePolling(importing, 1500, content.refresh)

  const createApiButton = (
    <Button asChild size="lg" className="h-9">
      <Link to={`/brands/${brandSlug}/apis/new`}>
        <Plus />
        Create API
      </Link>
    </Button>
  )
  const apiCount = content.data?.apis.length ?? 0
  const latestImportOf = (dataSourceId: string) =>
    content.data?.dataSources.find((ds) => ds.id === dataSourceId)?.latestImport ?? null

  return (
    <div className="flex flex-col gap-10">
      {/* Phones: the button goes under the name, so the name isn't squeezed. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <BrandAvatar name={organization.name} slug={organization.slug} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{organization.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex min-w-0 items-center gap-0.5">
                <span className="truncate font-mono text-xs">{organization.slug}</span>
                <CopyButton value={organization.slug} label="Copy brand slug" />
              </span>
              <span title={formatDateTime(organization.createdAt)}>Created {formatRelativeTime(organization.createdAt)}</span>
            </div>
          </div>
        </div>
        {apiCount > 0 && createApiButton}
      </header>

      <section aria-labelledby="apis-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="apis-heading" className="text-lg font-semibold">
              APIs
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Each API answers Jivox from one of your data sources, at its own address.
            </p>
          </div>
          {apiCount > 0 && (
            <span className="shrink-0 text-sm text-muted-foreground">
              {apiCount} {apiCount === 1 ? 'API' : 'APIs'}
            </span>
          )}
        </div>

        <div className="mt-4">
          {content.loading ? (
            <CardGridSkeleton />
          ) : content.error ? (
            <ErrorState message={content.error.message} onRetry={content.reload} />
          ) : apiCount === 0 ? (
            <FirstApiInvite action={createApiButton} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {content.data!.apis.map((api) => (
                <li key={api.id}>
                  <ApiCard api={api} brandSlug={brandSlug} latestImport={latestImportOf(api.dataSource.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {content.data && content.data.dataSources.length > 0 && (
        <section aria-labelledby="data-heading">
          <h2 id="data-heading" className="text-lg font-semibold">
            Data
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Uploaded files. Several APIs can answer from the same data.</p>
          <div className="mt-4">
            <DataSourceList brandSlug={brandSlug} dataSources={content.data.dataSources} onChanged={content.refresh} />
          </div>
        </section>
      )}
    </div>
  )
}

// Empty state for a brand without APIs: what an API is, in three steps.
function FirstApiInvite({ action }: { action: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-background px-6 py-10 animate-in fade-in duration-300">
      <div className="mx-auto max-w-2xl text-center">
        <h3 className="text-lg font-semibold">Create your first API</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload your product data once and get an address that Jivox Real Time Agents can call.
        </p>
      </div>
      <ol className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
        <Step number={1} icon={Upload} title="Upload data" text="A CSV file, even with 500,000 rows." />
        <Step number={2} icon={Database} title="Pick the id column" text="The column that names each row, like sku." />
        <Step number={3} icon={Link2} title="Get your address" text="/v1/<brand>/<api>, in the Jivox format." />
      </ol>
      <div className="mt-8 flex justify-center">{action}</div>
    </div>
  )
}

function Step({ number, icon: Icon, title, text }: { number: number; icon: LucideIcon; title: string; text: string }) {
  return (
    <li className="flex flex-col items-center rounded-xl bg-muted/50 p-4 text-center">
      <div className="relative flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden="true" />
        <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {number}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </li>
  )
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading APIs">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-8 w-full rounded-xl" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function BrandSkeleton() {
  return (
    <div className="flex flex-col gap-10" role="status" aria-label="Loading brand">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <CardGridSkeleton />
    </div>
  )
}
