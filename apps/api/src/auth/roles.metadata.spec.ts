import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { AdminController } from '../admin/admin.controller';
import { ArenaController } from '../arena/arena.controller';
import { GamificationController } from '../gamification/gamification.controller';
import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';

const getRoles = (
  controller: object,
  methodName?: string,
): UserRole[] | undefined => {
  if (!methodName) return Reflect.getMetadata(ROLES_KEY, controller);

  const method = (controller as Record<string, unknown>)[methodName];
  return Reflect.getMetadata(ROLES_KEY, method as object);
};

describe('Ma trận phân quyền API', () => {
  it('mặc định giới hạn AdminController cho ADMIN', () => {
    expect(getRoles(AdminController)).toEqual([UserRole.ADMIN]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toContain(
      RolesGuard,
    );
  });

  it.each([
    'getBankQuestions',
    'getQuizzes',
    'createAssignment',
    'getReports',
    'getExamSessions',
    'createExamSession',
    'getDepartments',
    'getCanBo',
  ])('cho TRAINER dùng nghiệp vụ %s', (methodName) => {
    expect(getRoles(AdminController.prototype, methodName)).toEqual([
      UserRole.ADMIN,
      UserRole.TRAINER,
    ]);
  });

  it.each([
    'createAcademicYear',
    'createClass',
    'addClassMember',
    'resetCanBoPasswords',
    'importCanBo',
  ])('giữ nghiệp vụ %s ở quyền ADMIN', (methodName) => {
    expect(getRoles(AdminController.prototype, methodName)).toBeUndefined();
  });

  it('cho TRAINER điều hành Arena nhưng không gắn quyền vào route join công khai', () => {
    expect(getRoles(ArenaController.prototype, 'create')).toEqual([
      UserRole.ADMIN,
      UserRole.TRAINER,
    ]);
    expect(getRoles(ArenaController.prototype, 'joinInfo')).toBeUndefined();
  });

  it('cho TRAINER quản lý gamification nhưng route cá nhân không yêu cầu vai trò', () => {
    expect(getRoles(GamificationController.prototype, 'createLevel')).toEqual([
      UserRole.ADMIN,
      UserRole.TRAINER,
    ]);
    expect(
      getRoles(GamificationController.prototype, 'getProgress'),
    ).toBeUndefined();
  });
});
