import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { generateTotpCode, generateTotpSecret } from './totp';

const PASSWORD = 'Abcd@1234';

async function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'nhanvien01',
    fullName: 'Nguyễn Văn A',
    email: null,
    role: 'STAFF',
    isActive: true,
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    failedLoginCount: 0,
    lockedUntil: null,
    totpSecret: null,
    totpEnabled: false,
    department: null,
    ...overrides,
  };
}

function buildPrismaMock(user: unknown) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findUniqueOrThrow: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue({ failedLoginCount: 1 }),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    canBo: { findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    userSession: {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

const jwtMock = {
  sign: jest.fn().mockReturnValue('token-gia-lap'),
  verify: jest.fn(),
};

describe('AuthService — bảo mật đăng nhập (việc 15/16/17)', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── Việc 15: khóa tài khoản tạm ───────────────────────────────────────

  it('đăng nhập đúng mật khẩu → tạo UserSession, JWT mang theo sid, reset bộ đếm sai', async () => {
    const prisma = buildPrismaMock(await buildUser());
    const service = new AuthService(prisma as never, jwtMock as never);

    const result = await service.login({
      username: 'nhanvien01',
      password: PASSWORD,
    });

    expect(prisma.userSession.create).toHaveBeenCalled();
    expect(jwtMock.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sid: 'session-1', sub: 'user-1' }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedLoginCount: 0, lockedUntil: null },
      }),
    );
    expect(result).toHaveProperty('accessToken', 'token-gia-lap');
  });

  it('sai mật khẩu → tăng bộ đếm và ném UnauthorizedException', async () => {
    const prisma = buildPrismaMock(await buildUser());
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(
      service.login({ username: 'nhanvien01', password: 'sai-mat-khau' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
    );
    expect(prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('sai mật khẩu lần thứ 5 → khóa tài khoản 15 phút', async () => {
    const prisma = buildPrismaMock(await buildUser({ failedLoginCount: 4 }));
    prisma.user.update.mockResolvedValueOnce({ failedLoginCount: 5 });
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(
      service.login({ username: 'nhanvien01', password: 'sai-mat-khau' }),
    ).rejects.toThrow(UnauthorizedException);

    const lockCall = prisma.user.update.mock.calls.find(
      (c) => (c[0] as { data?: { lockedUntil?: Date } }).data?.lockedUntil,
    );
    expect(lockCall).toBeDefined();
  });

  it('tài khoản đang bị khóa → ForbiddenException, KHÔNG kiểm tra mật khẩu', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60_000);
    const prisma = buildPrismaMock(await buildUser({ lockedUntil }));
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(
      service.login({ username: 'nhanvien01', password: PASSWORD }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('khóa đã hết hạn → cho đăng nhập bình thường trở lại', async () => {
    const lockedUntil = new Date(Date.now() - 60_000); // đã qua
    const prisma = buildPrismaMock(await buildUser({ lockedUntil }));
    const service = new AuthService(prisma as never, jwtMock as never);

    const result = await service.login({
      username: 'nhanvien01',
      password: PASSWORD,
    });
    expect(result).toHaveProperty('accessToken');
  });

  // ─── Việc 17: xác thực 2 lớp ───────────────────────────────────────────

  it('tài khoản bật 2FA → KHÔNG phát access token ngay, chỉ trả token tạm', async () => {
    const secret = generateTotpSecret();
    const prisma = buildPrismaMock(
      await buildUser({ totpEnabled: true, totpSecret: secret }),
    );
    const service = new AuthService(prisma as never, jwtMock as never);

    const result = await service.login({
      username: 'nhanvien01',
      password: PASSWORD,
    });

    expect(result).toEqual({
      requiresTotp: true,
      pendingToken: 'token-gia-lap',
    });
    expect(prisma.userSession.create).not.toHaveBeenCalled();
    expect(jwtMock.sign).toHaveBeenCalledWith(
      { sub: 'user-1', type: 'totp_pending' },
      { expiresIn: '5m' },
    );
  });

  it('verify-totp đúng mã → phát access token thật + tạo phiên', async () => {
    const secret = generateTotpSecret();
    const prisma = buildPrismaMock(
      await buildUser({ totpEnabled: true, totpSecret: secret }),
    );
    jwtMock.verify.mockReturnValue({ sub: 'user-1', type: 'totp_pending' });
    const service = new AuthService(prisma as never, jwtMock as never);

    const result = await service.verifyTotpLogin(
      'token-tam',
      generateTotpCode(secret),
    );

    expect(result).toHaveProperty('accessToken', 'token-gia-lap');
    expect(prisma.userSession.create).toHaveBeenCalled();
  });

  it('verify-totp sai mã → tăng bộ đếm khóa tài khoản (chặn dò mã 6 chữ số)', async () => {
    const secret = generateTotpSecret();
    const prisma = buildPrismaMock(
      await buildUser({ totpEnabled: true, totpSecret: secret }),
    );
    jwtMock.verify.mockReturnValue({ sub: 'user-1', type: 'totp_pending' });
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(
      service.verifyTotpLogin('token-tam', '000000'),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
    );
  });

  it('verify-totp với token KHÔNG phải loại totp_pending → từ chối', async () => {
    const prisma = buildPrismaMock(await buildUser());
    jwtMock.verify.mockReturnValue({ sub: 'user-1', sid: 'session-1' });
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(
      service.verifyTotpLogin('token-that', '123456'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('confirmTotp: mã đúng → bật totpEnabled', async () => {
    const secret = generateTotpSecret();
    const prisma = buildPrismaMock(await buildUser({ totpSecret: secret }));
    const service = new AuthService(prisma as never, jwtMock as never);

    await service.confirmTotp('user-1', generateTotpCode(secret));

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { totpEnabled: true },
    });
  });

  it('confirmTotp: mã sai → BadRequestException, không bật', async () => {
    const secret = generateTotpSecret();
    const prisma = buildPrismaMock(await buildUser({ totpSecret: secret }));
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(service.confirmTotp('user-1', '000000')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('disableTotp: sai mật khẩu → không tắt được', async () => {
    const prisma = buildPrismaMock(
      await buildUser({ totpEnabled: true, totpSecret: generateTotpSecret() }),
    );
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(service.disableTotp('user-1', 'sai-mat-khau')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('setupTotp: đã bật 2FA rồi → yêu cầu tắt trước', async () => {
    const prisma = buildPrismaMock(await buildUser({ totpEnabled: true }));
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(service.setupTotp('user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ─── Việc 16: kiểm soát phiên ──────────────────────────────────────────

  it('listMySessions: đánh dấu đúng phiên hiện tại', async () => {
    const prisma = buildPrismaMock(await buildUser());
    prisma.userSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        userAgent: 'Chrome',
        ipAddress: '10.0.0.1',
        createdAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        id: 'session-2',
        userAgent: 'Safari',
        ipAddress: '10.0.0.2',
        createdAt: new Date(),
        lastSeenAt: new Date(),
      },
    ] as never);
    const service = new AuthService(prisma as never, jwtMock as never);

    const result = await service.listMySessions('user-1', 'session-1');

    expect(result[0].isCurrent).toBe(true);
    expect(result[1].isCurrent).toBe(false);
  });

  it('revokeMySession: phiên của người khác → NotFound, không thu hồi', async () => {
    const prisma = buildPrismaMock(await buildUser());
    prisma.userSession.findUnique.mockResolvedValue({
      id: 'session-9',
      userId: 'user-khac',
    });
    const service = new AuthService(prisma as never, jwtMock as never);

    await expect(
      service.revokeMySession('user-1', 'session-9'),
    ).rejects.toThrow();
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('revokeMyOtherSessions: giữ lại đúng phiên hiện tại', async () => {
    const prisma = buildPrismaMock(await buildUser());
    const service = new AuthService(prisma as never, jwtMock as never);

    await service.revokeMyOtherSessions('user-1', 'session-1');

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null, id: { not: 'session-1' } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('adminUnlockUser: xoá cả bộ đếm sai lẫn mốc khóa', async () => {
    const prisma = buildPrismaMock(await buildUser());
    const service = new AuthService(prisma as never, jwtMock as never);

    await service.adminUnlockUser('user-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });
});
