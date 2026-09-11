import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

function buildPrismaMock(session: unknown) {
  return {
    userSession: {
      findUnique: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

const VALID_PAYLOAD = {
  sub: 'user-1',
  username: 'nhanvien01',
  role: 'STAFF',
  sid: 'session-1',
};

describe('JwtStrategy — kiểm tra phiên đăng nhập ở mọi request (việc 16)', () => {
  it('phiên còn sống → trả về thông tin user kèm sessionId', async () => {
    const prisma = buildPrismaMock({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      lastSeenAt: new Date(),
    });
    const strategy = new JwtStrategy(prisma as never);

    await expect(strategy.validate(VALID_PAYLOAD)).resolves.toEqual({
      id: 'user-1',
      username: 'nhanvien01',
      role: 'STAFF',
      sessionId: 'session-1',
    });
  });

  it('phiên đã bị thu hồi → từ chối ngay (đăng xuất từ xa có hiệu lực tức thì)', async () => {
    const prisma = buildPrismaMock({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: new Date(),
      lastSeenAt: new Date(),
    });
    const strategy = new JwtStrategy(prisma as never);

    await expect(strategy.validate(VALID_PAYLOAD)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('phiên không còn tồn tại → từ chối', async () => {
    const prisma = buildPrismaMock(null);
    const strategy = new JwtStrategy(prisma as never);

    await expect(strategy.validate(VALID_PAYLOAD)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('sid thuộc về user khác (token bị ghép sai) → từ chối', async () => {
    const prisma = buildPrismaMock({
      id: 'session-1',
      userId: 'user-khac',
      revokedAt: null,
      lastSeenAt: new Date(),
    });
    const strategy = new JwtStrategy(prisma as never);

    await expect(strategy.validate(VALID_PAYLOAD)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token tạm của xác thực 2 lớp KHÔNG dùng được để gọi API', async () => {
    const prisma = buildPrismaMock(null);
    const strategy = new JwtStrategy(prisma as never);

    await expect(
      strategy.validate({ sub: 'user-1', type: 'totp_pending' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('token cũ không có sid (phát hành trước tính năng này) → buộc đăng nhập lại', async () => {
    const prisma = buildPrismaMock(null);
    const strategy = new JwtStrategy(prisma as never);

    await expect(
      strategy.validate({ sub: 'user-1', username: 'a', role: 'STAFF' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('lastSeenAt mới cập nhật gần đây → KHÔNG ghi DB thêm lần nữa', async () => {
    const prisma = buildPrismaMock({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      lastSeenAt: new Date(),
    });
    const strategy = new JwtStrategy(prisma as never);

    await strategy.validate(VALID_PAYLOAD);

    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('lastSeenAt đã cũ → cập nhật lại (không chặn request)', async () => {
    const prisma = buildPrismaMock({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      lastSeenAt: new Date(Date.now() - 10 * 60_000),
    });
    const strategy = new JwtStrategy(prisma as never);

    await strategy.validate(VALID_PAYLOAD);

    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastSeenAt: expect.any(Date) },
    });
  });
});
