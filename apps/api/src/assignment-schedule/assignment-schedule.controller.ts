import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ScheduleRecurrence, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AssignmentScheduleService } from './assignment-schedule.service';

const TRAINING_ROLES = [UserRole.ADMIN, UserRole.TRAINER] as const;

@Controller('admin/assignment-schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...TRAINING_ROLES)
export class AssignmentScheduleController {
  constructor(private readonly service: AssignmentScheduleService) {}

  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Post()
  create(
    @Body()
    body: {
      quizId: string;
      departmentId?: string;
      recurrence: ScheduleRecurrence;
      dayOfWeek?: number;
      dayOfMonth?: number;
      durationDays?: number;
    },
  ) {
    return this.service.create(body);
  }

  @Put(':id/active')
  setActive(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.service.setActive(id, body.isActive);
  }

  @Post(':id/run-now')
  runNow(@Param('id') id: string) {
    return this.service.runNow(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
