export const USER_ROLES = ['STAFF', 'TRAINER', 'ADMIN'] as const

export type UserRole = (typeof USER_ROLES)[number]

export const TRAINING_ROLES: readonly UserRole[] = ['TRAINER', 'ADMIN']
export const ADMIN_ROLES: readonly UserRole[] = ['ADMIN']

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole)
}

export function canAccess(
  role: UserRole,
  allowedRoles: readonly UserRole[],
): boolean {
  return allowedRoles.includes(role)
}

export function getDefaultRoute(role: UserRole): string {
  return role === 'STAFF' ? '/my/quizzes' : '/manage/quizzes'
}