import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TournamentService } from './tournament.service';

const TRAINING_ROLES = [UserRole.ADMIN, UserRole.TRAINER] as const;

@Controller('admin/tournaments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...TRAINING_ROLES)
export class TournamentController {
  constructor(private readonly service: TournamentService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  getDetail(@Param('id') id: string) {
    return this.service.getDetail(id);
  }

  @Post()
  create(@Body() body: { name: string; quizId: string; teamNames: string[] }) {
    return this.service.create(body);
  }

  @Post('matches/:matchId/start')
  startMatch(@Param('matchId') matchId: string) {
    return this.service.startMatch(matchId);
  }

  @Post('matches/:matchId/complete')
  completeMatch(@Param('matchId') matchId: string) {
    return this.service.completeMatch(matchId);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
