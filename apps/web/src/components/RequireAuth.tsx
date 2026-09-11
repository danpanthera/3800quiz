import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { type ReactNode } from 'react'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { token, user } = useAuth()
  const location = useLocation()

  if (!token || !user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return <>{children}</>
}
