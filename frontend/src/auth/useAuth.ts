import { useContext } from 'react'
import { AuthContext } from './auth-context'

// const { user, status, login, signup, logout } = useAuth()
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth() must be used inside <AuthProvider>')
  }
  return value
}
