import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { ServerUnreachable } from '@/components/ServerUnreachable'
import { useAuth } from './useAuth'

// Wraps /login and /signup. Already logged in → go to the page the user originally
// wanted (set by RequireAuth), or the home page. This also performs the redirect right
// after a successful login/sign-up.
export function RedirectIfAuthed() {
  const { status, retry, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'unreachable') return <ServerUnreachable onRetry={retry} />
  if (status === 'authenticated') {
    const { from, forUser } = (location.state as { from?: string; forUser?: string | null } | null) ?? {}
    // Only follow in-app paths ("/..."), never "//evil.com" style URLs; and not a page of the
    // PREVIOUS user's (another account logged in: their brand would be "not found").
    const sameUser = !forUser || forUser === user?.id
    const target = from && sameUser && from.startsWith('/') && !from.startsWith('//') ? from : '/'
    return <Navigate to={target} replace />
  }
  return <Outlet />
}
