import { createContext } from 'react'
import type { User } from '@/lib/api-types'

// "loading"     = we're still asking the backend who is logged in (first moment after page load)
// "unreachable" = the backend didn't answer at all, so we can't know yet (retry screen)
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

export type AuthContextValue = {
  status: AuthStatus
  user: User | null
  login: (input: { email: string; password: string }) => Promise<User>
  signup: (input: { email: string; password: string; name?: string }) => Promise<User>
  // Resolves to false if the server couldn't be reached (logged out on this device only).
  logout: () => Promise<boolean>
  // Ask the backend again who we are (used by the "Can't reach the server" screen).
  retry: () => void
}

// Filled in by <AuthProvider>; read with useAuth().
export const AuthContext = createContext<AuthContextValue | null>(null)
