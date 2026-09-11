import { useState, type ReactNode } from 'react'
import { isUserRole } from './permissions'
import { AuthContext, type AuthUser } from './useAuth'

function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem('user')
  if (!raw) return null

  try {
    const value = JSON.parse(raw) as Partial<AuthUser>
    if (
      typeof value.id !== 'string' ||
      typeof value.username !== 'string' ||
      typeof value.fullName !== 'string' ||
      !isUserRole(value.role)
    ) {
      return null
    }

    return {
      id: value.id,
      username: value.username,
      fullName: value.fullName,
      role: value.role,
      mustChangePassword: value.mustChangePassword === true,
    }
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<AuthUser | null>(getStoredUser)

  function login(newToken: string, newUser: AuthUser) {
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  function markPasswordChanged() {
    if (!user) return
    const updatedUser = { ...user, mustChangePassword: false }
    localStorage.setItem('user', JSON.stringify(updatedUser))
    setUser(updatedUser)
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, markPasswordChanged, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
