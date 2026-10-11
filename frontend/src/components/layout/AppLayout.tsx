import { Building2 } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { Logo } from '@/components/auth/AuthLayout'
import { HealthBadge } from '@/components/HealthBadge'
import { UserMenu } from '@/components/layout/UserMenu'
import { cn } from '@/lib/utils'

// Sidebar links. `isActive` decides which item is highlighted for the current URL.
// New sections (Projects, Tokens...) are added here in later phases.
const NAV_ITEMS = [
  {
    to: '/',
    label: 'Brands',
    icon: Building2,
    isActive: (path: string) => path === '/' || path.startsWith('/brands'),
  },
]

// The frame around every logged-in page: sidebar on the left (hidden on small screens),
// header on top, and the current page rendered where <Outlet /> is.
export function AppLayout() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  return (
    <div className="flex min-h-svh bg-muted/40">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <Link to="/" className="flex h-14 items-center border-b px-4">
          <Logo />
        </Link>
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon, isActive }) => {
            const active = isActive(pathname)
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto truncate border-t px-4 py-3 text-xs text-muted-foreground">{user?.email}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-6">
          <Link to="/" className="md:hidden">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <HealthBadge />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
