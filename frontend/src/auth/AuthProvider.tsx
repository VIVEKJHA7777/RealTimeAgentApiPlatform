import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ApiError, authApi, setUnauthenticatedHandler } from '@/lib/api'
import type { User } from '@/lib/api-types'
import { rememberUser } from '@/lib/last-user'
import { AuthContext, type AuthStatus } from './auth-context'

// Holds "who is logged in" for the whole app.
// The truth lives in the backend (session cookie); this is the frontend's copy of it.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)

  // A ref (not state) so the 401 handler below always sees the latest value.
  const userRef = useRef<User | null>(null)
  useEffect(() => {
    userRef.current = user
    if (user) rememberUser(user.id) // see lib/last-user.ts
  }, [user])

  // 1. Ask the backend who we are: on page load, and again when the user presses "Retry".
  //    401 = simply not logged in. No answer at all = "unreachable": we DON'T pretend the
  //    user is logged out (their session may be perfectly fine); we show a retry screen.
  const applySession = useCallback((result: { user: User } | { error: unknown }) => {
    if ('user' in result) {
      setUser(result.user)
      setStatus('authenticated')
    } else {
      setUser(null)
      const notLoggedIn = result.error instanceof ApiError && result.error.status === 401
      setStatus(notLoggedIn ? 'anonymous' : 'unreachable')
    }
  }, [])

  useEffect(() => {
    let cancelled = false // ignore the answer if this component was removed meanwhile
    authApi.me().then(
      ({ user }) => !cancelled && applySession({ user }),
      (error: unknown) => !cancelled && applySession({ error }),
    )
    return () => {
      cancelled = true
    }
  }, [applySession])

  const retry = useCallback(() => {
    setStatus('loading')
    authApi.me().then(
      ({ user }) => applySession({ user }),
      (error: unknown) => applySession({ error }),
    )
  }, [applySession])

  // 2. Any API call answered "401 UNAUTHENTICATED" while we THINK we're logged in:
  //    the session expired or was ended in another tab. Switch to logged-out;
  //    RequireAuth then sends the user to /login.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      if (!userRef.current) return // we already knew we're logged out
      setUser(null)
      setStatus('anonymous')
      toast.info('Your session expired. Log in again.')
    })
    return () => setUnauthenticatedHandler(null)
  }, [])

  // 3. When the user comes back to this tab, re-check the session once. If they logged out
  //    in another tab (or the session expired), /me answers 401 and handler #2 takes over.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible' || !userRef.current) return
      authApi
        .me()
        .then(({ user }) => setUser(user)) // also picks up changes, e.g. a new name
        .catch(() => {}) // 401 handled by #2; network errors: keep the user, try again later
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const login = useCallback(async (input: { email: string; password: string }) => {
    const { user } = await authApi.login(input)
    setUser(user)
    setStatus('authenticated')
    return user
  }, [])

  const signup = useCallback(async (input: { email: string; password: string; name?: string }) => {
    const { user } = await authApi.signup(input)
    setUser(user)
    setStatus('authenticated')
    return user
  }, [])

  // Always logs out locally (the user asked to leave). Returns false if the server
  // couldn't be told, so the caller can show the right message.
  const logout = useCallback(async () => {
    let serverConfirmed = true
    try {
      await authApi.logout()
    } catch (error) {
      // 401 = the session was already gone on the server: that's still a clean logout.
      serverConfirmed = error instanceof ApiError && error.status === 401
    }
    setUser(null)
    setStatus('anonymous')
    return serverConfirmed
  }, [])

  const value = useMemo(
    () => ({ status, user, login, signup, logout, retry }),
    [status, user, login, signup, logout, retry],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
