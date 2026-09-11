import { describe, expect, it } from 'vitest'
import {
  ADMIN_ROLES,
  TRAINING_ROLES,
  canAccess,
  getDefaultRoute,
  isUserRole,
} from './permissions'

describe('phân quyền portal web', () => {
  it('điều hướng STAFF vào khu vực bài kiểm tra cá nhân', () => {
    expect(getDefaultRoute('STAFF')).toBe('/my/quizzes')
  })

  it('chỉ TRAINER và ADMIN có quyền nghiệp vụ đào tạo', () => {
    expect(canAccess('TRAINER', TRAINING_ROLES)).toBe(true)
    expect(canAccess('ADMIN', TRAINING_ROLES)).toBe(true)
    expect(canAccess('STAFF', TRAINING_ROLES)).toBe(false)
  })

  it('chỉ ADMIN có quyền quản trị hệ thống', () => {
    expect(canAccess('ADMIN', ADMIN_ROLES)).toBe(true)
    expect(canAccess('TRAINER', ADMIN_ROLES)).toBe(false)
    expect(isUserRole('STAFF')).toBe(true)
    expect(isUserRole('SUPER_ADMIN')).toBe(false)
  })
})