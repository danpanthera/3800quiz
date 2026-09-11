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
import { ReviewService } from './review.service';

@Controller('me/review')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get('stats')
  getStats(@Request() req: { user: { id: string } }) {
    return this.service.getStats(req.user.id);
  }

  @Get('queue')
  getQueue(@Request() req: { user: { id: string } }) {
    return this.service.getDueQueue(req.user.id);
  }

  @Post('answer')
  @HttpCode(200)
  answer(
    @Request() req: { user: { id: string } },
    @Body() body: { cardId: string; selectedOptionIds?: string[] },
  ) {
    return this.service.answer(
      req.user.id,
      body.cardId,
      body.selectedOptionIds ?? [],
    );
  }
}
