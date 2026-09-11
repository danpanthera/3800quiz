import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

type AuthedRequest = { user: { id: string; sessionId?: string } };

/**
 * Tự phục vụ bảo mật cho người dùng: bật/tắt xác thực 2 lớp (việc 17) và xem/
 * thu hồi các phiên đăng nhập của chính mình (việc 16). Tách khỏi
 * auth.controller.ts để file đăng nhập giữ nguyên phạm vi hẹp.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class SecurityController {
  constructor(private readonly authService: AuthService) {}

  @Get('2fa/status')
  getTotpStatus(@Request() req: AuthedRequest) {
    return this.authService.getTotpStatus(req.user.id);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setupTotp(@Request() req: AuthedRequest) {
    return this.authService.setupTotp(req.user.id);
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  confirmTotp(@Request() req: AuthedRequest, @Body() body: { code: string }) {
    return this.authService.confirmTotp(req.user.id, body.code);
  }

  @Post('2fa/disable')
  @HttpCode(200)
  disableTotp(
    @Request() req: AuthedRequest,
    @Body() body: { password: string },
  ) {
    return this.authService.disableTotp(req.user.id, body.password);
  }

  @Get('sessions')
  listMySessions(@Request() req: AuthedRequest) {
    return this.authService.listMySessions(req.user.id, req.user.sessionId);
  }

  // Route tĩnh phải đứng TRƯỚC "sessions/:id" — ":id" là wildcard sẽ nuốt luôn
  // "revoke-others" nếu khai báo sau (đã từng dính lỗi này ở assignments/extend).
  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOtherSessions(@Request() req: AuthedRequest) {
    return this.authService.revokeMyOtherSessions(
      req.user.id,
      req.user.sessionId ?? '',
    );
  }

  @Delete('sessions/:id')
  revokeMySession(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.authService.revokeMySession(req.user.id, id);
  }
}

/** Giám sát bảo mật toàn hệ thống — chỉ ADMIN (việc 15 + 16). */
@Controller('admin/security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSecurityController {
  constructor(private readonly authService: AuthService) {}

  @Get('sessions')
  listSessions(@Query('userId') userId?: string) {
    return this.authService.adminListSessions(userId);
  }

  @Delete('sessions/:id')
  revokeSession(@Param('id') id: string) {
    return this.authService.adminRevokeSession(id);
  }

  @Get('locked-users')
  listLockedUsers() {
    return this.authService.adminListLockedUsers();
  }

  @Post('users/:id/unlock')
  @HttpCode(200)
  unlockUser(@Param('id') id: string) {
    return this.authService.adminUnlockUser(id);
  }
}
