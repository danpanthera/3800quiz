import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ArenaService } from '../arena/arena.service';
import { ArenaHostModeDto } from '../arena/dto/create-arena.dto';

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

@Injectable()
export class TournamentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arenaService: ArenaService,
  ) {}

  list() {
    return this.prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        quiz: { select: { title: true } },
        teams: true,
        matches: { orderBy: [{ round: 'asc' }, { orderInRound: 'asc' }] },
      },
    });
  }

  async getDetail(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        quiz: { select: { title: true } },
        teams: true,
        matches: { orderBy: [{ round: 'asc' }, { orderInRound: 'asc' }] },
      },
    });
    if (!tournament) throw new NotFoundException('Giải đấu không tồn tại');
    return tournament;
  }

  // Yêu cầu số đội là luỹ thừa của 2 (2/4/8/16...) để bốc thăm loại trực tiếp
  // không cần đội "bye" (miễn thi đấu vòng đầu) — giữ MVP đơn giản, admin tự
  // điều chỉnh số đội đăng ký cho tròn.
  async create(data: { name: string; quizId: string; teamNames: string[] }) {
    const names = [
      ...new Set(data.teamNames.map((n) => n.trim()).filter(Boolean)),
    ];
    if (!isPowerOfTwo(names.length)) {
      throw new BadRequestException(
        `Số đội phải là luỹ thừa của 2 (2, 4, 8, 16...) — hiện có ${names.length} đội hợp lệ`,
      );
    }

    const totalRounds = Math.log2(names.length);

    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.create({
        data: {
          name: data.name,
          quizId: data.quizId,
          status: 'RUNNING',
          totalRounds,
          currentRound: 1,
        },
      });

      const teams = await Promise.all(
        names.map((name, idx) =>
          tx.tournamentTeam.create({
            data: { tournamentId: tournament.id, name, seed: idx + 1 },
          }),
        ),
      );

      // Vòng 1: ghép lần lượt theo hạt giống 1v2, 3v4, ... — đã đủ 2 đội nên READY ngay.
      for (let i = 0; i < teams.length; i += 2) {
        await tx.tournamentMatch.create({
          data: {
            tournamentId: tournament.id,
            round: 1,
            orderInRound: i / 2,
            team1Id: teams[i].id,
            team2Id: teams[i + 1].id,
            status: 'READY',
          },
        });
      }

      // Các vòng sau: tạo sẵn khung trận rỗng (chờ đội thắng vòng trước tiến vào).
      let matchesInRound = teams.length / 2;
      for (let round = 2; round <= totalRounds; round++) {
        matchesInRound = matchesInRound / 2;
        for (let order = 0; order < matchesInRound; order++) {
          await tx.tournamentMatch.create({
            data: { tournamentId: tournament.id, round, orderInRound: order },
          });
        }
      }

      return tx.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        include: {
          teams: true,
          matches: { orderBy: [{ round: 'asc' }, { orderInRound: 'asc' }] },
        },
      });
    });
  }

  // Tạo 1 ArenaSession với đúng 2 đội của trận này rồi gắn vào match — từ đây
  // trận đấu diễn ra HOÀN TOÀN qua cỗ máy Đấu trường có sẵn (MC vào /manage/arena
  // vận hành như 1 phiên bình thường), module này không biết gì về buzz/reveal.
  async startMatch(matchId: string) {
    const match = await this.prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });
    if (!match) throw new NotFoundException('Trận đấu không tồn tại');
    if (match.status !== 'READY')
      throw new BadRequestException(
        'Trận đấu chưa đủ 2 đội hoặc đã bắt đầu/kết thúc',
      );

    const teams = await this.prisma.tournamentTeam.findMany({
      where: { id: { in: [match.team1Id!, match.team2Id!] } },
    });
    const team1 = teams.find((t) => t.id === match.team1Id);
    const team2 = teams.find((t) => t.id === match.team2Id);
    if (!team1 || !team2)
      throw new BadRequestException('Không xác định được 2 đội của trận đấu');

    const session = await this.arenaService.createSession({
      name: `${match.tournament.name} — Vòng ${match.round} — Trận ${match.orderInRound + 1}`,
      quizId: match.tournament.quizId,
      hostMode: ArenaHostModeDto.MANUAL,
      presetTeamNames: [team1.name, team2.name],
    });

    await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { arenaSessionId: session.id, status: 'RUNNING' },
    });

    return { arenaSessionId: session.id, joinCode: session.joinCode };
  }

  // Đọc kết quả ArenaSession đã FINISHED để xác định đội thắng (rank=1), loại
  // đội thua, và đẩy đội thắng vào đúng ô của trận vòng kế tiếp.
  async completeMatch(matchId: string) {
    const match = await this.prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });
    if (!match) throw new NotFoundException('Trận đấu không tồn tại');
    if (match.status !== 'RUNNING' || !match.arenaSessionId)
      throw new BadRequestException('Trận đấu chưa được bắt đầu');

    const session = await this.arenaService.getSessionDetail(
      match.arenaSessionId,
    );
    if (session.status !== 'FINISHED')
      throw new BadRequestException(
        'Phiên Đấu trường của trận này chưa kết thúc',
      );

    const winnerRow = (
      session.teams as { id: string; name: string; rank: number | null }[]
    ).find((t) => t.rank === 1);
    if (!winnerRow)
      throw new BadRequestException(
        'Phiên Đấu trường chưa xác định được đội thắng (chưa xếp hạng)',
      );

    const teams = await this.prisma.tournamentTeam.findMany({
      where: { id: { in: [match.team1Id!, match.team2Id!] } },
    });
    const winner = teams.find((t) => t.name === winnerRow.name);
    if (!winner)
      throw new BadRequestException(
        'Không khớp được đội thắng của phiên Đấu trường với đội trong giải đấu',
      );
    const loser = teams.find((t) => t.id !== winner.id)!;

    await this.prisma.$transaction(async (tx) => {
      await tx.tournamentMatch.update({
        where: { id: matchId },
        data: { winnerTeamId: winner.id, status: 'DONE' },
      });
      await tx.tournamentTeam.update({
        where: { id: loser.id },
        data: { isEliminated: true },
      });

      const nextRound = match.round + 1;
      if (nextRound > match.tournament.totalRounds) {
        await tx.tournament.update({
          where: { id: match.tournamentId },
          data: { status: 'FINISHED', championTeamId: winner.id },
        });
        return;
      }

      const nextOrderInRound = Math.floor(match.orderInRound / 2);
      const nextMatch = await tx.tournamentMatch.findUniqueOrThrow({
        where: {
          tournamentId_round_orderInRound: {
            tournamentId: match.tournamentId,
            round: nextRound,
            orderInRound: nextOrderInRound,
          },
        },
      });
      const slot = match.orderInRound % 2 === 0 ? 'team1Id' : 'team2Id';
      const updatedSlots = { ...nextMatch, [slot]: winner.id };
      const bothReady = Boolean(updatedSlots.team1Id && updatedSlots.team2Id);

      await tx.tournamentMatch.update({
        where: { id: nextMatch.id },
        data: {
          [slot]: winner.id,
          status: bothReady ? 'READY' : 'PENDING',
        },
      });
      await tx.tournament.update({
        where: { id: match.tournamentId },
        data: { currentRound: nextRound },
      });
    });

    return this.getDetail(match.tournamentId);
  }

  async delete(id: string) {
    await this.prisma.tournament.delete({ where: { id } });
    return { deleted: true };
  }
}
