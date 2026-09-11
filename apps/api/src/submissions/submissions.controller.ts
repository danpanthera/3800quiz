import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubmitDto } from './dto/submit.dto';
import { SubmissionsService } from './submissions.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('submissions')
  submit(@Request() req: { user: { id: string } }, @Body() dto: SubmitDto) {
    return this.submissionsService.submit(req.user.id, dto);
  }

  @Get('results/:submissionId')
  async getResult(
    @Param('submissionId') submissionId: string,
    @Request() req: { user: { id: string } },
  ) {
    const result = await this.submissionsService.getResult(
      submissionId,
      req.user.id,
    );
    if (!result)
      throw new NotFoundException('Bài thi chưa được đồng bộ lên server');
    return result;
  }
}
