import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaModule } from '../arena/arena.module';
import { TournamentController } from './tournament.controller';
import { TournamentService } from './tournament.service';

@Module({
  imports: [AuthModule, ArenaModule],
  controllers: [TournamentController],
  providers: [TournamentService],
})
export class TournamentModule {}
