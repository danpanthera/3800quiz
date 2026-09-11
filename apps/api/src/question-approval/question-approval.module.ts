import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionApprovalController } from './question-approval.controller';
import { QuestionApprovalService } from './question-approval.service';

@Module({
  imports: [AuthModule],
  controllers: [QuestionApprovalController],
  providers: [QuestionApprovalService],
})
export class QuestionApprovalModule {}
