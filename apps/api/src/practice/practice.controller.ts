import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PracticeService } from './practice.service';

@Controller('me/practice')
@UseGuards(JwtAuthGuard)
export class PracticeController {
  constructor(private readonly service: PracticeService) {}

  @Get('subjects')
  getSubjects() {
    return this.service.getSubjects();
  }

  @Get('start')
  start(@Query('subjectId') subjectId?: string, @Query('count') count = '10') {
    return this.service.start(subjectId, Number(count) || 10);
  }

  @Post('grade')
  @HttpCode(200)
  grade(
    @Body()
    body: {
      answers: { questionId: string; selectedOptionIds: string[] }[];
    },
  ) {
    return this.service.grade(body.answers ?? []);
  }
}
