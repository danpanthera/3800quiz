import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssignmentsService } from '../assignments/assignments.service';
import { QuizService } from './quiz.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class QuizController {
  constructor(
    private readonly quizService: QuizService,
    private readonly assignmentsService: AssignmentsService,
  ) {}

  @Get('me/quizzes/:id')
  async getQuizForAttempt(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    const assignments = await this.assignmentsService.getForUser(req.user.id);
    if (!assignments.some((assignment) => assignment.quizId === id)) {
      throw new ForbiddenException('Bạn không được phân công bài kiểm tra này');
    }

    return this.quizService.getQuizAttemptContent(id);
  }
}
