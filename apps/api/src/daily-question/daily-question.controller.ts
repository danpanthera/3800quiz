import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DailyQuestionService } from './daily-question.service';

@Controller('me/daily-question')
@UseGuards(JwtAuthGuard)
export class DailyQuestionController {
  constructor(private readonly service: DailyQuestionService) {}

  @Get()
  getToday(@Request() req: { user: { id: string } }) {
    return this.service.getToday(req.user.id);
  }

  @Post('answer')
  @HttpCode(200)
  answer(
    @Request() req: { user: { id: string } },
    @Body() body: { questionId: string; selectedOptionIds?: string[] },
  ) {
    return this.service.answer(
      req.user.id,
      body.questionId,
      body.selectedOptionIds ?? [],
    );
  }
}
