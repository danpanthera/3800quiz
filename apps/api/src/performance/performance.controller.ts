import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerformanceService } from './performance.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('subject-performance')
  getMySubjectPerformance(@Request() req: { user: { id: string } }) {
    return this.performanceService.getSubjectPerformance(req.user.id);
  }
}
