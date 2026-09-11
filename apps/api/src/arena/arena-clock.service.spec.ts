import { ArenaClockService } from './arena-clock.service';
import { ArenaEventBus } from './arena-event-bus';
import {
  ArenaHostMode,
  ArenaRoundStatus,
  ArenaRevealReason,
} from '@prisma/client';
import type { ArenaService } from './arena.service';

describe('ArenaClockService', () => {
  let bus: ArenaEventBus;
  let service: {
    revealRound: jest.Mock;
    nextQuestion: jest.Mock;
  };
  let clock: ArenaClockService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-08T08:00:00.000Z'));
    bus = new ArenaEventBus();
    service = {
      revealRound: jest.fn().mockResolvedValue(undefined),
      nextQuestion: jest.fn().mockResolvedValue(undefined),
    };
    clock = new ArenaClockService(service as unknown as ArenaService, bus);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nhận sự kiện question thì hẹn revealRound đúng lúc deadlineAtMs + 400ms', async () => {
    const now = Date.now();
    bus.publish({
      kind: 'question',
      sessionId: 's1',
      payload: {
        roundId: 'r1',
        deadlineAtMs: now + 15000,
      } as never,
    });

    await jest.advanceTimersByTimeAsync(15399);
    expect(service.revealRound).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(service.revealRound).toHaveBeenCalledTimes(1);
    expect(service.revealRound).toHaveBeenCalledWith('s1', {
      reason: ArenaRevealReason.DEADLINE,
    });
  });

  it('công bố sớm (revealed) huỷ timer deadline — revealRound không bị gọi lần hai', () => {
    const now = Date.now();
    bus.publish({
      kind: 'question',
      sessionId: 's1',
      payload: { roundId: 'r1', deadlineAtMs: now + 15000 } as never,
    });

    // MC công bố sớm ở giây thứ 3 — huỷ timer deadline vì không có nextAtMs (MANUAL)
    bus.publish({
      kind: 'revealed',
      sessionId: 's1',
      payload: { roundId: 'r1', nextAtMs: null } as never,
    });

    jest.advanceTimersByTime(20000);
    expect(service.revealRound).not.toHaveBeenCalled();
  });

  it('AUTO: revealed có nextAtMs thì hẹn nextQuestion đúng lúc', () => {
    const now = Date.now();
    bus.publish({
      kind: 'revealed',
      sessionId: 's1',
      payload: { roundId: 'r1', nextAtMs: now + 5000 } as never,
    });

    jest.advanceTimersByTime(4999);
    expect(service.nextQuestion).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(service.nextQuestion).toHaveBeenCalledWith('s1');
  });

  it('MANUAL: revealed không có nextAtMs thì không hẹn gì', () => {
    bus.publish({
      kind: 'revealed',
      sessionId: 's1',
      payload: { roundId: 'r1', nextAtMs: null } as never,
    });

    jest.advanceTimersByTime(60000);
    expect(service.nextQuestion).not.toHaveBeenCalled();
  });

  it('ended xoá sạch timer đang chờ', () => {
    const now = Date.now();
    bus.publish({
      kind: 'question',
      sessionId: 's1',
      payload: { roundId: 'r1', deadlineAtMs: now + 15000 } as never,
    });
    bus.publish({ kind: 'ended', sessionId: 's1', payload: {} as never });

    jest.advanceTimersByTime(20000);
    expect(service.revealRound).not.toHaveBeenCalled();
  });

  it('cancelled xoá sạch timer đang chờ', () => {
    const now = Date.now();
    bus.publish({
      kind: 'question',
      sessionId: 's1',
      payload: { roundId: 'r1', deadlineAtMs: now + 15000 } as never,
    });
    bus.publish({ kind: 'cancelled', sessionId: 's1' });

    jest.advanceTimersByTime(20000);
    expect(service.revealRound).not.toHaveBeenCalled();
  });

  it('đặt timer mới cho cùng 1 phiên tự huỷ timer cũ (không bao giờ có 2 timer)', async () => {
    const now = Date.now();
    bus.publish({
      kind: 'question',
      sessionId: 's1',
      payload: { roundId: 'r1', deadlineAtMs: now + 15000 } as never,
    });
    // Câu kế mở ra trước khi câu trước kịp bắn (trường hợp lý thuyết) — timer cũ phải bị thay
    bus.publish({
      kind: 'question',
      sessionId: 's1',
      payload: { roundId: 'r2', deadlineAtMs: now + 20000 } as never,
    });

    await jest.advanceTimersByTimeAsync(15400);
    expect(service.revealRound).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);
    expect(service.revealRound).toHaveBeenCalledTimes(1);
    expect(service.revealRound).toHaveBeenCalledWith('s1', {
      reason: ArenaRevealReason.DEADLINE,
    });
  });

  describe('resumeAfterRestart', () => {
    it('round ACTIVE còn hạn thì hẹn phần thời gian còn lại', async () => {
      const now = Date.now();
      await clock.resumeAfterRestart(() =>
        Promise.resolve([
          {
            id: 's1',
            hostMode: ArenaHostMode.AUTO,
            revealPauseSec: 5,
            currentRound: {
              id: 'r1',
              status: ArenaRoundStatus.ACTIVE,
              deadlineAt: new Date(now + 3000),
              revealedAt: null,
            },
          },
        ]),
      );

      expect(service.revealRound).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(3400);
      expect(service.revealRound).toHaveBeenCalledWith('s1', {
        reason: ArenaRevealReason.DEADLINE,
      });
    });

    it('round ACTIVE đã quá hạn thì công bố ngay lập tức', async () => {
      const now = Date.now();
      await clock.resumeAfterRestart(() =>
        Promise.resolve([
          {
            id: 's1',
            hostMode: ArenaHostMode.MANUAL,
            revealPauseSec: 5,
            currentRound: {
              id: 'r1',
              status: ArenaRoundStatus.ACTIVE,
              deadlineAt: new Date(now - 10000),
              revealedAt: null,
            },
          },
        ]),
      );
      expect(service.revealRound).toHaveBeenCalledWith('s1', {
        reason: ArenaRevealReason.DEADLINE,
      });
    });

    it('AUTO + REVEALED còn trong khoảng nghỉ thì hẹn nextQuestion phần còn lại', async () => {
      const now = Date.now();
      await clock.resumeAfterRestart(() =>
        Promise.resolve([
          {
            id: 's1',
            hostMode: ArenaHostMode.AUTO,
            revealPauseSec: 5,
            currentRound: {
              id: 'r1',
              status: ArenaRoundStatus.REVEALED,
              deadlineAt: null,
              revealedAt: new Date(now - 2000), // đã công bố 2s trước, còn 3s nữa
            },
          },
        ]),
      );
      expect(service.nextQuestion).not.toHaveBeenCalled();
      jest.advanceTimersByTime(3100);
      expect(service.nextQuestion).toHaveBeenCalledWith('s1');
    });

    it('MANUAL + REVEALED thì không làm gì (chờ MC bấm)', async () => {
      const now = Date.now();
      await clock.resumeAfterRestart(() =>
        Promise.resolve([
          {
            id: 's1',
            hostMode: ArenaHostMode.MANUAL,
            revealPauseSec: 5,
            currentRound: {
              id: 'r1',
              status: ArenaRoundStatus.REVEALED,
              deadlineAt: null,
              revealedAt: new Date(now - 2000),
            },
          },
        ]),
      );
      jest.advanceTimersByTime(60000);
      expect(service.nextQuestion).not.toHaveBeenCalled();
      expect(service.revealRound).not.toHaveBeenCalled();
    });

    it('1 phiên lỗi không chặn việc khôi phục các phiên khác', async () => {
      const now = Date.now();
      service.revealRound.mockRejectedValueOnce(new Error('lỗi giả lập'));
      await clock.resumeAfterRestart(() =>
        Promise.resolve([
          {
            id: 's-loi',
            hostMode: ArenaHostMode.MANUAL,
            revealPauseSec: 5,
            currentRound: {
              id: 'r1',
              status: ArenaRoundStatus.ACTIVE,
              deadlineAt: new Date(now - 1000),
              revealedAt: null,
            },
          },
          {
            id: 's-ok',
            hostMode: ArenaHostMode.MANUAL,
            revealPauseSec: 5,
            currentRound: {
              id: 'r2',
              status: ArenaRoundStatus.ACTIVE,
              deadlineAt: new Date(now - 1000),
              revealedAt: null,
            },
          },
        ]),
      );
      expect(service.revealRound).toHaveBeenCalledWith('s-ok', {
        reason: ArenaRevealReason.DEADLINE,
      });
    });
  });
});
