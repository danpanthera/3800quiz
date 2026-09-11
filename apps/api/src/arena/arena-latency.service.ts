// Đo độ trễ khứ hồi (RTT) từng socket của Đấu trường, để bù trừ khi tính thời
// gian trả lời — đội mạng chậm không bị thiệt so với đội mạng nhanh.
//
// Lưu trong bộ nhớ tiến trình (Map<socketId, …>), KHÔNG ghi DB — nhất quán với
// ràng buộc "chỉ 1 instance API" (docker-compose.prod.yml). Chỉ giá trị đã
// chốt (latencyMs) mới được ghi vào ArenaBuzz để đối soát về sau.

import { Injectable } from '@nestjs/common';

const RTT_WINDOW = 8; // số mẫu giữ lại để lấy min
const MAX_COMPENSATION_MS = 800; // trần bù trễ tuyệt đối
const MAX_COMPENSATION_RATIO = 0.5; // không bao giờ bù quá 1/2 thời gian thô
// 1.0 = bù trọn RTT (đúng về vật lý: câu hỏi đi xuống + đáp án đi lên đều mất
// thời gian). Đổi thành 0.5 nếu chỉ muốn bù đúng chiều đáp án đi lên.
const COMPENSATION_FACTOR = 1.0;
const MIN_VALID_RTT_MS = 0;
const MAX_VALID_RTT_MS = 5000; // trên ngưỡng này coi là mẫu rác (client treo, không phải mạng)

interface LatencyStat {
  samples: number[];
  lastAt: number;
}

@Injectable()
export class ArenaLatencyService {
  private readonly stats = new Map<string, LatencyStat>();

  /** Ghi nhận 1 mẫu RTT (ms) đo được của một socket. */
  record(socketId: string, rttMs: number): void {
    if (
      !Number.isFinite(rttMs) ||
      rttMs < MIN_VALID_RTT_MS ||
      rttMs > MAX_VALID_RTT_MS
    ) {
      return; // mẫu rác — bỏ qua, không làm hỏng ước lượng
    }
    const stat = this.stats.get(socketId) ?? { samples: [], lastAt: 0 };
    stat.samples.push(rttMs);
    if (stat.samples.length > RTT_WINDOW) stat.samples.shift();
    stat.lastAt = Date.now();
    this.stats.set(socketId, stat);
  }

  /**
   * RTT ước lượng của 1 socket — dùng MIN của cửa sổ mẫu, KHÔNG dùng trung
   * bình: client cố tình trả ack chậm chỉ có thể LÀM TĂNG RTT đo được, không
   * thể kéo xuống dưới độ trễ mạng thật, nên min vừa là ước lượng sát nhất
   * vừa là hàng rào chống gian lận (nguyên lý giống NTP).
   */
  getRttMs(socketId: string): number {
    const stat = this.stats.get(socketId);
    if (!stat || stat.samples.length === 0) return 0;
    return Math.min(...stat.samples);
  }

  /**
   * Số ms cần trừ khỏi thời gian phản hồi thô — đã kẹp qua 3 tầng: hệ số bù,
   * trần tuyệt đối, và không quá 1/2 thời gian thô. Chưa có mẫu RTT ⇒ trả 0
   * (không bù) — mặc định bảo thủ, không đo được thì không cho lợi thế.
   */
  getCompensationMs(socketId: string, rawResponseMs: number): number {
    const rtt = this.getRttMs(socketId) * COMPENSATION_FACTOR;
    return Math.round(
      Math.max(
        0,
        Math.min(
          rtt,
          MAX_COMPENSATION_MS,
          rawResponseMs * MAX_COMPENSATION_RATIO,
        ),
      ),
    );
  }

  /** Xoá mẫu của 1 socket — gọi khi socket ngắt kết nối để không rò bộ nhớ. */
  forget(socketId: string): void {
    this.stats.delete(socketId);
  }
}
