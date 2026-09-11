// Đồng hồ do SERVER làm chủ cho Đấu trường — hẹn giờ tự khoá/công bố khi hết
// giờ trả lời, và tự chuyển câu kế ở chế độ AUTO sau khoảng nghỉ xem kết quả.
//
// Chạy hẹn giờ TRONG TIẾN TRÌNH (setTimeout + .unref()), nhất quán với ràng
// buộc "chỉ 1 instance API" (docker-compose.prod.yml) và đúng khuôn mẫu
// attempts.service.ts (OnModuleInit/OnModuleDestroy quét bằng setInterval).
//
// Không inject ArenaGateway để tránh vòng phụ thuộc — subscribe ArenaEventBus
// thay vì gọi thẳng gateway; ArenaGateway cũng subscribe cùng bus đó để phát
// sự kiện WebSocket. Đồ thị phụ thuộc: ArenaClockService → ArenaService,
// ArenaEventBus (không phụ thuộc ngược).

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ArenaRevealReason,
  ArenaRoundStatus,
  ArenaHostMode,
} from '@prisma/client';
import { ArenaEventBus } from './arena-event-bus';
import { ArenaService } from './arena.service';
import type { ArenaOutgoing } from './arena.types';

// Khoá theo logic ĐÚNG tại deadlineAt ("arena.locked" phát ngay lúc này,
// recordAnswer từ chối mọi đáp án đến sau mốc này), nhưng công bố VẬT LÝ trễ
// hơn 400ms để gói tin của người bấm sát nút kịp hạ cánh trước khi server
// chốt điểm. Hai mốc phải tách riêng — đây là mấu chốt công bằng của toàn bộ
// cơ chế đếm giờ.
const LOCK_GRACE_MS = 400;
// Trần setTimeout của Node (2^31 - 1 ms) — phòng trường hợp deadline quá xa
// (không nên xảy ra trong thực tế nhưng tránh timer bị overflow im lặng).
const MAX_TIMEOUT_MS = 2_147_483_000;

type PendingKind = 'prepare' | 'deadline' | 'autoNext';

interface Pending {
  kind: PendingKind;
  roundId: string;
  firesAtMs: number;
  handle: NodeJS.Timeout;
}

export interface RunningSessionForResume {
  id: string;
  hostMode: ArenaHostMode;
  revealPauseSec: number;
  currentRound: {
    id: string;
    status: ArenaRoundStatus;
    deadlineAt: Date | null;
    revealedAt: Date | null;
  } | null;
}

@Injectable()
export class ArenaClockService implements OnModuleDestroy {
  private readonly logger = new Logger(ArenaClockService.name);
  // Mỗi phiên chỉ có tối đa MỘT hẹn giờ đang chờ — đặt cái mới tự huỷ cái cũ,
  // không bao giờ có 2 timer cùng bắn cho một phiên.
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly service: ArenaService,
    private readonly bus: ArenaEventBus,
  ) {
    this.bus.stream$.subscribe((event) => {
      try {
        this.onEvent(event);
      } catch (err) {
        this.logger.error(
          `Lỗi xử lý sự kiện Arena trong ArenaClockService: ${(err as Error)?.message}`,
        );
      }
    });
  }

  private onEvent(event: ArenaOutgoing): void {
    switch (event.kind) {
      case 'preparing':
        // Pha "chuẩn bị" (báo lĩnh vực trước khi bật câu) — hẹn giờ gọi
        // showQuestion() thật sự sau đúng prepareSec giây. Round vẫn PENDING
        // suốt lúc chờ nên recordAnswer()/revealRound() tự chối, không cần
        // thêm trạng thái riêng cho pha này.
        this.arm(
          event.sessionId,
          'prepare',
          event.payload.roundId,
          Date.now() + event.payload.prepareSec * 1000,
          () => this.service.showQuestion(event.sessionId, event.payload.order),
        );
        break;
      case 'question':
        // Bất kể câu hỏi mở từ đâu (MC bấm, timer tự next, REST) đều tự lên
        // lịch — không có đường nào "quên" hẹn giờ.
        this.scheduleDeadline(
          event.sessionId,
          event.payload.roundId,
          event.payload.deadlineAtMs,
        );
        break;
      case 'revealed':
        if (event.payload.nextAtMs != null) {
          this.arm(
            event.sessionId,
            'autoNext',
            event.payload.roundId,
            event.payload.nextAtMs,
            () => this.service.nextQuestion(event.sessionId),
          );
        } else {
          this.clear(event.sessionId);
        }
        break;
      case 'ended':
      case 'cancelled':
        this.clear(event.sessionId);
        break;
      default:
        break;
    }
  }

  /**
   * Hẹn đúng mốc deadlineAtMs: khi bắn, phát 'locked' NGAY (client khoá nút
   * tức thì), rồi chờ thêm LOCK_GRACE_MS để gói đáp án đang bay kịp hạ cánh,
   * mới thật sự gọi revealRound. revealRound tự idempotent (CAS trên
   * round.status) nên nếu MC đã công bố sớm trong lúc chờ, bước gọi lại này
   * chỉ là no-op — an toàn tuyệt đối không cộng điểm 2 lần.
   */
  private scheduleDeadline(
    sessionId: string,
    roundId: string,
    deadlineAtMs: number,
  ): void {
    this.arm(sessionId, 'deadline', roundId, deadlineAtMs, async () => {
      this.bus.publish({
        kind: 'locked',
        sessionId,
        roundId,
        serverNowMs: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, LOCK_GRACE_MS));
      await this.service.revealRound(sessionId, {
        reason: ArenaRevealReason.DEADLINE,
      });
    });
  }

  private arm(
    sessionId: string,
    kind: PendingKind,
    roundId: string,
    firesAtMs: number,
    run: () => Promise<unknown>,
  ): void {
    this.clear(sessionId);
    const delay = Math.max(0, Math.min(firesAtMs - Date.now(), MAX_TIMEOUT_MS));
    const handle = setTimeout(() => {
      this.pending.delete(sessionId);
      void run().catch((err) => {
        this.logger.warn(
          `Hẹn giờ ${kind} của phiên ${sessionId} thất bại: ${(err as Error)?.message}`,
        );
      });
    }, delay);
    handle.unref();
    this.pending.set(sessionId, { kind, roundId, firesAtMs, handle });
  }

  /** Huỷ hẹn giờ đang chờ của 1 phiên (nếu có). */
  clear(sessionId: string): void {
    const p = this.pending.get(sessionId);
    if (p) {
      clearTimeout(p.handle);
      this.pending.delete(sessionId);
    }
  }

  onModuleDestroy(): void {
    for (const sessionId of [...this.pending.keys()]) this.clear(sessionId);
  }

  /**
   * Khôi phục hẹn giờ cho mọi phiên còn RUNNING sau khi API restart — gọi từ
   * ArenaGateway.afterInit() (thời điểm duy nhất chắc chắn this.server đã có
   * để phát broadcast khi timer bắn; onModuleInit thì chưa).
   */
  async resumeAfterRestart(
    findRunningSessions: () => Promise<RunningSessionForResume[]>,
  ): Promise<void> {
    const sessions = await findRunningSessions();
    let resumed = 0;
    for (const s of sessions) {
      try {
        const round = s.currentRound;
        if (!round) continue;
        const now = Date.now();

        if (round.status === ArenaRoundStatus.ACTIVE) {
          if (round.deadlineAt && round.deadlineAt.getTime() > now) {
            // Còn hạn — hẹn lại đúng phần thời gian còn lại, kèm 'locked' +
            // ân hạn như luồng bình thường.
            this.scheduleDeadline(s.id, round.id, round.deadlineAt.getTime());
          } else {
            // Đã quá hạn trong lúc API tắt — chốt điểm ngay, không chờ thêm
            // (bỏ qua bước 'locked' cosmetic vì không ai đang xem đếm ngược
            // giữa lúc API khởi động lại).
            await this.service.revealRound(s.id, {
              reason: ArenaRevealReason.DEADLINE,
            });
          }
          resumed++;
        } else if (
          round.status === ArenaRoundStatus.REVEALED &&
          s.hostMode === ArenaHostMode.AUTO &&
          round.revealedAt
        ) {
          const nextAt = round.revealedAt.getTime() + s.revealPauseSec * 1000;
          if (nextAt > now) {
            this.arm(s.id, 'autoNext', round.id, nextAt, () =>
              this.service.nextQuestion(s.id),
            );
          } else {
            await this.service.nextQuestion(s.id);
          }
          resumed++;
        }
        // MANUAL + REVEALED: không làm gì, chờ MC bấm "Câu tiếp theo".
      } catch (err) {
        this.logger.warn(
          `Khôi phục hẹn giờ cho phiên ${s.id} thất bại: ${(err as Error)?.message}`,
        );
      }
    }
    if (resumed > 0) {
      this.logger.log(
        `Đã khôi phục hẹn giờ cho ${resumed} phiên Đấu trường đang chạy`,
      );
    }
  }
}
