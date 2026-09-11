import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ArenaService } from './arena.service';
import { CreateArenaDto } from './dto/create-arena.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

const ARENA_HOST_ROLES = [UserRole.ADMIN, UserRole.TRAINER] as const;

@Controller()
export class ArenaController {
  constructor(private arenaService: ArenaService) {}

  // ─── API quản trị (yêu cầu JWT) ──────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ARENA_HOST_ROLES)
  @Post('admin/arena-sessions')
  create(@Body() dto: CreateArenaDto) {
    return this.arenaService.createSession(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ARENA_HOST_ROLES)
  @Get('admin/arena-sessions')
  list() {
    return this.arenaService.listSessions();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ARENA_HOST_ROLES)
  @Get('admin/arena-sessions/:id')
  detail(@Param('id') id: string) {
    return this.arenaService.getSessionDetail(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ARENA_HOST_ROLES)
  @Delete('admin/arena-sessions/:id')
  remove(@Param('id') id: string) {
    return this.arenaService.deleteSession(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ARENA_HOST_ROLES)
  @Patch('admin/arena-sessions/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.arenaService.cancelSession(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ARENA_HOST_ROLES)
  @Patch('admin/arena-sessions/:id/stop')
  stop(@Param('id') id: string) {
    return this.arenaService.stopSession(id);
  }

  // ─── Tự phục vụ — học viên xem lịch sử Đấu trường của chính mình ─────────

  @UseGuards(JwtAuthGuard)
  @Get('me/arena-history')
  myHistory(@Request() req: { user: { id: string } }) {
    return this.arenaService.getMyHistory(req.user.id);
  }

  // ─── Điểm cuối công khai — trang join của người chơi xem trước thông tin phiên
  // đấu bằng joinCode, TRƯỚC khi đăng nhập (đăng nhập chỉ bắt buộc lúc join thật) ──

  @Get('arena/join/:joinCode')
  joinInfo(@Param('joinCode') joinCode: string) {
    return this.arenaService.getSessionByJoinCode(joinCode.toUpperCase());
  }
}
