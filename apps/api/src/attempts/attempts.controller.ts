import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LockAttemptAnswerDto } from './dto/lock-attempt-answer.dto';
import { SaveAttemptAnswersDto } from './dto/save-attempt-answers.dto';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { ReportViolationDto } from './dto/report-violation.dto';
import { AttemptsService } from './attempts.service';

@Controller('me/attempts')
@UseGuards(JwtAuthGuard)
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Post()
  start(
    @Request() req: { user: { id: string } },
    @Body() dto: StartAttemptDto,
  ) {
    return this.attemptsService.start(req.user.id, dto);
  }

  @Get(':id')
  get(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.attemptsService.get(req.user.id, id);
  }

  @Put(':id/answers')
  saveAnswers(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: SaveAttemptAnswersDto,
  ) {
    return this.attemptsService.saveAnswers(req.user.id, id, dto);
  }

  // Chế độ phản hồi tức thì: chốt 1 câu và nhận ngay kết quả đúng/sai của câu đó
  @Post(':id/answers/:questionId/lock')
  lockAnswer(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: LockAttemptAnswerDto,
  ) {
    return this.attemptsService.lockAnswer(req.user.id, id, questionId, dto);
  }

  @Post(':id/submit')
  submit(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.attemptsService.finalize(req.user.id, id, false);
  }

  @Post(':id/violations')
  reportViolation(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: ReportViolationDto,
  ) {
    return this.attemptsService.reportViolation(req.user.id, id, dto.type);
  }
}
