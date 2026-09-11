import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssignmentsService } from './assignments.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Get('assignments')
  getMyAssignments(@Request() req: { user: { id: string } }) {
    return this.assignmentsService.getForUser(req.user.id);
  }
}
