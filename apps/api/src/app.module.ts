import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { QuizModule } from './quiz/quiz.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { AdminModule } from './admin/admin.module';
import { ArenaModule } from './arena/arena.module';
import { GamificationModule } from './gamification/gamification.module';
import { AttemptsModule } from './attempts/attempts.module';
import { PerformanceModule } from './performance/performance.module';
import { DailyQuestionModule } from './daily-question/daily-question.module';
import { PracticeModule } from './practice/practice.module';
import { ReviewModule } from './review/review.module';
import { AssignmentScheduleModule } from './assignment-schedule/assignment-schedule.module';
import { QuestionApprovalModule } from './question-approval/question-approval.module';
import { TournamentModule } from './tournament/tournament.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    QuizModule,
    AssignmentsModule,
    SubmissionsModule,
    AdminModule,
    ArenaModule,
    GamificationModule,
    AttemptsModule,
    PerformanceModule,
    DailyQuestionModule,
    PracticeModule,
    ReviewModule,
    AssignmentScheduleModule,
    QuestionApprovalModule,
    TournamentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
