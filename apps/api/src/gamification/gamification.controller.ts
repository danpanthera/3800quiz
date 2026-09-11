import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class GamificationController {
  constructor(private svc: GamificationService) {}

  // ─── Các route /me ───────────────────────────────────────────────────────

  @Get('me/progress')
  getProgress(@Request() req: { user: { id: string } }) {
    return this.svc.getProgress(req.user.id);
  }

  @Get('me/badges')
  getBadges(@Request() req: { user: { id: string } }) {
    return this.svc.getBadges(req.user.id);
  }

  @Get('me/xp-history')
  getXpHistory(
    @Request() req: { user: { id: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getXpHistory(
      req.user.id,
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }

  // Không @Roles() — mở cho mọi vai trò đã đăng nhập, giống các route /me khác
  // ở trên. Tái dùng nguyên logic đã có ở admin/leaderboard, không sửa gì
  // trong GamificationService để tránh đụng phần đang sửa song song.
  @Get('me/leaderboard')
  getMyLeaderboard(
    @Query('period') period?: 'all' | 'month' | 'week',
    @Query('departmentId') departmentId?: string,
  ) {
    return this.svc.getLeaderboard(period ?? 'all', departmentId);
  }

  // ─── Các route /admin ─────────────────────────────────────────────────────

  @Get('admin/leaderboard')
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  getLeaderboard(
    @Query('period') period?: 'all' | 'month' | 'week',
    @Query('departmentId') departmentId?: string,
  ) {
    return this.svc.getLeaderboard(period ?? 'all', departmentId);
  }

  @Get('admin/badge-stats')
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  getBadgeStats() {
    return this.svc.getBadgeStats();
  }

  @Get('admin/levels')
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  getLevels() {
    return this.svc.getLevels();
  }

  @Post('admin/levels')
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  createLevel(
    @Body()
    body: {
      level: number;
      name: string;
      minXp: number;
      color: string;
      iconSlug?: string;
    },
  ) {
    return this.svc.createLevel(body);
  }

  @Put('admin/levels/:id')
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  updateLevel(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      name: string;
      minXp: number;
      color: string;
      iconSlug: string;
    }>,
  ) {
    return this.svc.updateLevel(id, body);
  }

  @Delete('admin/levels/:id')
  @Roles(UserRole.ADMIN, UserRole.TRAINER)
  async deleteLevel(@Param('id') id: string) {
    try {
      return await this.svc.deleteLevel(id);
    } catch (e: unknown) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Không thể xóa cấp độ này',
      );
    }
  }
}
