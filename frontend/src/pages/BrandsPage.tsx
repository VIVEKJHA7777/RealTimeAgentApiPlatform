import { Building2, ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { BrandAvatar } from '@/components/brands/BrandAvatar'
import { EmptyState, ErrorState } from '@/components/PageStates'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { organizationsApi } from '@/lib/api'
import type { Organization } from '@/lib/api-types'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { useRequest } from '@/lib/use-request'

// "/" : the logged-in home page. Lists the user's brands, newest first.
export function BrandsPage() {
  const { data, error, loading, reload } = useRequest(
    'organizations',
    () => organizationsApi.list().then((res) => res.organizations),
    { refetchOnFocus: true }, // a brand created in another tab shows up when you come back
  )

  const count = data?.length ?? 0
  const newBrandButton = (
    <Button asChild size="lg" className="h-9">
      <Link to="/brands/new">
        <Plus />
        New brand
      </Link>
    </Button>
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your brands</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data && count > 0
              ? `${count} ${count === 1 ? 'brand' : 'brands'} · each one gets its own data, tokens and realtime API`
              : 'Each brand gets its own data, tokens and realtime API'}
          </p>
        </div>
        {data && count > 0 && newBrandButton}
      </div>

      {loading ? (
        <BrandGridSkeleton />
      ) : error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : count === 0 ? (
        <EmptyState
          icon={Building2}
          title="Create your first brand"
          description="A brand holds one company's product data. You'll get an API address for it that Jivox can call."
          action={newBrandButton}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data!.map((organization) => (
            <li key={organization.id}>
              <BrandCard organization={organization} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BrandCard({ organization }: { organization: Organization }) {
  return (
    <Link
      to={`/brands/${organization.slug}`}
      className="group flex h-full flex-col gap-4 rounded-2xl border bg-background p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <BrandAvatar name={organization.name} slug={organization.slug} />
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <div className="min-w-0">
        <h2 className="truncate font-semibold">{organization.name}</h2>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{organization.slug}</p>
      </div>
      <p className="mt-auto text-xs text-muted-foreground" title={formatDateTime(organization.createdAt)}>
        Created {formatRelativeTime(organization.createdAt)}
      </p>
    </Link>
  )
}

function BrandGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading brands">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}
