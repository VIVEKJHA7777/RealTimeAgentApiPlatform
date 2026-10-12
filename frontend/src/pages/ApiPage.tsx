import { ChevronRight, SearchX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch, useParams } from 'react-router'
import { ApiActions } from '@/components/apis/api-page/ApiActions'
import type { ApiPageContext } from '@/components/apis/api-page/context'
import { FeedTypeIcon } from '@/components/apis/FeedTypeIcon'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState, ErrorState } from '@/components/PageStates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apisApi, dataSourcesApi, organizationsApi } from '@/lib/api'
import { feedTypeInfo } from '@/lib/feed-types'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { isImportActive } from '@/lib/imports'
import { usePolling } from '@/lib/use-polling'
import { useRequest } from '@/lib/use-request'
import { cn } from '@/lib/utils'

// The API page's tabs. Each ready tab has its own address (Back / reload / sharing work):
//   /brands/:slug/apis/:apiSlug        Overview
//   /brands/:slug/apis/:apiSlug/data   Data
//   /brands/:slug/apis/:apiSlug/design Design (task 3.7)
//   /brands/:slug/apis/:apiSlug/test   Test (Phase 4: tokens 4.6; calling + publish 4.7)
//   /brands/:slug/apis/:apiSlug/jivox  Jivox (Phase 5: Real Time Agents + their contracts, 5.5)
//   /brands/:slug/apis/:apiSlug/logs   Logs (Phase 7: every call to the live URL, 7.5)
const TABS = [
  { label: 'Overview', to: '', ready: true },
  { label: 'Data', to: 'data', ready: true },
  { label: 'Design', to: 'design', ready: true },
  { label: 'Test', to: 'test', ready: true },
  { label: 'Jivox', to: 'jivox', ready: true },
  { label: 'Logs', to: 'logs', ready: true },
]

// The frame of every API page tab: loads the API + its data once, shows the header with the
// actions, and renders the current tab in <Outlet />. While the data is importing it follows
// the progress by itself (every second, paused while the browser tab is hidden).
export function ApiPage() {
  const { slug = '', apiSlug = '' } = useParams()
  // The Design tab is wide (fields table + preview side by side on big screens).
  const wide = useMatch('/brands/:slug/apis/:apiSlug/design') !== null
  // Just renamed (Edit API): keep showing the page while it reloads under the new address, so
  // the open tab stays mounted (an unsaved design survives the rename).
  const renamed = Boolean((useLocation().state as { apiRenamed?: boolean } | null)?.apiRenamed)
  // The brand on its own: its name stays in the breadcrumb even when the API isn't found.
  const brand = useRequest(`organization:${slug}`, () => organizationsApi.get(slug).then((res) => res.organization))
  const page = useRequest(
    `api:${slug}/${apiSlug}`,
    async () => {
      const { api } = await apisApi.get(slug, apiSlug)
      const { dataSource } = await dataSourcesApi.get(slug, api.dataSource.id)
      return { api, dataSource }
    },
    { refetchOnFocus: true, keepPreviousData: renamed },
  )
  const importing = isImportActive(page.data?.dataSource.latestImport)
  usePolling(importing, 1000, page.refresh)

  // A wrong brand answers ORGANIZATION_NOT_FOUND for both requests: "brand not found" wins.
  const notFoundCode =
    brand.error?.code === 'ORGANIZATION_NOT_FOUND' || page.error?.code === 'ORGANIZATION_NOT_FOUND'
      ? 'ORGANIZATION_NOT_FOUND'
      : page.error?.code === 'API_NOT_FOUND'
        ? 'API_NOT_FOUND'
        : null
  const notFound = notFoundCode !== null
  // Loading with nothing to show yet (after a rename the previous page stays up meanwhile).
  const loading = (page.loading && !page.data) || (brand.loading && !brand.data)
  const error = page.error ?? brand.error

  return (
    <div className={cn('mx-auto animate-in fade-in duration-300', wide ? 'max-w-7xl' : 'max-w-5xl')}>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <Link to="/" className="shrink-0 transition-colors hover:text-foreground">
          Brands
        </Link>
        <ChevronRight className="size-4 shrink-0" />
        <Link to={`/brands/${slug}`} className="truncate transition-colors hover:text-foreground">
          {brand.data?.name ?? 'Brand'}
        </Link>
        <ChevronRight className="size-4 shrink-0" />
        <span className="truncate text-foreground">
          {page.data?.api.name ?? (loading ? '…' : notFound ? 'Not found' : 'API')}
        </span>
      </nav>

      <div className="mt-6">
        {loading && !notFound ? (
          <ApiSkeleton />
        ) : notFound ? (
          <EmptyState
            icon={SearchX}
            title={notFoundCode === 'API_NOT_FOUND' ? 'API not found' : 'Brand not found'}
            description={
              notFoundCode === 'API_NOT_FOUND'
                ? 'This brand has no API at this address. It may have been renamed or deleted.'
                : "This brand doesn't exist, or it belongs to another account."
            }
            action={
              <Button asChild variant="outline">
                <Link to={notFoundCode === 'API_NOT_FOUND' ? `/brands/${slug}` : '/'}>
                  {notFoundCode === 'API_NOT_FOUND' ? 'Back to the brand' : 'Back to your brands'}
                </Link>
              </Button>
            }
          />
        ) : error ? (
          <ErrorState
            message={error.message}
            onRetry={() => {
              brand.reload()
              page.reload()
            }}
          />
        ) : (
          <ApiFrame organization={brand.data!} {...page.data!} refresh={page.refresh} />
        )}
      </div>
    </div>
  )
}

function ApiFrame({ organization, api, dataSource, refresh }: Omit<ApiPageContext, 'readinessChanged' | 'readinessTick'>) {
  // On a phone the tab strip scrolls sideways: keep the open tab in view (Logs is the 6th, 7.5).
  const { pathname } = useLocation()
  const tabStrip = useRef<HTMLElement>(null)
  useEffect(() => {
    tabStrip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])
  const [readinessTick, setReadinessTick] = useState(0)
  const context: ApiPageContext = {
    organization,
    api,
    dataSource,
    refresh,
    readinessTick,
    readinessChanged: () => setReadinessTick((n) => n + 1),
  }
  const base = `/brands/${organization.slug}/apis/${api.slug}`
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <FeedTypeIcon feedType={api.feedType} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{api.name}</h1>
                <Badge
                  variant="outline"
                  className={cn(
                    'capitalize',
                    api.status === 'published'
                      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground',
                  )}
                  title={api.status === 'published' && api.publishedAt ? `Published ${formatDateTime(api.publishedAt)}` : 'Not called by Jivox until published'}
                >
                  {api.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {feedTypeInfo(api.feedType).label} feed of {organization.name} · created{' '}
                <span title={formatDateTime(api.createdAt)}>{formatRelativeTime(api.createdAt)}</span>
              </p>
            </div>
          </div>
          <ApiActions organization={organization} api={api} dataSource={dataSource} onChanged={refresh} readinessTick={readinessTick} />
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-background py-1.5 pr-1.5 pl-4">
          <code className="min-w-0 flex-1 truncate font-mono text-sm" data-testid="api-path">
            {api.path}
          </code>
          <CopyButton value={api.path} label="Copy API path" />
        </div>
      </header>

      <nav ref={tabStrip} aria-label="API sections" className="-mb-4 flex gap-1 overflow-x-auto border-b">
        {TABS.map((tab) =>
          tab.ready ? (
            <NavLink
              key={tab.label}
              to={tab.to ? `${base}/${tab.to}` : base}
              end
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center border-b-2 px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ) : (
            <span
              key={tab.label}
              aria-disabled="true"
              className="flex shrink-0 cursor-default items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground/70"
            >
              {tab.label}
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium">soon</span>
            </span>
          ),
        )}
      </nav>

      <Outlet context={context} />
    </div>
  )
}

function ApiSkeleton() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading API">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-11 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  )
}
