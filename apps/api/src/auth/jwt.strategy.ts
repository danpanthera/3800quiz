import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from './jwt-secret';

// Chỉ ghi lại lastSeenAt khi đã quá mốc này — tránh ghi DB ở MỌI request.
const LAST_SEEN_REFRESH_MS = 5 * 60_000;

interface JwtPayload {
  sub: string;
  username?: string;
  role?: string;
  sid?: string; // id UserSession — bắt buộc với access token thật (việc 16)
  type?: string; // 'totp_pending' = token tạm giữa 2 bước đăng nhập (việc 17)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    // Token tạm của bước xác thực 2 lớp KHÔNG được dùng để gọi API — nó chỉ
    // dùng đúng 1 lần ở /auth/login/verify-totp để đổi lấy token thật.
    if (payload.type === 'totp_pending') {
      throw new UnauthorizedException(
        'Token tạm của xác thực 2 lớp không dùng để truy cập API',
      );
    }

    // Token phát hành TRƯỚC khi có kiểm soát phiên thì không có `sid` — buộc
    // đăng nhập lại để tạo phiên có thể thu hồi được. Chỉ xảy ra đúng 1 lần
    // ngay sau khi triển khai tính năng này.
    if (!payload.sid) {
      throw new UnauthorizedException(
        'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại',
      );
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: { id: true, userId: true, revokedAt: true, lastSeenAt: true },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub) {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại',
      );
    }

    // Cập nhật "hoạt động gần nhất" kiểu bắn-và-quên, có tiết chế theo thời
    // gian — không chặn request và không tạo 1 lượt ghi DB cho mỗi lần gọi API.
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      void this.prisma.userSession
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      sessionId: payload.sid,
    };
  }
}
