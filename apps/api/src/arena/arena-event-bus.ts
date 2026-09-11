// Bus phát sự kiện nội bộ giữa ArenaService và ArenaClockService/ArenaGateway
// — không inject gì cả, chỉ để phá vòng phụ thuộc:
//
//   ArenaGateway  ──inject──► ArenaService, ArenaClockService, ArenaLatencyService
//   ArenaClockService ──inject──► ArenaService, ArenaEventBus
//   ArenaService ──inject──► ArenaEventBus (publish)
//
// Đồ thị phụ thuộc là DAG thuần — không cần forwardRef, không thêm thư viện
// (dùng rxjs đã có sẵn trong apps/api/package.json).

import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { ArenaOutgoing } from './arena.types';

@Injectable()
export class ArenaEventBus {
  // Subject multicast: cả ArenaGateway (để phát socket) và ArenaClockService
  // (để hẹn giờ) đều nhận được mọi sự kiện. TUYỆT ĐỐI không gọi .error() —
  // Subject lỗi là chết luôn cả stream; mọi subscriber phải tự try/catch.
  readonly stream$ = new Subject<ArenaOutgoing>();

  publish(event: ArenaOutgoing): void {
    this.stream$.next(event);
  }
}
