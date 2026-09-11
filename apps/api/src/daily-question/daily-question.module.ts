import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { DailyQuestionController } from './daily-question.controller';
import { DailyQuestionService } from './daily-question.service';

@Module({
  imports: [GamificationModule],
  controllers: [DailyQuestionController],
  providers: [DailyQuestionService],
})
export class DailyQuestionModule {}
