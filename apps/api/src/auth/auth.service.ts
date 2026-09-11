import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from './totp';
import * as bcrypt from 'bcrypt';

const DEFAULT_PASSWORD = 'Abcd@1234';

// Việc 15 — khóa tài khoản tạm: sai mật khẩu (hoặc sai mã 2 lớp) liên tiếp đủ
// ngưỡng thì khóa trong LOCK_MINUTES phút. Bổ sung cho giới hạn tốc độ theo IP
// sẵn có ở LoginThrottlerGuard (chặn theo IP, không chặn theo tài khoản) — kẻ
// tấn công đổi IP vẫn bị chặn ở đây vì đếm theo từng tài khoản.
const FAILED_LOGIN_THRESHOLD = 5;
const LOCK_MINUTES = 15;

// Thông tin thiết bị/mạng của lần đăng nhập — dùng cho UserSession (việc 16) và
// cột ip_address của AuditLog (hoàn thiện việc 14).
export interface LoginMeta {
  userAgent?: string;
  ipAddress?: string;
}

interface UserForSession {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  mustChangePassword: boolean;
  department: { id: string; name: string } | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, meta: LoginMeta = {}) {
    let user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: { department: true },
    });

    // Nếu không tìm thấy User, tự tạo tài khoản theo UserAD; chỉ dùng mã CB khi chưa có UserAD.
    if (!user) {
      const canBo = await this.prisma.canBo.findFirst({
        where: {
          OR: [
            { userAD: dto.username, isActive: true },
            { cbCode: dto.username, userAD: null, isActive: true },
            { cbCode: dto.username, userAD: '', isActive: true },
          ],
        },
        include: { department: true },
      });
      if (canBo) {
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
        const username = canBo.userAD?.trim() || canBo.cbCode;
        user = await this.prisma.user.create({
          data: {
            username,
            fullName: canBo.fullName,
            email: canBo.email ?? undefined,
            passwordHash,
            role: 'STAFF',
            isActive: true,
            mustChangePassword: true,
            departmentId: canBo.departmentId ?? undefined,
          },
          include: { department: true },
        });
      }
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc đã bị khóa',
      );
    }

    this.assertNotLocked(user.lockedUntil);

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      await this.registerFailedAttempt(user.id);
      throw new UnauthorizedException('Sai mật khẩu');
    }

    await this.clearFailedAttempts(user.id);

    // Bật xác thực 2 lớp: CHƯA phát access token thật, chỉ trả 1 token tạm
    // sống 5 phút để đổi lấy token thật sau khi nhập đúng mã TOTP.
    if (user.totpEnabled) {
      const pendingToken = this.jwtService.sign(
        { sub: user.id, type: 'totp_pending' },
        { expiresIn: '5m' },
      );
      return { requiresTotp: true as const, pendingToken };
    }

    await this.writeLoginAuditLog(user.id, user.username, meta);
    return this.issueSession(user, meta);
  }

  // Bước 2 của đăng nhập khi tài khoản bật xác thực 2 lớp (việc 17).
  async verifyTotpLogin(
    pendingToken: string,
    code: string,
    meta: LoginMeta = {},
  ) {
    let payload: { sub: string; type?: string };
    try {
      payload = this.jwtService.verify<{ sub: string; type?: string }>(
        pendingToken,
      );
    } catch {
      throw new UnauthorizedException(
        'Phiên xác thực đã hết hạn, vui lòng đăng nhập lại',
      );
    }
    if (payload.type !== 'totp_pending') {
      throw new UnauthorizedException('Token xác thực không hợp lệ');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { department: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc đã bị khóa',
      );
    }

    // Sai mã 2 lớp cũng tính vào ngưỡng khóa tài khoản — nếu không, mã 6 chữ số
    // có thể bị dò cạn kiệt bằng cách lặp lại bước 2 với cùng 1 pendingToken.
    this.assertNotLocked(user.lockedUntil);

    if (!user.totpSecret || !verifyTotpCode(user.totpSecret, code)) {
      await this.registerFailedAttempt(user.id);
      throw new UnauthorizedException('Mã xác thực không đúng');
    }

    await this.clearFailedAttempts(user.id);
    await this.writeLoginAuditLog(user.id, user.username, meta, true);
    return this.issueSession(user, meta);
  }

  private assertNotLocked(lockedUntil: Date | null): void {
    if (!lockedUntil || lockedUntil <= new Date()) return;
    const minutesLeft = Math.max(
      1,
      Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
    );
    throw new ForbiddenException(
      `Tài khoản đang bị khóa tạm do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${minutesLeft} phút.`,
    );
  }

  private async registerFailedAttempt(userId: string): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount < FAILED_LOGIN_THRESHOLD) return;

    // Đạt ngưỡng: khóa tạm và reset bộ đếm để sau khi hết khóa lại được thử
    // trọn ngưỡng lần nữa (thay vì bị khóa lại ngay lần sai kế tiếp).
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
        failedLoginCount: 0,
      },
    });
  }

  private async clearFailedAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  private async writeLoginAuditLog(
    userId: string,
    username: string,
    meta: LoginMeta,
    viaTotp = false,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGIN',
        ipAddress: meta.ipAddress,
        meta: { username, userAgent: meta.userAgent ?? null, viaTotp },
      },
    });
  }

  // Tạo 1 dòng UserSession rồi nhúng id phiên (sid) vào JWT — jwt.strategy.ts
  // kiểm tra phiên còn sống ở MỌI request, nhờ đó thu hồi phiên có hiệu lực ngay
  // (việc 16) thay vì phải chờ token hết hạn.
  private async issueSession(user: UserForSession, meta: LoginMeta) {
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ipAddress,
      },
    });

    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
      sid: session.id,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        department: user.department
          ? { id: user.department.id, name: user.department.name }
          : null,
      },
    };
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Mật khẩu cũ không đúng');

    if (newPassword.length < 6)
      throw new BadRequestException('Mật khẩu mới phải tối thiểu 6 ký tự');

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    return { message: 'Đổi mật khẩu thành công' };
  }

  // ─── Việc 17: Xác thực 2 lớp (TOTP) ──────────────────────────────────────

  async getTotpStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabled: true, totpSecret: true },
    });
    return {
      enabled: user.totpEnabled,
      // Đã sinh secret nhưng chưa xác nhận mã lần đầu — cho phép UI hiện lại
      // bước nhập mã thay vì bắt sinh secret mới từ đầu.
      pendingSetup: !user.totpEnabled && Boolean(user.totpSecret),
    };
  }

  async setupTotp(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, totpEnabled: true },
    });
    if (user.totpEnabled)
      throw new BadRequestException(
        'Tài khoản đã bật xác thực 2 lớp — hãy tắt trước nếu muốn thiết lập lại',
      );

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabled: false },
    });

    return {
      secret,
      otpauthUrl: buildOtpauthUrl(secret, user.username),
    };
  }

  async confirmTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecret: true },
    });
    if (!user.totpSecret)
      throw new BadRequestException(
        'Chưa thiết lập xác thực 2 lớp — hãy bấm "Thiết lập" trước',
      );
    if (!verifyTotpCode(user.totpSecret, code))
      throw new BadRequestException(
        'Mã xác thực không đúng — kiểm tra lại đồng hồ điện thoại rồi thử mã mới',
      );

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });
    return { message: 'Đã bật xác thực 2 lớp cho tài khoản' };
  }

  // Bắt buộc nhập lại mật khẩu để tắt — tránh người khác mượn máy đang mở sẵn
  // phiên đăng nhập rồi vô hiệu hoá lớp bảo vệ thứ 2.
  async disableTotp(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Mật khẩu không đúng');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabled: false },
    });
    return { message: 'Đã tắt xác thực 2 lớp' };
  }

  // ─── Việc 16: Kiểm soát phiên đăng nhập ──────────────────────────────────

  async listMySessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      isCurrent: s.id === currentSessionId,
    }));
  }

  async revokeMySession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId)
      throw new NotFoundException('Không tìm thấy phiên đăng nhập này');

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { message: 'Đã đăng xuất phiên đăng nhập đó' };
  }

  async revokeMyOtherSessions(userId: string, currentSessionId: string) {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    });
    return { message: `Đã đăng xuất ${result.count} thiết bị khác` };
  }

  // ─── Việc 15 + 16: Trang quản trị bảo mật (chỉ ADMIN) ────────────────────

  async adminListSessions(userId?: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { revokedAt: null, ...(userId ? { userId } : {}) },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(sessions.map((s) => s.userId))] } },
      select: { id: true, username: true, fullName: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      username: userById.get(s.userId)?.username ?? null,
      fullName: userById.get(s.userId)?.fullName ?? null,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
    }));
  }

  async adminRevokeSession(sessionId: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    if (!session)
      throw new NotFoundException('Không tìm thấy phiên đăng nhập này');

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { message: 'Đã buộc đăng xuất phiên đăng nhập' };
  }

  async adminListLockedUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { lockedUntil: { gt: new Date() } },
          { failedLoginCount: { gt: 0 } },
        ],
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        failedLoginCount: true,
        lockedUntil: true,
        totpEnabled: true,
      },
      orderBy: { lockedUntil: 'desc' },
    });
    return users.map((u) => ({
      ...u,
      isLocked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
    }));
  }

  async adminUnlockUser(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return { message: 'Đã mở khóa tài khoản' };
  }
}
