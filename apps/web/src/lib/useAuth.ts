import { createContext, useContext } from 'react'
import type { UserRole } from './permissions'

export interface AuthUser {
  id: string
  username: string
  fullName: string
  role: UserRole
  mustChangePassword: boolean
}

export interface AuthContextType {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser) => void
  markPasswordChanged: () => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
