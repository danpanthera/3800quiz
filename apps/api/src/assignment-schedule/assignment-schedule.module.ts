import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssignmentScheduleController } from './assignment-schedule.controller';
import { AssignmentScheduleService } from './assignment-schedule.service';

@Module({
  imports: [AuthModule],
  controllers: [AssignmentScheduleController],
  providers: [AssignmentScheduleService],
})
export class AssignmentScheduleModule {}
