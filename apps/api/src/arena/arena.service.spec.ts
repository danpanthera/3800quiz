import { ArenaService } from './arena.service';
import { ArenaEventBus } from './arena-event-bus';
import {
  ArenaStatus,
  ArenaRoundStatus,
  ArenaRevealReason,
  ArenaHostMode,
  Prisma,
} from '@prisma/client';

const sessionId = 'session-1';
const roundId = 'round-1';

describe('ArenaService', () => {
  beforeEach(() => {
    // Đóng băng đồng hồ hệ thống — buildRevealPayload() nhúng Date.now() vào
    // payload (serverNowMs) nên gọi 2 lần liên tiếp trong cùng 1 test phải ra
    // cùng 1 mốc, tránh test giả-flaky vì chênh vài mili-giây thực.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-09T08:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  // ─── 1. revealRound() — CAS chống công bố trùng ───────────────────────────

  describe('revealRound — CAS chống công bố trùng (không cộng điểm 2 lần)', () => {
    it('gọi reveal 2 lần liên tiếp cho cùng 1 round: lần thắng cuộc đua mới cộng điểm, lần thua thì không', async () => {
      const now = new Date('2026-09-09T08:00:00.000Z');
      const session = {
        id: sessionId,
        status: ArenaStatus.RUNNING,
        currentRoundOrder: 0,
        pointsForRank: [10, 7, 5],
        penaltyWrong: 0,
        hostMode: ArenaHostMode.MANUAL,
        revealPauseSec: 5,
        _count: { rounds: 1 },
      };
      // Round hiện tại vẫn ACTIVE ở cả 2 lần đọc ngoài transaction — mô phỏng
      // đúng tình huống đua thật: 2 lời gọi cùng đọc trạng thái TRƯỚC khi bất
      // kỳ ai kịp ghi — chỉ có updateMany() bên trong transaction mới phân
      // định được ai thắng.
      const activeRound = {
        id: roundId,
        arenaSessionId: sessionId,
        order: 0,
        questionId: 'question-1',
        status: ArenaRoundStatus.ACTIVE,
        startedAt: new Date(now.getTime() - 10_000),
        deadlineAt: now,
        revealedAt: null,
        revealReason: null,
      };
      const revealedRoundFull = {
        ...activeRound,
        status: ArenaRoundStatus.REVEALED,
        revealedAt: now,
        revealReason: ArenaRevealReason.HOST,
        question: {
          explanation: 'Giải thích đáp án',
          options: [
            { id: 'option-1', isCorrect: true },
            { id: 'option-2', isCorrect: false },
          ],
        },
        buzzes: [
          {
            teamId: 'team-1',
            isCorrect: true,
            selectedOptionIds: ['option-1'],
            responseMs: 1000,
            rawResponseMs: 1000,
            latencyMs: 20,
            speedRank: 1,
            correctRank: 1,
            pointsAwarded: 10,
            scoreBefore: 0,
            scoreAfter: 10,
          },
        ],
      };
      const teams = [
        {
          id: 'team-1',
          name: 'Đội A',
          color: '#111111',
          score: 10,
          correctCount: 1,
          totalAnswerMs: 1000,
          joinedAt: new Date('2026-09-09T07:00:00.000Z'),
        },
        {
          id: 'team-2',
          name: 'Đội B',
          color: '#222222',
          score: 0,
          correctCount: 0,
          totalAnswerMs: 0,
          joinedAt: new Date('2026-09-09T07:00:01.000Z'),
        },
      ];

      // Khoá lạc quan (CAS) thực tế nằm ở tx.arenaRound.updateMany() — lần
      // gọi đầu thắng (count:1), lần gọi sau thua (count:0).
      const txArenaRoundUpdateMany = jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const txArenaBuzzFindMany = jest.fn().mockResolvedValue([
        {
          id: 'buzz-1',
          teamId: 'team-1',
          isCorrect: true,
          responseMs: 1000,
          answeredAt: new Date(now.getTime() - 5000),
        },
      ]);
      const txArenaTeamFindUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ id: 'team-1', score: 0 });
      const txArenaBuzzUpdate = jest.fn().mockResolvedValue({});
      const txArenaTeamUpdate = jest.fn().mockResolvedValue({});
      const tx = {
        arenaRound: { updateMany: txArenaRoundUpdateMany },
        arenaBuzz: { findMany: txArenaBuzzFindMany, update: txArenaBuzzUpdate },
        arenaTeam: {
          findUniqueOrThrow: txArenaTeamFindUniqueOrThrow,
          update: txArenaTeamUpdate,
        },
      };

      const prisma = {
        arenaSession: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(session),
        },
        arenaRound: {
          // Đọc TRƯỚC transaction (kiểm tra trạng thái hiện tại)
          findUnique: jest.fn().mockResolvedValue(activeRound),
          // buildRevealPayload() đọc LẠI sau khi đã REVEALED để dựng payload
          findUniqueOrThrow: jest.fn().mockResolvedValue(revealedRoundFull),
        },
        arenaTeam: { findMany: jest.fn().mockResolvedValue(teams) },
        $transaction: jest
          .fn()
          .mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
      };

      const service = new ArenaService(
        prisma as never,
        {} as never,
        new ArenaEventBus(),
      );

      const first = await service.revealRound(sessionId);
      const second = await service.revealRound(sessionId);

      // Chỉ 1 lần cộng điểm/update team + update buzz dù gọi reveal 2 lần
      expect(txArenaTeamUpdate).toHaveBeenCalledTimes(1);
      expect(txArenaBuzzUpdate).toHaveBeenCalledTimes(1);
      expect(txArenaRoundUpdateMany).toHaveBeenCalledTimes(2);
      // Cả 2 lần đều trả về đúng 1 payload công bố (không lỗi, không lệch dữ liệu)
      expect(first).toEqual(second);
    });
  });

  // ─── 2. endSession() — CAS chống cộng XP trùng ────────────────────────────

  describe('endSession — CAS chống cộng XP trùng khi kết thúc phiên gọi trùng', () => {
    it('gọi kết thúc phiên 2 lần liên tiếp: chỉ cộng XP đúng 1 lần ở lượt thắng cuộc đua', async () => {
      const teamsList = [
        {
          id: 'team-1',
          name: 'Đội A',
          color: '#111111',
          score: 20,
          correctCount: 2,
          totalAnswerMs: 3000,
          joinedAt: new Date('2026-09-09T07:00:00.000Z'),
          rank: null,
          members: [{ userId: 'user-1' }],
        },
        {
          id: 'team-2',
          name: 'Đội B',
          color: '#222222',
          score: 10,
          correctCount: 1,
          totalAnswerMs: 4000,
          joinedAt: new Date('2026-09-09T07:00:01.000Z'),
          rank: null,
          members: [{ userId: 'user-2' }],
        },
      ];

      const prisma = {
        arenaSession: {
          // CAS thực tế: lần đầu thắng (count:1) → cộng XP; lần sau thua
          // (count:0) → chỉ trả lại kết quả đã chốt qua buildEndPayload().
          updateMany: jest
            .fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 }),
        },
        arenaTeam: {
          findMany: jest.fn().mockResolvedValue(teamsList),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const gamification = {
        updateActivity: jest.fn().mockResolvedValue(undefined),
        incrementArenaWins: jest.fn().mockResolvedValue(undefined),
        awardXp: jest
          .fn()
          .mockResolvedValue({ levelUp: false, newLevel: 1, newBadges: [] }),
      };
      const service = new ArenaService(
        prisma as never,
        gamification as never,
        new ArenaEventBus(),
      );

      await service.endSession(sessionId);
      // 2 đội, 1 người/đội: đội thắng nhận 2 lần awardXp (tham gia + vô địch),
      // đội thua nhận 1 lần (chỉ tham gia) => tổng 3 lần.
      expect(gamification.awardXp).toHaveBeenCalledTimes(3);
      expect(gamification.updateActivity).toHaveBeenCalledTimes(2);
      expect(prisma.arenaTeam.update).toHaveBeenCalledTimes(2); // ghi rank cho 2 đội

      await service.endSession(sessionId);
      // Lượt gọi thứ 2 thua cuộc đua CAS — không cộng thêm XP/hoạt động/rank
      expect(gamification.awardXp).toHaveBeenCalledTimes(3);
      expect(gamification.updateActivity).toHaveBeenCalledTimes(2);
      expect(prisma.arenaTeam.update).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 3. showQuestion() — tự động reveal câu cũ còn dang dở ────────────────

  describe('showQuestion — tự động reveal câu cũ còn ACTIVE trước khi mở câu mới', () => {
    it('câu trước còn ACTIVE (chưa công bố) thì reveal với lý do SKIPPED TRƯỚC khi mở round mới', async () => {
      const session = {
        id: sessionId,
        status: ArenaStatus.RUNNING,
        questionDurationSec: 20,
      };
      const stillActiveRound = {
        id: 'round-0',
        status: ArenaRoundStatus.ACTIVE,
      };
      const newRound = {
        id: 'round-1',
        order: 1,
        question: {
          id: 'question-2',
          content: 'Câu hỏi số 2',
          imageUrl: null,
          questionType: 'SINGLE',
          options: [],
          subject: null,
        },
      };

      // Ghi lại đúng THỨ TỰ gọi giữa reveal câu cũ và mở round mới
      const callOrder: string[] = [];
      const prisma = {
        arenaSession: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(session),
          update: jest.fn().mockResolvedValue({}),
        },
        arenaRound: {
          // Còn 1 round ACTIVE dang dở — buộc showQuestion() phải tự reveal trước
          findFirst: jest.fn().mockResolvedValue(stillActiveRound),
          findUnique: jest.fn().mockResolvedValue(newRound),
          update: jest.fn().mockImplementation(() => {
            callOrder.push('mo-round-moi');
            return Promise.resolve({});
          }),
          count: jest.fn().mockResolvedValue(2),
        },
        arenaTeam: { count: jest.fn().mockResolvedValue(2) },
      };
      const service = new ArenaService(
        prisma as never,
        {} as never,
        new ArenaEventBus(),
      );
      // Cô lập revealRound() — hành vi CAS/chấm điểm của nó đã được kiểm chứng
      // riêng ở bộ test #1, ở đây chỉ cần xác nhận nó ĐƯỢC gọi đúng lúc/đúng lý do.
      const revealSpy = jest
        .spyOn(service, 'revealRound')
        .mockImplementation(() => {
          callOrder.push('reveal-cau-cu');
          return Promise.resolve({} as never);
        });

      await service.showQuestion(sessionId, 1);

      expect(revealSpy).toHaveBeenCalledWith(sessionId, {
        reason: ArenaRevealReason.SKIPPED,
      });
      expect(callOrder).toEqual(['reveal-cau-cu', 'mo-round-moi']);
    });
  });

  // ─── 4. recordAnswer() — deadline + ân hạn (grace) ────────────────────────

  describe('recordAnswer — kiểm tra deadline + ân hạn (grace do client tự tính bù trễ)', () => {
    const startedAt = new Date('2026-09-09T08:00:00.000Z');
    const deadlineAt = new Date('2026-09-09T08:00:20.000Z'); // +20s

    function buildPrisma() {
      const round = {
        id: 'round-1',
        arenaSessionId: sessionId,
        status: ArenaRoundStatus.ACTIVE,
        startedAt,
        deadlineAt,
        question: {
          questionType: 'SINGLE',
          options: [
            { id: 'option-1', isCorrect: true, orderIndex: 1 },
            { id: 'option-2', isCorrect: false, orderIndex: 2 },
          ],
        },
      };
      const membership = {
        arenaTeamId: 'team-1',
        arenaTeam: { id: 'team-1', name: 'Đội A', color: '#111111' },
      };
      return {
        arenaRound: { findUnique: jest.fn().mockResolvedValue(round) },
        arenaTeamMember: {
          findUnique: jest.fn().mockResolvedValue(membership),
        },
        arenaBuzz: {
          create: jest
            .fn()
            .mockResolvedValue({ id: 'buzz-1', isCorrect: true }),
          count: jest.fn().mockResolvedValue(1),
        },
        arenaTeam: { count: jest.fn().mockResolvedValue(2) },
      };
    }

    it('trả lời TRONG khoảng ân hạn (deadline + 300ms, ân hạn 400ms) thì được chấp nhận', async () => {
      const prisma = buildPrisma();
      const service = new ArenaService(
        prisma as never,
        {} as never,
        new ArenaEventBus(),
      );

      const result = await service.recordAnswer({
        arenaRoundId: 'round-1',
        userId: 'user-1',
        selectedOptionIds: ['option-1'],
        receivedAtMs: deadlineAt.getTime() + 300,
        latencyMs: 50,
        getCompensationMs: () => 400,
      });

      expect(result.isCorrect).toBe(true);
      expect(prisma.arenaBuzz.create).toHaveBeenCalledTimes(1);
    });

    it('trả lời VƯỢT QUÁ deadline + ân hạn (deadline + 500ms, ân hạn 400ms) thì bị từ chối', async () => {
      const prisma = buildPrisma();
      const service = new ArenaService(
        prisma as never,
        {} as never,
        new ArenaEventBus(),
      );

      await expect(
        service.recordAnswer({
          arenaRoundId: 'round-1',
          userId: 'user-1',
          selectedOptionIds: ['option-1'],
          receivedAtMs: deadlineAt.getTime() + 500,
          latencyMs: 50,
          getCompensationMs: () => 400,
        }),
      ).rejects.toThrow('Đã hết giờ trả lời câu này');
      expect(prisma.arenaBuzz.create).not.toHaveBeenCalled();
    });
  });

  // ─── 5. recordAnswer() — bấm trùng do đua race (P2002) ────────────────────

  describe('recordAnswer — bấm trùng do đua race (unique constraint P2002)', () => {
    it('bắt lỗi P2002 từ arenaBuzz.create và ném lại lỗi tiếng Việt, không lộ lỗi Prisma thô', async () => {
      const startedAt = new Date('2026-09-09T08:00:00.000Z');
      const deadlineAt = new Date('2026-09-09T08:00:20.000Z');
      const round = {
        id: 'round-1',
        arenaSessionId: sessionId,
        status: ArenaRoundStatus.ACTIVE,
        startedAt,
        deadlineAt,
        question: {
          questionType: 'SINGLE',
          options: [{ id: 'option-1', isCorrect: true, orderIndex: 1 }],
        },
      };
      const membership = {
        arenaTeamId: 'team-1',
        arenaTeam: { id: 'team-1', name: 'Đội A', color: '#111111' },
      };
      // P2002 giả lập ĐÚNG kiểu lỗi thật của Prisma — bắt buộc dùng instanceof
      // Prisma.PrismaClientKnownRequestError như code thật đang kiểm tra.
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`arena_round_id`,`team_id`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      );
      const prisma = {
        arenaRound: { findUnique: jest.fn().mockResolvedValue(round) },
        arenaTeamMember: {
          findUnique: jest.fn().mockResolvedValue(membership),
        },
        arenaBuzz: { create: jest.fn().mockRejectedValue(prismaError) },
      };
      const service = new ArenaService(
        prisma as never,
        {} as never,
        new ArenaEventBus(),
      );

      await expect(
        service.recordAnswer({
          arenaRoundId: 'round-1',
          userId: 'user-1',
          selectedOptionIds: ['option-1'],
          receivedAtMs: startedAt.getTime() + 1000,
          latencyMs: 10,
          getCompensationMs: () => 0,
        }),
      ).rejects.toThrow('Đội bạn đã gửi đáp án cho câu này rồi');
    });
  });

  // ─── 6. joinTeam() — vào lại đội cũ khi phiên đã đang chạy ────────────────

  describe('joinTeam — cho vào lại đội cũ dù phiên không còn ở LOBBY', () => {
    it('đã là thành viên cũ và phiên đang RUNNING thì trả về đúng đội cũ, không báo lỗi "đã bắt đầu"', async () => {
      const session = {
        id: sessionId,
        joinCode: 'ABC123',
        status: ArenaStatus.RUNNING, // KHÔNG phải LOBBY
        passcode: null,
        teams: [],
        invites: [],
      };
      const oldTeam = {
        id: 'team-1',
        name: 'Đội cũ',
        color: '#111111',
        members: [
          {
            userId: 'user-1',
            user: { id: 'user-1', fullName: 'Nguyễn Văn A' },
          },
        ],
      };
      const prisma = {
        arenaSession: { findUnique: jest.fn().mockResolvedValue(session) },
        arenaTeamMember: {
          findUnique: jest.fn().mockResolvedValue({
            arenaTeamId: 'team-1',
            arenaTeam: oldTeam,
          }),
          create: jest.fn(),
        },
        arenaTeam: { create: jest.fn() },
      };
      const service = new ArenaService(
        prisma as never,
        {} as never,
        new ArenaEventBus(),
      );

      const result = await service.joinTeam('ABC123', 'user-1', {});

      expect(result.rejoined).toBe(true);
      expect(result.team).toEqual(oldTeam);
      expect(prisma.arenaTeamMember.create).not.toHaveBeenCalled();
      expect(prisma.arenaTeam.create).not.toHaveBeenCalled();
    });
  });
});
