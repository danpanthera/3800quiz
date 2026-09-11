import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { canAccess, getDefaultRoute, type UserRole } from '../lib/permissions'

interface RoleGuardProps {
  allowedRoles: readonly UserRole[]
}

export default function RoleGuard({ allowedRoles }: RoleGuardProps) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (!canAccess(user.role, allowedRoles)) {
    return <Navigate to={getDefaultRoute(user.role)} replace />
  }

  return <Outlet />
}