import {
  Body,
  Controller,
  Post,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest } from 'express';
import { AuthService, type LoginMeta } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottlerGuard } from './login-throttler.guard';

// Lấy IP + trình duyệt của lần đăng nhập — dùng cho danh sách phiên đăng nhập
// (việc 16) và cột ip_address của nhật ký quản trị (việc 14).
function readLoginMeta(req: ExpressRequest): LoginMeta {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Chống brute-force: tối đa 5 lần thử/phút tính theo IP — chỉ áp cho riêng
  // route này, không ảnh hưởng change-password hay bất kỳ API nào khác. Bổ sung
  // thêm khóa tài khoản tạm theo từng tài khoản ở auth.service.ts (việc 15).
  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Request() req: ExpressRequest) {
    return this.authService.login(dto, readLoginMeta(req));
  }

  // Bước 2 khi tài khoản bật xác thực 2 lớp — đổi token tạm + mã TOTP lấy
  // access token thật. Cũng giới hạn tốc độ để mã 6 chữ số không bị dò cạn.
  @Post('login/verify-totp')
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verifyTotpLogin(
    @Body() body: { pendingToken: string; code: string },
    @Request() req: ExpressRequest,
  ) {
    return this.authService.verifyTotpLogin(
      body.pendingToken,
      body.code,
      readLoginMeta(req),
    );
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Request() req: { user: { id: string } },
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(
      req.user.id,
      body.oldPassword,
      body.newPassword,
    );
  }
}
