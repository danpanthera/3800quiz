import { BadRequestException } from '@nestjs/common';
import { TournamentService } from './tournament.service';

function buildPrismaMock() {
  const tournamentMatches = new Map<string, any>();
  const tournamentTeams = new Map<string, any>();
  let matchSeq = 0;
  let teamSeq = 0;

  const prisma = {
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    tournament: {
      create: jest.fn().mockResolvedValue({ id: 'tour-1' }),
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    tournamentTeam: {
      create: jest.fn((args: any) => {
        teamSeq += 1;
        const team = { id: `team-${teamSeq}`, ...args.data };
        tournamentTeams.set(team.id, team);
        return Promise.resolve(team);
      }),
      findMany: jest.fn((args: any) =>
        Promise.resolve(
          [...tournamentTeams.values()].filter((t) =>
            args.where.id.in.includes(t.id),
          ),
        ),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    tournamentMatch: {
      create: jest.fn((args: any) => {
        matchSeq += 1;
        const match = { id: `match-${matchSeq}`, ...args.data };
        tournamentMatches.set(match.id, match);
        return Promise.resolve(match);
      }),
      findUnique: jest.fn((args: any) =>
        Promise.resolve(tournamentMatches.get(args.where.id) ?? null),
      ),
      findUniqueOrThrow: jest.fn((args: any) => {
        if (args.where.id)
          return Promise.resolve(tournamentMatches.get(args.where.id));
        const key = args.where.tournamentId_round_orderInRound;
        const found = [...tournamentMatches.values()].find(
          (m) =>
            m.tournamentId === key.tournamentId &&
            m.round === key.round &&
            m.orderInRound === key.orderInRound,
        );
        return Promise.resolve(found);
      }),
      update: jest.fn((args: any) => {
        const existing = tournamentMatches.get(args.where.id);
        const updated = { ...existing, ...args.data };
        tournamentMatches.set(args.where.id, updated);
        return Promise.resolve(updated);
      }),
    },
  };
  return { prisma, tournamentMatches, tournamentTeams };
}

describe('TournamentService', () => {
  it('create: số đội không phải luỹ thừa 2 → BadRequestException', async () => {
    const { prisma } = buildPrismaMock();
    const arenaService = {
      createSession: jest.fn(),
      getSessionDetail: jest.fn(),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );

    await expect(
      service.create({
        name: 'Giải 1',
        quizId: 'quiz-1',
        teamNames: ['A', 'B', 'C'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create: 4 đội → 1 trận vòng 1 READY x2, 1 trận vòng 2 PENDING', async () => {
    const { prisma } = buildPrismaMock();
    const arenaService = {
      createSession: jest.fn(),
      getSessionDetail: jest.fn(),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );

    await service.create({
      name: 'Giải 4 đội',
      quizId: 'quiz-1',
      teamNames: ['A', 'B', 'C', 'D'],
    });

    const round1 = [...prisma.tournamentMatch.create.mock.calls]
      .map((c) => c[0].data)
      .filter((d) => d.round === 1);
    const round2 = [...prisma.tournamentMatch.create.mock.calls]
      .map((c) => c[0].data)
      .filter((d) => d.round === 2);
    expect(round1).toHaveLength(2);
    expect(round1.every((m) => m.status === 'READY')).toBe(true);
    expect(round2).toHaveLength(1);
    expect(round2[0].status).toBeUndefined(); // mặc định PENDING theo schema
  });

  it('startMatch: trận chưa READY → BadRequestException', async () => {
    const { prisma, tournamentMatches } = buildPrismaMock();
    tournamentMatches.set('m-1', {
      id: 'm-1',
      status: 'PENDING',
      tournament: { name: 'Giải 1', quizId: 'quiz-1' },
    });
    const arenaService = {
      createSession: jest.fn(),
      getSessionDetail: jest.fn(),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );

    await expect(service.startMatch('m-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('startMatch: tạo ArenaSession với đúng 2 tên đội, gắn vào match', async () => {
    const { prisma, tournamentMatches, tournamentTeams } = buildPrismaMock();
    tournamentTeams.set('t-1', { id: 't-1', name: 'Đội A' });
    tournamentTeams.set('t-2', { id: 't-2', name: 'Đội B' });
    tournamentMatches.set('m-1', {
      id: 'm-1',
      round: 1,
      orderInRound: 0,
      team1Id: 't-1',
      team2Id: 't-2',
      status: 'READY',
      tournamentId: 'tour-1',
      tournament: { name: 'Giải 1', quizId: 'quiz-1', totalRounds: 2 },
    });
    const arenaService = {
      createSession: jest
        .fn()
        .mockResolvedValue({ id: 'arena-1', joinCode: 'ABC123' }),
      getSessionDetail: jest.fn(),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );

    const result = await service.startMatch('m-1');

    expect(arenaService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        presetTeamNames: ['Đội A', 'Đội B'],
        quizId: 'quiz-1',
      }),
    );
    expect(result).toEqual({ arenaSessionId: 'arena-1', joinCode: 'ABC123' });
    expect(tournamentMatches.get('m-1').status).toBe('RUNNING');
  });

  it('completeMatch: đội thắng tiến vào đúng ô trận vòng kế tiếp', async () => {
    const { prisma, tournamentMatches, tournamentTeams } = buildPrismaMock();
    tournamentTeams.set('t-1', {
      id: 't-1',
      name: 'Đội A',
      isEliminated: false,
    });
    tournamentTeams.set('t-2', {
      id: 't-2',
      name: 'Đội B',
      isEliminated: false,
    });
    tournamentMatches.set('m-1', {
      id: 'm-1',
      round: 1,
      orderInRound: 0,
      team1Id: 't-1',
      team2Id: 't-2',
      status: 'RUNNING',
      arenaSessionId: 'arena-1',
      tournamentId: 'tour-1',
      tournament: { totalRounds: 2 },
    });
    tournamentMatches.set('m-2', {
      id: 'm-2',
      round: 2,
      orderInRound: 0,
      team1Id: null,
      team2Id: null,
      status: 'PENDING',
      tournamentId: 'tour-1',
    });
    const arenaService = {
      createSession: jest.fn(),
      getSessionDetail: jest.fn().mockResolvedValue({
        status: 'FINISHED',
        teams: [
          { id: 'arena-team-1', name: 'Đội A', rank: 1 },
          { id: 'arena-team-2', name: 'Đội B', rank: 2 },
        ],
      }),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );
    jest.spyOn(service, 'getDetail').mockResolvedValue({} as never);

    await service.completeMatch('m-1');

    expect(tournamentMatches.get('m-1').winnerTeamId).toBe('t-1');
    expect(tournamentMatches.get('m-1').status).toBe('DONE');
    expect(tournamentMatches.get('m-2').team1Id).toBe('t-1');
    expect(tournamentMatches.get('m-2').status).toBe('PENDING'); // vẫn thiếu team2Id
  });

  it('completeMatch: trận CHUNG KẾT → tournament FINISHED, gắn championTeamId', async () => {
    const { prisma, tournamentMatches, tournamentTeams } = buildPrismaMock();
    tournamentTeams.set('t-1', { id: 't-1', name: 'Đội A' });
    tournamentTeams.set('t-2', { id: 't-2', name: 'Đội B' });
    tournamentMatches.set('m-final', {
      id: 'm-final',
      round: 2,
      orderInRound: 0,
      team1Id: 't-1',
      team2Id: 't-2',
      status: 'RUNNING',
      arenaSessionId: 'arena-1',
      tournamentId: 'tour-1',
      tournament: { totalRounds: 2 },
    });
    const arenaService = {
      createSession: jest.fn(),
      getSessionDetail: jest.fn().mockResolvedValue({
        status: 'FINISHED',
        teams: [
          { id: 'x', name: 'Đội A', rank: 1 },
          { id: 'y', name: 'Đội B', rank: 2 },
        ],
      }),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );
    jest.spyOn(service, 'getDetail').mockResolvedValue({} as never);

    await service.completeMatch('m-final');

    expect(prisma.tournament.update).toHaveBeenCalledWith({
      where: { id: 'tour-1' },
      data: { status: 'FINISHED', championTeamId: 't-1' },
    });
  });

  it('completeMatch: phiên Đấu trường chưa FINISHED → BadRequestException', async () => {
    const { prisma, tournamentMatches, tournamentTeams } = buildPrismaMock();
    tournamentTeams.set('t-1', { id: 't-1', name: 'Đội A' });
    tournamentTeams.set('t-2', { id: 't-2', name: 'Đội B' });
    tournamentMatches.set('m-1', {
      id: 'm-1',
      round: 1,
      orderInRound: 0,
      team1Id: 't-1',
      team2Id: 't-2',
      status: 'RUNNING',
      arenaSessionId: 'arena-1',
      tournamentId: 'tour-1',
      tournament: { totalRounds: 1 },
    });
    const arenaService = {
      createSession: jest.fn(),
      getSessionDetail: jest
        .fn()
        .mockResolvedValue({ status: 'RUNNING', teams: [] }),
    };
    const service = new TournamentService(
      prisma as never,
      arenaService as never,
    );

    await expect(service.completeMatch('m-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
