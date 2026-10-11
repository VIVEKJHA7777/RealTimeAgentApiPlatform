import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { ServerUnreachable } from '@/components/ServerUnreachable'
import { lastUserId } from '@/lib/last-user'
import { useAuth } from './useAuth'

// Wraps pages that need a logged-in user.
// Not logged in → /login, remembering where the user wanted to go (state.from) and who was
// logged in before (state.forUser: that page is only reopened for the same user).
export function RequireAuth() {
  const { status, retry } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'unreachable') return <ServerUnreachable onRetry={retry} />
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search, forUser: lastUserId() }} />
  }
  return <Outlet />
}
