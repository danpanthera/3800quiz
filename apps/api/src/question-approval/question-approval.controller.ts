import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { QuestionApprovalService } from './question-approval.service';

const TRAINING_ROLES = [UserRole.ADMIN, UserRole.TRAINER] as const;

@Controller('admin/bank-questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionApprovalController {
  constructor(private readonly service: QuestionApprovalService) {}

  // TRAINER cũng xem được — để theo dõi câu mình gửi đã duyệt/từ chối chưa.
  @Get('pending')
  @Roles(...TRAINING_ROLES)
  getPending() {
    return this.service.getPending();
  }

  // Chỉ ADMIN được duyệt/từ chối — TRAINER không tự duyệt bài của mình hay đồng nghiệp.
  @Put(':id/approve')
  @Roles(UserRole.ADMIN)
  approve(@Param('id') id: string, @Request() req: { user: { id: string } }) {
    return this.service.approve(id, req.user.id);
  }

  @Put(':id/reject')
  @Roles(UserRole.ADMIN)
  reject(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Body() body: { reason?: string },
  ) {
    return this.service.reject(id, req.user.id, body.reason);
  }
}
