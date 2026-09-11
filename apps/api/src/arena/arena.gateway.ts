import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ArenaService } from './arena.service';
import { ArenaEventBus } from './arena-event-bus';
import { ArenaClockService } from './arena-clock.service';
import { ArenaLatencyService } from './arena-latency.service';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { getCorsOrigin } from '../cors-origin';
import type { ArenaOutgoing } from './arena.types';

const ARENA_HOST_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.TRAINER];
// Chu kỳ đo RTT nền cho mọi socket đang trong phòng Đấu trường — bổ sung cho
// mẫu đo lúc connect/host/join/ngay-sau-khi-phát-câu-hỏi, giữ ước lượng luôn
// tươi kể cả khi người chơi ngồi im không thao tác gì lâu.
const LATENCY_PROBE_INTERVAL_MS = 5000;
const LATENCY_PROBE_TIMEOUT_MS = 2000;

@WebSocketGateway({
  cors: { origin: getCorsOrigin() },
  namespace: '/',
})
export class ArenaGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ArenaGateway.name);
  private probeTimer?: NodeJS.Timeout;

  constructor(
    private arenaService: ArenaService,
    private jwtService: JwtService,
    private arenaEventBus: ArenaEventBus,
    private arenaClock: ArenaClockService,
    private arenaLatency: ArenaLatencyService,
  ) {}

  afterInit(): void {
    // Mọi broadcast socket của Đấu trường đi qua ĐÚNG MỘT chỗ này — bất kể sự
    // kiện đến từ MC bấm tay, ArenaClockService tự hẹn giờ, hay REST controller
    // (cancel/stop) — tránh trùng lặp logic broadcast rải rác trong từng handler.
    this.arenaEventBus.stream$.subscribe((event) => {
      try {
        this.broadcastOutgoing(event);
      } catch (err) {
        this.logger.error(`Lỗi phát sự kiện Arena: ${(err as Error)?.message}`);
      }
    });

    // Khôi phục hẹn giờ cho các phiên còn RUNNING sau khi API restart — gọi ở
    // đây (không phải onModuleInit) vì đây là thời điểm duy nhất chắc chắn
    // this.server đã sẵn sàng để phát broadcast khi timer bắn.
    void this.arenaClock.resumeAfterRestart(() =>
      this.arenaService.getRunningSessionsForClockResume(),
    );

    // Đo RTT nền định kỳ cho mọi socket đang có mặt trong 1 phòng Đấu trường
    // bất kỳ — giữ ước lượng độ trễ luôn mới dù người chơi không thao tác gì.
    this.probeTimer = setInterval(() => {
      void this.probeAllArenaSockets();
    }, LATENCY_PROBE_INTERVAL_MS);
    this.probeTimer.unref();
  }

  private broadcastOutgoing(event: ArenaOutgoing): void {
    const room = this.getRoomName(event.sessionId);
    switch (event.kind) {
      case 'preparing':
        this.server.to(room).emit('arena.prepare', event.payload);
        break;
      case 'question':
        this.server.to(room).emit('arena.question', event.payload);
        // Đo lại RTT ngay lúc phát câu hỏi — mẫu tươi nhất có thể, ngay
        // trước lúc người chơi bấm trả lời, để bù trễ chính xác nhất cho vòng này.
        void this.probeRoomSockets(room);
        break;
      case 'revealed':
        this.server.to(room).emit('arena.revealed', event.payload);
        this.server
          .to(room)
          .emit('arena.leaderboard', { teams: event.payload.leaderboard });
        break;
      case 'locked':
        this.server.to(room).emit('arena.locked', {
          roundId: event.roundId,
          serverNowMs: event.serverNowMs,
        });
        break;
      case 'leaderboard':
        this.server.to(room).emit('arena.leaderboard', { teams: event.teams });
        break;
      case 'ended':
        this.server.to(room).emit('arena.ended', event.payload);
        break;
      case 'cancelled':
        // Phòng sắp/đã bị xoá — không còn ai để phát tới.
        break;
      default:
        break;
    }
  }

  handleConnection(client: Socket) {
    // Đo RTT ngay lúc kết nối — có mẫu sớm nhất có thể, trước cả khi biết
    // client sẽ host hay join phòng nào.
    void this.probeLatency(client);
  }

  handleDisconnect(client: Socket) {
    this.arenaLatency.forget(client.id);
  }

  private getRoomName(sessionId: string) {
    return `arena-${sessionId}`;
  }

  // Room riêng cho từng đội — dùng để gửi sự kiện chung cho cả đội (vd: đồng
  // đội đã trả lời, cả đội bị kick, cả đội vừa được gộp vào)
  private getTeamRoomName(teamId: string) {
    return `arena-team-${teamId}`;
  }

  // Room riêng cho từng user — dùng để gửi sự kiện CHỈ đúng 1 người (vd: bị
  // gỡ khỏi đội, được chuyển sang đội khác) mà không ảnh hưởng đồng đội còn lại
  private getUserRoomName(userId: string) {
    return `arena-user-${userId}`;
  }

  private extractUser(
    client: Socket,
  ): { userId: string; role: UserRole } | null {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace(
          'Bearer ',
          '',
        );
      if (!token) return null;
      const payload = this.jwtService.verify(token);
      return { userId: payload.sub, role: payload.role };
    } catch {
      return null;
    }
  }

  // ─── Đo độ trễ (RTT) ────────────────────────────────────────────────────────

  /**
   * Đo 1 mẫu RTT của socket bằng emitWithAck có timeout — client chỉ cần
   * `socket.on('arena.ping', (ack) => ack())`. Quá hạn/mất kết nối thì bỏ
   * qua mẫu này, không phải lỗi nghiêm trọng.
   */
  private async probeLatency(client: Socket): Promise<void> {
    const t0 = Date.now();
    try {
      await client.timeout(LATENCY_PROBE_TIMEOUT_MS).emitWithAck('arena.ping');
      this.arenaLatency.record(client.id, Date.now() - t0);
    } catch {
      // bỏ qua — không có mẫu mới thì getCompensationMs() vẫn trả 0 (an toàn)
    }
  }

  private async probeAllArenaSockets(): Promise<void> {
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      const inArenaRoom = [...socket.rooms].some((r) => r.startsWith('arena-'));
      if (inArenaRoom) void this.probeLatency(socket as unknown as Socket);
    }
  }

  // Đo RTT cho đúng các socket đang ở 1 phòng cụ thể — dùng ngay sau khi phát
  // câu hỏi, không cần quét toàn bộ server như probeAllArenaSockets().
  private async probeRoomSockets(room: string): Promise<void> {
    const sockets = await this.server.in(room).fetchSockets();
    for (const socket of sockets) {
      void this.probeLatency(socket as unknown as Socket);
    }
  }

  // ─── Đồng bộ đồng hồ client-server ──────────────────────────────────────────

  @SubscribeMessage('arena.time')
  handleTime() {
    return { serverNowMs: Date.now() };
  }

  // ─── Admin: điều hành phiên đấu ───────────────────────────────────────────

  @SubscribeMessage('arena.host')
  async handleHost(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role)) {
      return { error: 'Không có quyền điều hành' };
    }
    client.join(this.getRoomName(data.sessionId));
    client.data.sessionId = data.sessionId;
    client.data.isHost = true;
    void this.probeLatency(client);
    try {
      // Snapshot đầy đủ — MC bấm F5/mất mạng giữa trận vẫn dựng lại được toàn
      // bộ màn hình điều khiển ngay khi kết nối lại, không cần chờ sự kiện kế tiếp.
      const state = await this.arenaService.getLiveState(data.sessionId, null);
      client.emit('arena.state', state);
    } catch {
      // Phiên không tồn tại — bỏ qua, để lỗi lộ ra ở các thao tác kế tiếp
    }
    return { ok: true, sessionId: data.sessionId };
  }

  // ─── Khán giả: xem trực tiếp không tham gia đội (chiếu màn hình lớn hội trường) ──
  // Chỉ cần đăng nhập (không giới hạn vai trò như MC) — join thẳng room để nhận
  // đủ mọi broadcast (câu hỏi, reveal, bảng điểm) NHƯNG không tạo team/member nên
  // không xuất hiện trong danh sách đội và không buzz-in được (không có teamId).
  @SubscribeMessage('arena.spectate')
  async handleSpectate(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = this.extractUser(client);
    if (!user) return { error: 'Cần đăng nhập để xem trực tiếp' };
    client.join(this.getRoomName(data.sessionId));
    client.data.sessionId = data.sessionId;
    client.data.isSpectator = true;
    void this.probeLatency(client);
    try {
      const state = await this.arenaService.getLiveState(data.sessionId, null);
      client.emit('arena.state', state);
    } catch {
      // Phiên không tồn tại — bỏ qua, để lỗi lộ ra ở các thao tác kế tiếp
    }
    return { ok: true, sessionId: data.sessionId };
  }

  // ─── Người chơi: tham gia đội (bắt buộc đăng nhập) ─────────────────────────

  @SubscribeMessage('arena.join')
  async handleJoin(
    @MessageBody()
    data: {
      joinCode: string;
      teamName?: string;
      teamId?: string;
      passcode?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const player = this.extractUser(client);
    if (!player) return { error: 'Cần đăng nhập để tham gia Arena' };
    try {
      const { session, team } = await this.arenaService.joinTeam(
        data.joinCode,
        player.userId,
        {
          teamName: data.teamName,
          teamId: data.teamId,
          passcode: data.passcode,
        },
      );
      client.join(this.getRoomName(session.id));
      client.join(this.getTeamRoomName(team.id));
      client.join(this.getUserRoomName(player.userId));
      client.data.sessionId = session.id;
      client.data.teamId = team.id;
      client.data.userId = player.userId;
      void this.probeLatency(client);

      // Thông báo đội mới cho tất cả người trong room
      this.server.to(this.getRoomName(session.id)).emit('arena.team_joined', {
        team: {
          id: team.id,
          name: team.name,
          color: team.color,
          members: team.members.map((m) => ({
            userId: m.userId,
            fullName: m.user.fullName,
          })),
        },
      });

      // Snapshot đầy đủ cho đúng client vừa tham gia — thay cho sự kiện cũ
      // arena.joined_you (chỉ có teamId/teamColor) để hỗ trợ vào lại giữa
      // trận: người chơi F5/rớt mạng dựng lại đúng câu hỏi, deadline còn lại,
      // và biết mình đã trả lời hay chưa ngay khi kết nối lại.
      const state = await this.arenaService.getLiveState(
        session.id,
        player.userId,
      );
      client.emit('arena.state', state);

      return {
        ok: true,
        teamId: team.id,
        teamName: team.name,
        sessionId: session.id,
        teamColor: team.color,
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: bắt đầu phiên đấu ─────────────────────────────────────────────

  @SubscribeMessage('arena.start')
  async handleStart(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      // startSession() kết thúc bằng nextQuestion(), tự publish 'preparing'
      // qua bus (báo lĩnh vực câu 0) — sau ARENA_PREPARE_SEC giây,
      // ArenaClockService mới gọi showQuestion() thật sự. broadcastOutgoing()
      // lo toàn bộ phần phát 'arena.prepare' rồi 'arena.question', không cần
      // gateway tự emit lại ở đây.
      await this.arenaService.startSession(data.sessionId);
      this.server
        .to(this.getRoomName(data.sessionId))
        .emit('arena.started', {});
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: mời một đội ra khỏi phòng (kick) ────────────────────────────────

  @SubscribeMessage('arena.kick')
  async handleKick(
    @MessageBody() data: { sessionId: string; teamId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      const result = await this.arenaService.kickTeam(
        data.sessionId,
        data.teamId,
      );
      // Báo riêng cho cả đội bị kick (tất cả thành viên) để họ tự thoát khỏi phòng
      this.server
        .to(this.getTeamRoomName(data.teamId))
        .emit('arena.you_were_kicked', { teamName: result.teamName });
      // Báo cho cả phòng (host + các đội khác) để cập nhật danh sách
      this.server
        .to(this.getRoomName(data.sessionId))
        .emit('arena.teams_updated', { teams: result.allTeams });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: gỡ 1 người chơi cụ thể khỏi đội (đội nhiều người) ───────────────

  @SubscribeMessage('arena.kick_member')
  async handleKickMember(
    @MessageBody() data: { sessionId: string; teamId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      const result = await this.arenaService.kickMember(
        data.sessionId,
        data.teamId,
        data.userId,
      );
      // Chỉ báo riêng đúng người bị gỡ — không ảnh hưởng đồng đội còn lại
      this.server
        .to(this.getUserRoomName(data.userId))
        .emit('arena.you_were_kicked', { teamName: undefined });
      this.server
        .to(this.getRoomName(data.sessionId))
        .emit('arena.teams_updated', { teams: result.allTeams });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: chuyển 1 người chơi sang đội khác ───────────────────────────────

  @SubscribeMessage('arena.move_member')
  async handleMoveMember(
    @MessageBody()
    data: { sessionId: string; userId: string; targetTeamId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      const result = await this.arenaService.moveMember(
        data.sessionId,
        data.userId,
        data.targetTeamId,
      );
      const userRoom = this.getUserRoomName(data.userId);
      // Di chuyển đúng socket của người này sang room đội mới, rời room đội cũ
      await this.server
        .in(userRoom)
        .socketsJoin(this.getTeamRoomName(data.targetTeamId));
      if (result.sourceTeamId) {
        await this.server
          .in(userRoom)
          .socketsLeave(this.getTeamRoomName(result.sourceTeamId));
      }
      this.server.to(userRoom).emit('arena.you_were_moved', {
        teamId: result.targetTeamId,
        teamName: result.targetTeamName,
        teamColor: result.targetTeamColor,
      });
      this.server
        .to(this.getRoomName(data.sessionId))
        .emit('arena.teams_updated', { teams: result.allTeams });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: gộp 2-5 người chơi thành 1 đội ──────────────────────────────────

  @SubscribeMessage('arena.merge')
  async handleMerge(
    @MessageBody()
    data: { sessionId: string; teamIds: string[]; teamName?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      const result = await this.arenaService.mergeTeams(
        data.sessionId,
        data.teamIds,
        data.teamName,
      );
      const survivorRoom = this.getTeamRoomName(result.team.id);
      // Di chuyển toàn bộ socket của các đội bị gộp sang room của đội sống sót
      // để họ tiếp tục nhận đúng sự kiện riêng (bị kick, đồng đội đã trả lời...)
      for (const removedId of result.removedTeamIds) {
        await this.server
          .in(this.getTeamRoomName(removedId))
          .socketsJoin(survivorRoom);
      }
      this.server.to(survivorRoom).emit('arena.you_were_merged', {
        teamId: result.team.id,
        teamName: result.team.name,
        teamColor: result.team.color,
      });
      this.server
        .to(this.getRoomName(data.sessionId))
        .emit('arena.teams_updated', { teams: result.allTeams });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Người chơi: nộp đáp án ─────────────────────────────────────────────────

  @SubscribeMessage('arena.answer')
  async handleAnswer(
    @MessageBody()
    data: { arenaRoundId: string; selectedOptionIds: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    // PHẢI là câu lệnh đầu tiên — trước cả verify JWT — để không cộng thêm độ
    // trễ xử lý của server vào thời gian phản hồi ghi nhận cho người chơi.
    const receivedAtMs = Date.now();
    const player = this.extractUser(client);
    if (!player) return { error: 'Cần đăng nhập để trả lời' };
    try {
      const result = await this.arenaService.recordAnswer({
        arenaRoundId: data.arenaRoundId,
        userId: player.userId,
        selectedOptionIds: data.selectedOptionIds,
        receivedAtMs,
        latencyMs: this.arenaLatency.getRttMs(client.id),
        getCompensationMs: (rawMs) =>
          this.arenaLatency.getCompensationMs(client.id, rawMs),
      });
      // Phát cho CẢ PHÒNG biết có đội vừa bấm (chưa tiết lộ đúng/sai) — lấy
      // room từ SESSION THẬT của round (result.sessionId), không dùng
      // client.data.sessionId vì socket có thể đang lệch room do đồng bộ trễ.
      this.server.to(this.getRoomName(result.sessionId)).emit('arena.buzz_in', {
        teamId: result.teamId,
        teamName: result.teamName,
        teamColor: result.teamColor,
        order: result.order,
        responseMs: result.responseMs,
        answeredCount: result.answeredCount,
        teamsTotal: result.teamsTotal,
        serverNowMs: Date.now(),
      });
      // Đội nhiều người: báo riêng cho các đồng đội còn lại là đội đã trả lời
      // rồi (tránh họ vẫn thấy màn hình đang chờ chọn đáp án)
      this.server
        .to(this.getTeamRoomName(result.teamId))
        .emit('arena.team_answered', {});
      return { ok: true, responseMs: result.responseMs, order: result.order };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: hiện đáp án ───────────────────────────────────────────────────

  @SubscribeMessage('arena.reveal')
  async handleReveal(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      // revealRound() tự publish 'revealed' qua bus — broadcastOutgoing() lo
      // phần phát arena.revealed + arena.leaderboard cho cả phòng.
      await this.arenaService.revealRound(data.sessionId);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: câu hỏi tiếp theo ─────────────────────────────────────────────

  @SubscribeMessage('arena.next')
  async handleNext(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      // nextQuestion() tự publish 'preparing' (còn câu) hoặc 'ended' (hết
      // câu) qua bus — broadcastOutgoing() lo phần phát 'arena.prepare'/
      // 'arena.ended'; 'arena.question' sẽ tới sau đúng ARENA_PREPARE_SEC
      // giây, do ArenaClockService hẹn giờ.
      await this.arenaService.nextQuestion(data.sessionId);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── Admin: kết thúc phiên sớm ────────────────────────────────────────────

  @SubscribeMessage('arena.end')
  async handleEnd(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const host = this.extractUser(client);
    if (!host || !ARENA_HOST_ROLES.includes(host.role))
      return { error: 'Không có quyền' };
    try {
      // endSession() tự publish 'ended' qua bus — broadcastOutgoing() lo phần phát.
      await this.arenaService.endSession(data.sessionId);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }
}
