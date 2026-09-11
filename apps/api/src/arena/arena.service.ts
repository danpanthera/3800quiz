import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArenaDto } from './dto/create-arena.dto';
import {
  ArenaStatus,
  ArenaRoundStatus,
  ArenaRevealReason,
  ArenaHostMode,
  Prisma,
  XpSource,
  type ArenaBuzz,
  type QuestionType,
} from '@prisma/client';
import { GamificationService } from '../gamification/gamification.service';
import { ArenaEventBus } from './arena-event-bus';
import {
  gradeArenaAnswer,
  computeResponseMs,
  rankAndScoreBuzzes,
  compareTeamsForRanking,
  buildTeamRoundResults,
  type RankableTeam,
} from './arena.scoring';
import type {
  ArenaQuestionPayload,
  ArenaPreparePayload,
  ArenaRevealPayload,
  ArenaEndPayload,
  ArenaStatePayload,
  ArenaBuzzPayload,
  ArenaLeaderboardRow,
  ArenaXpResult,
} from './arena.types';

const TEAM_COLORS = [
  '#E74C3C',
  '#3498DB',
  '#2ECC71',
  '#F39C12',
  '#9B59B6',
  '#1ABC9C',
  '#E67E22',
  '#2C3E50',
  '#F1C40F',
  '#95A5A6',
];

// Số giây hiện lĩnh vực câu hỏi trước khi bật chính thức, để các đội chuẩn bị
// tinh thần. Round vẫn ở trạng thái PENDING suốt khoảng thời gian này nên mọi
// đáp án gửi sớm đều bị recordAnswer() từ chối — không cần cờ trạng thái riêng.
export const ARENA_PREPARE_SEC = 3;

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Injectable()
export class ArenaService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
    private eventBus: ArenaEventBus,
  ) {}

  // ─── Hàm dùng chung nội bộ ──────────────────────────────────────────────────

  /** Chuyển field JSON (selectedOptionIds) về string[] an toàn kiểu. */
  private toSelectedOptionIds(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  }

  private toRankable(team: {
    id: string;
    score: number;
    correctCount: number;
    totalAnswerMs: number;
    joinedAt: Date;
  }): RankableTeam {
    return {
      id: team.id,
      score: team.score,
      correctCount: team.correctCount,
      totalAnswerMs: team.totalAnswerMs,
      joinedAt: team.joinedAt,
    };
  }

  private toLeaderboardRow(
    team: {
      id: string;
      name: string;
      color: string;
      score: number;
      correctCount: number;
      totalAnswerMs: number;
    },
    rank: number,
    previousRank: number,
    lastPointsDelta: number,
  ): ArenaLeaderboardRow {
    return {
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      score: team.score,
      rank,
      previousRank,
      rankDelta: previousRank - rank,
      correctCount: team.correctCount,
      totalAnswerMs: team.totalAnswerMs,
      lastPointsDelta,
    };
  }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  async createSession(dto: CreateArenaDto) {
    if (!dto.quizId && !dto.mixSlots?.length)
      throw new BadRequestException(
        'Cần chọn bộ đề có sẵn hoặc trộn câu hỏi theo tỷ lệ lĩnh vực',
      );
    if (dto.quizId && dto.mixSlots?.length)
      throw new BadRequestException(
        'Chỉ chọn 1 trong 2 cách nạp câu hỏi: bộ đề có sẵn hoặc trộn theo tỷ lệ',
      );

    // Trộn theo tỷ lệ: dựng 1 Quiz mới từ ngân hàng câu hỏi trước, rồi coi như
    // một bộ đề có sẵn bình thường từ đây trở đi.
    const quizId =
      dto.quizId ?? (await this.buildMixedQuiz(dto.mixName, dto.mixSlots!));

    // Kiểm tra quiz có tồn tại
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: { include: { options: true } } },
    });
    if (!quiz) throw new NotFoundException('Quiz không tồn tại');

    // Tạo joinCode duy nhất
    let joinCode: string;
    let attempts = 0;
    do {
      joinCode = generateJoinCode();
      const existing = await this.prisma.arenaSession.findUnique({
        where: { joinCode },
      });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    const pointsForRank = dto.pointsForRank ?? [10, 7, 5, 3, 2, 2, 2, 2, 2, 2];

    const session = await this.prisma.arenaSession.create({
      data: {
        name: dto.name,
        quizId,
        joinCode,
        hostMode: dto.hostMode ?? 'MANUAL',
        autoAdvanceSec: dto.autoAdvanceSec ?? 10,
        questionDurationSec:
          dto.questionDurationSec ?? dto.autoAdvanceSec ?? 20,
        revealPauseSec: dto.revealPauseSec ?? 5,
        pointsForRank,
        penaltyWrong: dto.penaltyWrong ?? 0,
        passcode: dto.passcode?.trim() || null,
      },
    });

    // Tạo trước các ArenaRound từ danh sách câu hỏi của quiz
    const questions = quiz.questions.sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    if (questions.length > 0) {
      await this.prisma.arenaRound.createMany({
        data: questions.map((q, idx) => ({
          arenaSessionId: session.id,
          questionId: q.id,
          order: idx,
        })),
      });
    }

    // Danh sách mời — có >=1 userId thì phòng trở thành allowlist
    const invitedUserIds = [...new Set(dto.invitedUserIds ?? [])];
    if (invitedUserIds.length > 0) {
      await this.prisma.arenaInvite.createMany({
        data: invitedUserIds.map((userId) => ({
          arenaSessionId: session.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }

    // Đội đặt trước — tối đa 10 đội, 0 người ban đầu, người chơi tự chọn vào lúc join
    const presetNames = (dto.presetTeamNames ?? [])
      .map((n) => n.trim())
      .filter(Boolean);
    if (presetNames.length > 0) {
      await this.prisma.arenaTeam.createMany({
        data: presetNames.map((name, idx) => ({
          arenaSessionId: session.id,
          name,
          color: TEAM_COLORS[idx % TEAM_COLORS.length],
          isPreset: true,
        })),
      });
    }

    return this.getSessionDetail(session.id);
  }

  // Trộn câu hỏi theo tỷ lệ lĩnh vực (thay cho chọn 1 bộ đề có sẵn): dựng 1
  // Quiz mới làm "vật chứa", chọn ngẫu nhiên đúng `count` câu mỗi lĩnh vực từ
  // ngân hàng câu hỏi (Fisher-Yates — cùng thuật toán với
  // AdminService#pickRandomToQuiz ở trang Bộ đề) rồi SAO CHÉP thành Question
  // mới gắn quiz đó, giữ nguyên bản gốc trong ngân hàng để dùng lại cho phiên
  // khác. Web đã quy đổi % → số câu (số dư lớn nhất) nên ở đây chỉ cần cộng
  // dồn theo `count`, không cần biết lại tỷ lệ %.
  private async buildMixedQuiz(
    mixName: string | undefined,
    slots: { subjectId?: string; count: number }[],
  ): Promise<string> {
    const pickedAll: {
      subjectId: string | null;
      content: string;
      imageUrl: string | null;
      explanation: string | null;
      questionType: QuestionType;
      points: number;
      options: { content: string; isCorrect: boolean; orderIndex: number }[];
    }[] = [];

    for (const slot of slots) {
      if (!slot.count || slot.count <= 0) continue;
      const bankQuestions = await this.prisma.question.findMany({
        where: {
          isBank: true,
          approvalStatus: 'APPROVED',
          ...(slot.subjectId ? { subjectId: slot.subjectId } : {}),
        },
        include: { options: { orderBy: { orderIndex: 'asc' } } },
      });
      if (bankQuestions.length === 0)
        throw new BadRequestException(
          'Có lĩnh vực đã chọn không có câu hỏi nào trong ngân hàng',
        );
      if (slot.count > bankQuestions.length)
        throw new BadRequestException(
          `Chỉ có ${bankQuestions.length} câu trong ngân hàng cho 1 lĩnh vực đã chọn`,
        );

      const shuffled = [...bankQuestions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      pickedAll.push(...shuffled.slice(0, slot.count));
    }

    if (pickedAll.length === 0)
      throw new BadRequestException('Không có câu hỏi nào được chọn để trộn');

    // Xáo trộn lần nữa toàn bộ danh sách đã gộp — tránh dồn hết câu của 1
    // lĩnh vực lại gần nhau trong 1 ván đấu trực tiếp.
    for (let i = pickedAll.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pickedAll[i], pickedAll[j]] = [pickedAll[j], pickedAll[i]];
    }

    const quiz = await this.prisma.quiz.create({
      data: {
        title:
          mixName?.trim() ||
          `Đấu trường — Trộn tự động ${new Date().toLocaleString('vi-VN')}`,
        durationMin: 0,
      },
    });

    let orderIdx = 0;
    for (const q of pickedAll) {
      await this.prisma.question.create({
        data: {
          quizId: quiz.id,
          subjectId: q.subjectId,
          content: q.content,
          imageUrl: q.imageUrl,
          explanation: q.explanation,
          questionType: q.questionType,
          points: q.points,
          orderIndex: orderIdx++,
          isBank: false,
          options: {
            create: q.options.map((o) => ({
              content: o.content,
              isCorrect: o.isCorrect,
              orderIndex: o.orderIndex,
            })),
          },
        },
      });
    }

    return quiz.id;
  }

  // Danh sách đội đã làm phẳng members về {userId, fullName} — dùng lại cho
  // các thao tác thay đổi roster (kick/merge/move) để trả cùng 1 shape
  private async getTeamsFlat(sessionId: string) {
    const teams = await this.prisma.arenaTeam.findMany({
      where: { arenaSessionId: sessionId },
      orderBy: { joinedAt: 'asc' },
      include: {
        members: {
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });
    return teams.map((t) => ({
      ...t,
      members: t.members.map((m) => ({
        userId: m.userId,
        fullName: m.user.fullName,
      })),
    }));
  }

  async listSessions() {
    const sessions = await this.prisma.arenaSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        quiz: { select: { id: true, title: true } },
        teams: {
          select: {
            id: true,
            name: true,
            color: true,
            score: true,
            rank: true,
            isPreset: true,
            members: {
              select: {
                userId: true,
                user: { select: { fullName: true } },
              },
            },
          },
        },
        invites: {
          include: { user: { select: { id: true, fullName: true } } },
        },
        _count: { select: { rounds: true } },
      },
    });
    // Làm phẳng members về {userId, fullName} cho khớp shape các endpoint khác
    return sessions.map((s) => ({
      ...s,
      teams: s.teams.map((t) => ({
        ...t,
        members: t.members.map((m) => ({
          userId: m.userId,
          fullName: m.user.fullName,
        })),
      })),
    }));
  }

  async getSessionDetail(id: string) {
    const session = await this.prisma.arenaSession.findUnique({
      where: { id },
      include: {
        quiz: { select: { id: true, title: true, durationMin: true } },
        teams: {
          orderBy: { score: 'desc' },
          include: {
            members: {
              include: { user: { select: { id: true, fullName: true } } },
            },
          },
        },
        invites: {
          include: { user: { select: { id: true, fullName: true } } },
        },
        rounds: {
          orderBy: { order: 'asc' },
          include: {
            question: { include: { options: true } },
            buzzes: { include: { team: true }, orderBy: { answeredAt: 'asc' } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Arena session không tồn tại');
    // Làm phẳng members về {userId, fullName} cho khớp shape các endpoint khác
    return {
      ...session,
      teams: session.teams.map((t) => ({
        ...t,
        members: t.members.map((m) => ({
          userId: m.userId,
          fullName: m.user.fullName,
        })),
      })),
    };
  }

  async getSessionByJoinCode(joinCode: string) {
    const session = await this.prisma.arenaSession.findUnique({
      where: { joinCode },
      include: {
        quiz: { select: { id: true, title: true } },
        teams: {
          select: {
            id: true,
            name: true,
            color: true,
            score: true,
            isPreset: true,
            _count: { select: { members: true } },
          },
        },
        invites: { select: { userId: true } },
        _count: { select: { rounds: true } },
      },
    });
    if (!session) throw new NotFoundException('Mã tham gia không hợp lệ');
    // Endpoint public (chưa đăng nhập) — không được lộ giá trị mật khẩu thật
    // hay danh sách tên được mời, chỉ báo cờ để client hiện đúng cảnh báo.
    const { passcode, invites, ...rest } = session;
    return {
      ...rest,
      teams: rest.teams.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        score: t.score,
        isPreset: t.isPreset,
        memberCount: t._count.members,
      })),
      requiresPasscode: !!passcode,
      isInviteOnly: invites.length > 0,
    };
  }

  async deleteSession(id: string) {
    await this.prisma.arenaSession.findUniqueOrThrow({ where: { id } });
    // Publish TRƯỚC khi xoá — ArenaClockService dọn timer đang chờ (nếu phiên
    // đang RUNNING bị admin xoá thẳng) trước khi bản ghi biến mất khỏi DB.
    this.eventBus.publish({ kind: 'cancelled', sessionId: id });
    return this.prisma.arenaSession.delete({ where: { id } });
  }

  async cancelSession(id: string) {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id },
    });
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException(
        'Chỉ có thể hủy phiên đang ở trạng thái chờ',
      );
    this.eventBus.publish({ kind: 'cancelled', sessionId: id });
    return this.prisma.arenaSession.delete({ where: { id } });
  }

  async stopSession(id: string) {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id },
    });
    if (session.status !== ArenaStatus.RUNNING)
      throw new BadRequestException('Chỉ có thể dừng phiên đang chạy');
    return this.endSession(id);
  }

  // ─── Socket.IO — Xử lý nghiệp vụ ───────────────────────────────────────────

  async joinTeam(
    joinCode: string,
    userId: string,
    opts: { teamName?: string; teamId?: string; passcode?: string },
  ) {
    const session = await this.prisma.arenaSession.findUnique({
      where: { joinCode },
      include: { teams: { include: { members: true } }, invites: true },
    });
    if (!session) throw new BadRequestException('Mã tham gia không hợp lệ');

    // Đã tham gia trước đó (vd: refresh trang, rớt mạng, đổi máy) — trả lại
    // đúng đội cũ, không tạo mới, không bắt kiểm tra lại mật khẩu/allowlist vì
    // đã qua vòng kiểm tra lúc join lần đầu. Kiểm tra này đứng TRƯỚC kiểm tra
    // trạng thái phòng để người chơi vào lại được ngay cả khi phiên đã RUNNING
    // — chỉ người MỚI mới bị chặn khi phiên đã bắt đầu.
    const existingMembership = await this.prisma.arenaTeamMember.findUnique({
      where: {
        arenaSessionId_userId: { arenaSessionId: session.id, userId },
      },
      include: {
        arenaTeam: {
          include: {
            members: {
              include: { user: { select: { id: true, fullName: true } } },
            },
          },
        },
      },
    });
    if (existingMembership)
      return {
        session,
        team: existingMembership.arenaTeam,
        rejoined: true as const,
      };

    if (session.status === ArenaStatus.FINISHED)
      throw new BadRequestException('Phiên đấu đã kết thúc');
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException(
        'Phiên đấu đã bắt đầu — không nhận thêm người chơi mới',
      );

    // Phòng allowlist (có >=1 lời mời) — chỉ userId nằm trong danh sách mới được vào
    if (
      session.invites.length > 0 &&
      !session.invites.some((i) => i.userId === userId)
    )
      throw new BadRequestException(
        'Bạn không có trong danh sách được mời tham gia phòng này',
      );

    if (session.passcode && session.passcode !== (opts.passcode ?? '').trim())
      throw new BadRequestException('Sai mật khẩu phòng');

    const presetTeams = session.teams.filter((t) => t.isPreset);

    // Có đội đặt trước sẵn — bắt buộc chọn 1 đội, không tự gõ tên đội mới
    if (presetTeams.length > 0) {
      if (!opts.teamId) throw new BadRequestException('Chọn 1 đội để tham gia');
      const target = presetTeams.find((t) => t.id === opts.teamId);
      if (!target)
        throw new BadRequestException('Đội không tồn tại trong phiên này');
      if (target.members.length >= 5)
        throw new BadRequestException('Đội đã đủ 5 người, chọn đội khác');

      await this.prisma.arenaTeamMember.create({
        data: { arenaSessionId: session.id, arenaTeamId: target.id, userId },
      });
      const team = await this.prisma.arenaTeam.findUniqueOrThrow({
        where: { id: target.id },
        include: {
          members: {
            include: { user: { select: { id: true, fullName: true } } },
          },
        },
      });
      return { session, team };
    }

    // Không có đội đặt trước — giữ hành vi cũ: tự gõ tên đội mới
    const teamName = opts.teamName?.trim();
    if (!teamName) throw new BadRequestException('Nhập tên đội để tham gia');

    if (session.teams.length >= 10)
      throw new BadRequestException('Phiên đã đủ 10 đội');

    const existingName = session.teams.find(
      (t) => t.name.toLowerCase() === teamName.toLowerCase(),
    );
    if (existingName)
      throw new BadRequestException('Tên đội đã tồn tại trong phiên này');

    const color = TEAM_COLORS[session.teams.length];
    const team = await this.prisma.arenaTeam.create({
      data: {
        arenaSessionId: session.id,
        name: teamName,
        color,
        members: { create: { arenaSessionId: session.id, userId } },
      },
      include: {
        members: {
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });

    return { session, team };
  }

  async kickTeam(sessionId: string, teamId: string) {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException(
        'Chỉ có thể mời người chơi ra khi phiên đang ở sảnh chờ',
      );
    const team = await this.prisma.arenaTeam.findFirst({
      where: { id: teamId, arenaSessionId: sessionId },
    });
    if (!team) throw new NotFoundException('Đội không tồn tại trong phiên này');

    if (team.isPreset) {
      // Đội đặt trước: chỉ xoá hết thành viên, giữ lại slot cho người khác chọn vào
      await this.prisma.arenaTeamMember.deleteMany({
        where: { arenaTeamId: teamId },
      });
    } else {
      await this.prisma.arenaTeam.delete({ where: { id: teamId } });
    }
    return {
      teamId,
      teamName: team.name,
      allTeams: await this.getTeamsFlat(sessionId),
    };
  }

  // MC gỡ 1 người chơi cụ thể khỏi đội (khác kickTeam — không đụng các thành
  // viên còn lại trong cùng đội)
  async kickMember(sessionId: string, teamId: string, userId: string) {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException(
        'Chỉ có thể mời người chơi ra khi phiên đang ở sảnh chờ',
      );
    const member = await this.prisma.arenaTeamMember.findFirst({
      where: { arenaTeamId: teamId, userId, arenaSessionId: sessionId },
      include: { arenaTeam: true },
    });
    if (!member) throw new NotFoundException('Người chơi không thuộc đội này');

    await this.prisma.arenaTeamMember.delete({ where: { id: member.id } });

    // Đội tự phát sinh (không phải đặt trước) mà hết người thì dọn luôn
    if (!member.arenaTeam.isPreset) {
      const remaining = await this.prisma.arenaTeamMember.count({
        where: { arenaTeamId: teamId },
      });
      if (remaining === 0)
        await this.prisma.arenaTeam.delete({ where: { id: teamId } });
    }

    return { userId, allTeams: await this.getTeamsFlat(sessionId) };
  }

  // MC chuyển 1 người chơi sang đội khác trong cùng phiên (đội đích tối đa 5 người)
  async moveMember(sessionId: string, userId: string, targetTeamId: string) {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException(
        'Chỉ có thể chuyển đội khi phiên đang ở sảnh chờ',
      );

    const member = await this.prisma.arenaTeamMember.findUnique({
      where: {
        arenaSessionId_userId: { arenaSessionId: sessionId, userId },
      },
    });
    if (!member)
      throw new BadRequestException('Người chơi không thuộc phiên này');
    if (member.arenaTeamId === targetTeamId)
      throw new BadRequestException('Người chơi đã ở đội này');

    const targetTeam = await this.prisma.arenaTeam.findFirst({
      where: { id: targetTeamId, arenaSessionId: sessionId },
      include: { members: true },
    });
    if (!targetTeam)
      throw new NotFoundException('Đội đích không tồn tại trong phiên này');
    if (targetTeam.members.length >= 5)
      throw new BadRequestException('Đội đích đã đủ 5 người');

    const sourceTeamId = member.arenaTeamId;
    await this.prisma.arenaTeamMember.update({
      where: { id: member.id },
      data: { arenaTeamId: targetTeamId },
    });

    // Dọn đội nguồn nếu hết người và không phải đội đặt trước
    const sourceTeam = await this.prisma.arenaTeam.findUnique({
      where: { id: sourceTeamId },
    });
    if (sourceTeam && !sourceTeam.isPreset) {
      const remaining = await this.prisma.arenaTeamMember.count({
        where: { arenaTeamId: sourceTeamId },
      });
      if (remaining === 0)
        await this.prisma.arenaTeam.delete({ where: { id: sourceTeamId } });
    }

    return {
      userId,
      sourceTeamId,
      targetTeamId,
      targetTeamName: targetTeam.name,
      targetTeamColor: targetTeam.color,
      allTeams: await this.getTeamsFlat(sessionId),
    };
  }

  // MC gộp 2-5 người chơi (đang là đội đơn hoặc đội đã gộp trước đó) thành 1 đội
  // chung điểm số + chung lượt buzz-in. Chỉ cho phép khi còn ở sảnh chờ vì lúc
  // đó chắc chắn chưa có buzz nào cần xử lý dồn/tách. Không áp dụng cho đội
  // đặt trước (dùng "Chuyển đội" để điều chỉnh đội đặt trước thay vì gộp).
  async mergeTeams(sessionId: string, teamIds: string[], teamName?: string) {
    const uniqueIds = [...new Set(teamIds ?? [])];
    if (uniqueIds.length < 2)
      throw new BadRequestException('Chọn ít nhất 2 người/đội để gộp');

    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException(
        'Chỉ có thể gộp đội khi phiên đang ở sảnh chờ',
      );

    const teams = await this.prisma.arenaTeam.findMany({
      where: { id: { in: uniqueIds }, arenaSessionId: sessionId },
      include: { members: true },
    });
    if (teams.length !== uniqueIds.length)
      throw new BadRequestException('Một số đội không tồn tại trong phiên này');

    if (teams.some((t) => t.isPreset))
      throw new BadRequestException(
        'Không thể gộp đội đã đặt tên trước — dùng chức năng "Chuyển đội" để điều chỉnh',
      );

    const totalMembers = teams.reduce((sum, t) => sum + t.members.length, 0);
    if (totalMembers < 2 || totalMembers > 5)
      throw new BadRequestException(
        'Một đội gộp phải có từ 2 đến 5 người chơi',
      );

    // Đội sống sót = đội vào phòng sớm nhất trong nhóm chọn, các đội còn lại
    // chuyển hết member sang rồi xoá (an toàn vì đang LOBBY, chưa có buzz nào)
    const [survivor, ...removed] = [...teams].sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
    );

    await this.prisma.$transaction([
      this.prisma.arenaTeamMember.updateMany({
        where: { arenaTeamId: { in: removed.map((t) => t.id) } },
        data: { arenaTeamId: survivor.id },
      }),
      this.prisma.arenaTeam.deleteMany({
        where: { id: { in: removed.map((t) => t.id) } },
      }),
      ...(teamName?.trim()
        ? [
            this.prisma.arenaTeam.update({
              where: { id: survivor.id },
              data: { name: teamName.trim() },
            }),
          ]
        : []),
    ]);

    const allTeams = await this.getTeamsFlat(sessionId);
    const survivorFresh = allTeams.find((t) => t.id === survivor.id)!;

    return {
      team: survivorFresh,
      removedTeamIds: removed.map((t) => t.id),
      allTeams,
    };
  }

  async startSession(sessionId: string) {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        teams: { include: { members: true } },
        rounds: { orderBy: { order: 'asc' } },
      },
    });
    if (session.status !== ArenaStatus.LOBBY)
      throw new BadRequestException('Phiên không ở trạng thái LOBBY');
    // Đội đặt trước có thể còn 0 người — chỉ tính đội đã có người tham gia
    const teamsWithMembers = session.teams.filter((t) => t.members.length > 0);
    if (teamsWithMembers.length < 2)
      throw new BadRequestException(
        'Cần ít nhất 2 đội có người chơi để bắt đầu',
      );
    if (session.rounds.length === 0)
      throw new BadRequestException('Quiz không có câu hỏi');

    await this.prisma.arenaSession.update({
      where: { id: sessionId },
      data: { status: ArenaStatus.RUNNING, currentRoundOrder: 0 },
    });

    // Không tự bật câu 0 ở đây — nextQuestion() sẽ hiện pha "chuẩn bị" (báo
    // lĩnh vực) trước rồi ArenaClockService mới gọi showQuestion() thật sự.
    return this.nextQuestion(sessionId);
  }

  async showQuestion(
    sessionId: string,
    order: number,
  ): Promise<ArenaQuestionPayload> {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== ArenaStatus.RUNNING)
      throw new BadRequestException('Phiên không đang chạy');

    // Câu trước còn ACTIVE (MC bấm thẳng "Câu tiếp theo" mà chưa công bố) —
    // vẫn phải chốt điểm đầy đủ rồi mới sang câu mới, tuyệt đối không âm thầm
    // bỏ điểm cả vòng đó.
    const stillActive = await this.prisma.arenaRound.findFirst({
      where: { arenaSessionId: sessionId, status: ArenaRoundStatus.ACTIVE },
    });
    if (stillActive) {
      await this.revealRound(sessionId, { reason: ArenaRevealReason.SKIPPED });
    }

    const round = await this.prisma.arenaRound.findUnique({
      where: { arenaSessionId_order: { arenaSessionId: sessionId, order } },
      include: {
        question: {
          include: { options: true, subject: { select: { name: true } } },
        },
      },
    });
    if (!round) throw new BadRequestException('Câu hỏi không tồn tại');

    // Server chốt deadline — áp dụng cho CẢ MANUAL lẫn AUTO. MC vẫn công bố
    // sớm được (revealRound), nhưng đến giờ mà chưa công bố thì ArenaClockService
    // sẽ tự công bố thay (xem arena-clock.service.ts).
    const startedAt = new Date();
    const deadlineAt = new Date(
      startedAt.getTime() + session.questionDurationSec * 1000,
    );

    await this.prisma.arenaRound.update({
      where: { id: round.id },
      data: {
        status: ArenaRoundStatus.ACTIVE,
        startedAt,
        deadlineAt,
        revealReason: null,
      },
    });
    await this.prisma.arenaSession.update({
      where: { id: sessionId },
      data: { currentRoundOrder: order },
    });

    const [teamsTotal, totalRounds] = await Promise.all([
      this.prisma.arenaTeam.count({
        where: { arenaSessionId: sessionId, members: { some: {} } },
      }),
      this.prisma.arenaRound.count({ where: { arenaSessionId: sessionId } }),
    ]);

    // Trả về câu hỏi KHÔNG kèm thông tin đáp án đúng
    const payload: ArenaQuestionPayload = {
      roundId: round.id,
      order: round.order,
      totalRounds,
      question: {
        id: round.question.id,
        content: round.question.content,
        imageUrl: round.question.imageUrl,
        questionType: round.question.questionType,
        subjectName: round.question.subject?.name ?? null,
        options: round.question.options.map((o) => ({
          id: o.id,
          content: o.content,
        })),
      },
      startedAtMs: startedAt.getTime(),
      deadlineAtMs: deadlineAt.getTime(),
      durationMs: session.questionDurationSec * 1000,
      serverNowMs: Date.now(),
      hostMode: session.hostMode,
      revealPauseSec: session.revealPauseSec,
      teamsTotal,
      answeredCount: 0,
    };

    // Bất kể câu hỏi được mở từ đâu (MC bấm, ArenaClockService tự next, REST) —
    // publish qua bus để ArenaGateway broadcast và ArenaClockService tự hẹn
    // giờ deadline. Không có đường nào "quên" hẹn giờ.
    this.eventBus.publish({ kind: 'question', sessionId, payload });
    return payload;
  }

  async recordAnswer(input: {
    arenaRoundId: string;
    userId: string;
    selectedOptionIds: string[];
    receivedAtMs: number;
    latencyMs: number;
    getCompensationMs: (rawResponseMs: number) => number;
  }): Promise<{
    isCorrect: boolean;
    teamId: string;
    teamName: string;
    teamColor: string;
    sessionId: string;
    responseMs: number;
    order: number;
    answeredCount: number;
    teamsTotal: number;
  }> {
    const round = await this.prisma.arenaRound.findUnique({
      where: { id: input.arenaRoundId },
      include: { question: { include: { options: true } } },
    });
    if (!round) throw new BadRequestException('Round không tồn tại');
    if (round.status !== ArenaRoundStatus.ACTIVE)
      throw new BadRequestException('Round không đang active');
    if (!round.startedAt || !round.deadlineAt)
      throw new BadRequestException('Câu hỏi chưa được mở đúng cách');

    // Suy ra teamId từ MEMBERSHIP thực tế của user trong phiên — không tin
    // teamId do client tự gửi, tránh 1 client mạo danh trả lời hộ đội khác.
    const membership = await this.prisma.arenaTeamMember.findUnique({
      where: {
        arenaSessionId_userId: {
          arenaSessionId: round.arenaSessionId,
          userId: input.userId,
        },
      },
      include: { arenaTeam: true },
    });
    if (!membership)
      throw new BadRequestException('Bạn không thuộc phiên đấu này');
    const team = membership.arenaTeam;
    const teamId = team.id;

    const startedAtMs = round.startedAt.getTime();
    const deadlineAtMs = round.deadlineAt.getTime();
    const rawResponseMsRaw = Math.max(0, input.receivedAtMs - startedAtMs);
    // Ân hạn đúng bằng phần bù trễ của chính socket đó — người mạng chậm bấm
    // sát nút không bị loại oan, nhưng ân hạn luôn bị kẹp ở trần tuyệt đối của
    // ArenaLatencyService (tối đa 800ms) nên không thể lợi dụng để trả lời trễ.
    const graceMs = input.getCompensationMs(rawResponseMsRaw);
    if (input.receivedAtMs > deadlineAtMs + graceMs)
      throw new BadRequestException('Đã hết giờ trả lời câu này');

    const { isCorrect } = gradeArenaAnswer(
      round.question,
      input.selectedOptionIds,
    );
    const compensationMs = input.getCompensationMs(rawResponseMsRaw);
    const { responseMs, rawResponseMs } = computeResponseMs({
      receivedAtMs: input.receivedAtMs,
      startedAtMs,
      deadlineAtMs,
      compensationMs,
    });

    let buzz: ArenaBuzz;
    try {
      buzz = await this.prisma.arenaBuzz.create({
        data: {
          arenaRoundId: input.arenaRoundId,
          teamId,
          selectedOptionIds: input.selectedOptionIds,
          // Mốc CHÍNH THỨC dùng để xếp hạng — ĐÃ bù trễ mạng.
          answeredAt: new Date(startedAtMs + responseMs),
          // Mốc thô server nhận được gói tin — giữ để đối soát.
          receivedAt: new Date(input.receivedAtMs),
          isCorrect,
          responseMs,
          rawResponseMs,
          latencyMs: input.latencyMs,
          pointsAwarded: 0, // sẽ được tính khi reveal
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Đội bạn đã gửi đáp án cho câu này rồi');
      }
      throw err;
    }

    const [answeredCount, teamsTotal] = await Promise.all([
      this.prisma.arenaBuzz.count({
        where: { arenaRoundId: input.arenaRoundId },
      }),
      this.prisma.arenaTeam.count({
        where: {
          arenaSessionId: round.arenaSessionId,
          members: { some: {} },
        },
      }),
    ]);

    return {
      isCorrect: buzz.isCorrect,
      teamId,
      teamName: team.name,
      teamColor: team.color,
      sessionId: round.arenaSessionId,
      responseMs,
      order: answeredCount,
      answeredCount,
      teamsTotal,
    };
  }

  async revealRound(
    sessionId: string,
    opts: { reason?: ArenaRevealReason } = {},
  ): Promise<ArenaRevealPayload> {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== ArenaStatus.RUNNING)
      throw new BadRequestException('Phiên không đang chạy');

    const round = await this.prisma.arenaRound.findUnique({
      where: {
        arenaSessionId_order: {
          arenaSessionId: sessionId,
          order: session.currentRoundOrder,
        },
      },
    });
    if (!round)
      throw new BadRequestException('Không tìm thấy câu hỏi hiện tại');

    // Đã công bố rồi (MC bấm trùng lúc hết giờ / gọi lại sau khi mất kết nối)
    // — trả nguyên kết quả cũ, KHÔNG cộng điểm lần hai.
    if (round.status === ArenaRoundStatus.REVEALED) {
      return this.buildRevealPayload(sessionId, round.id);
    }
    if (round.status !== ArenaRoundStatus.ACTIVE)
      throw new BadRequestException('Câu hỏi chưa được mở');

    const revealedAt = new Date();
    const reason = opts.reason ?? ArenaRevealReason.HOST;
    const pointsForRank = session.pointsForRank as number[];
    const penaltyWrong = session.penaltyWrong;

    await this.prisma.$transaction(
      async (tx) => {
        // Khoá lạc quan (CAS): lệnh ghi ĐẦU TIÊN trong transaction. 2 lời gọi
        // reveal song song (MC bấm đúng lúc hẹn giờ hết hạn) — chỉ 1 cái cập
        // nhật được hàng này, cái còn lại nhận count=0 và không cộng điểm lần 2.
        const claimed = await tx.arenaRound.updateMany({
          where: { id: round.id, status: ArenaRoundStatus.ACTIVE },
          data: {
            status: ArenaRoundStatus.REVEALED,
            revealedAt,
            revealReason: reason,
          },
        });
        if (claimed.count === 0) return; // lời gọi song song đã thắng

        const buzzes = await tx.arenaBuzz.findMany({
          where: { arenaRoundId: round.id },
          orderBy: [{ answeredAt: 'asc' }, { id: 'asc' }],
        });
        const ranked = rankAndScoreBuzzes(
          buzzes.map((b) => ({
            id: b.id,
            teamId: b.teamId,
            isCorrect: b.isCorrect,
            responseMs: b.responseMs,
            answeredAt: b.answeredAt,
          })),
          pointsForRank,
          penaltyWrong,
        );

        for (const r of ranked) {
          const team = await tx.arenaTeam.findUniqueOrThrow({
            where: { id: r.teamId },
          });
          const scoreBefore = team.score;
          const scoreAfter = scoreBefore + r.pointsAwarded;

          await tx.arenaBuzz.update({
            where: { id: r.id },
            data: {
              speedRank: r.speedRank,
              correctRank: r.correctRank,
              pointsAwarded: r.pointsAwarded,
              scoreBefore,
              scoreAfter,
            },
          });

          const teamUpdate: Prisma.ArenaTeamUpdateInput = {};
          if (r.pointsAwarded !== 0) {
            teamUpdate.score = { increment: r.pointsAwarded };
          }
          if (r.isCorrect) {
            teamUpdate.correctCount = { increment: 1 };
            teamUpdate.totalAnswerMs = { increment: r.responseMs };
          }
          if (Object.keys(teamUpdate).length > 0) {
            await tx.arenaTeam.update({
              where: { id: r.teamId },
              data: teamUpdate,
            });
          }
        }
      },
      { timeout: 10_000 },
    );

    const payload = await this.buildRevealPayload(sessionId, round.id);
    this.eventBus.publish({ kind: 'revealed', sessionId, payload });
    return payload;
  }

  /**
   * Dựng payload công bố kết quả — hàm ĐỌC THUẦN, không ghi gì. Dùng lại cho:
   * lần gọi revealRound() khi round đã REVEALED (idempotent), và cho
   * arena.state khi người chơi/MC vào lại giữa lúc round đang REVEALED.
   */
  private async buildRevealPayload(
    sessionId: string,
    roundId: string,
  ): Promise<ArenaRevealPayload> {
    const [session, round, teams] = await Promise.all([
      this.prisma.arenaSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { _count: { select: { rounds: true } } },
      }),
      this.prisma.arenaRound.findUniqueOrThrow({
        where: { id: roundId },
        include: { question: { include: { options: true } }, buzzes: true },
      }),
      // Chỉ đội CÓ người chơi mới vào bảng công bố — đội đặt trước rỗng chưa
      // từng thi đấu, không nên hiện là "không trả lời".
      this.prisma.arenaTeam.findMany({
        where: { arenaSessionId: sessionId, members: { some: {} } },
      }),
    ]);

    const buzzesByTeamId = new Map(round.buzzes.map((b) => [b.teamId, b]));

    // Điểm SAU vòng này = điểm hiện tại trong DB (revealRound đã cộng xong
    // trước khi hàm này được gọi).
    const rankedAfter = [...teams].sort((a, b) =>
      compareTeamsForRanking(this.toRankable(a), this.toRankable(b)),
    );
    // Điểm TRƯỚC vòng này = điểm sau trừ đi đúng phần vừa cộng/trừ của vòng
    // này (suy ngược từ buzz.pointsAwarded) — không cần bảng phụ lưu snapshot.
    const rankedBefore = teams
      .map((t) => {
        const buzz = buzzesByTeamId.get(t.id);
        return {
          ...t,
          score: buzz ? t.score - buzz.pointsAwarded : t.score,
          correctCount:
            buzz?.isCorrect && t.correctCount > 0
              ? t.correctCount - 1
              : t.correctCount,
          totalAnswerMs:
            buzz?.isCorrect && t.totalAnswerMs >= buzz.responseMs
              ? t.totalAnswerMs - buzz.responseMs
              : t.totalAnswerMs,
        };
      })
      .sort((a, b) =>
        compareTeamsForRanking(this.toRankable(a), this.toRankable(b)),
      );

    const rankAfterByTeamId = new Map(rankedAfter.map((t, i) => [t.id, i + 1]));
    const rankBeforeByTeamId = new Map(
      rankedBefore.map((t, i) => [t.id, i + 1]),
    );
    const currentScoreByTeamId = new Map(teams.map((t) => [t.id, t.score]));

    const results = buildTeamRoundResults(
      teams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      new Map(
        Array.from(buzzesByTeamId.entries()).map(([teamId, b]) => [
          teamId,
          {
            teamId,
            isCorrect: b.isCorrect,
            selectedOptionIds: this.toSelectedOptionIds(b.selectedOptionIds),
            responseMs: b.responseMs,
            rawResponseMs: b.rawResponseMs,
            latencyMs: b.latencyMs,
            speedRank: b.speedRank,
            correctRank: b.correctRank,
            pointsAwarded: b.pointsAwarded,
            scoreBefore: b.scoreBefore,
            scoreAfter: b.scoreAfter,
          },
        ]),
      ),
      currentScoreByTeamId,
      rankBeforeByTeamId,
      rankAfterByTeamId,
    );

    const leaderboard: ArenaLeaderboardRow[] = rankedAfter.map((t, i) => {
      const buzz = buzzesByTeamId.get(t.id);
      const previousRank = rankBeforeByTeamId.get(t.id) ?? i + 1;
      return this.toLeaderboardRow(
        t,
        i + 1,
        previousRank,
        buzz?.pointsAwarded ?? 0,
      );
    });

    const correctOptionIds = round.question.options
      .filter((o) => o.isCorrect)
      .map((o) => o.id);

    const fastestCorrect = results.find((r) => r.correctRank === 1);
    const fastestOverall = results.reduce<(typeof results)[number] | null>(
      (best, r) => {
        if (r.speedRank == null) return best;
        if (best == null || (best.speedRank ?? Infinity) > r.speedRank)
          return r;
        return best;
      },
      null,
    );

    return {
      roundId: round.id,
      order: round.order,
      totalRounds: session._count.rounds,
      questionId: round.questionId,
      correctOptionIds,
      explanation: round.question.explanation,
      revealedAtMs: (round.revealedAt ?? new Date()).getTime(),
      serverNowMs: Date.now(),
      revealReason: round.revealReason ?? ArenaRevealReason.HOST,
      durationMs:
        round.deadlineAt && round.startedAt
          ? round.deadlineAt.getTime() - round.startedAt.getTime()
          : 0,
      fastestTeamId: fastestCorrect?.teamId ?? null,
      fastestOverallTeamId: fastestOverall?.teamId ?? null,
      correctCount: results.filter((r) => r.outcome === 'correct').length,
      wrongCount: results.filter((r) => r.outcome === 'wrong').length,
      noAnswerCount: results.filter((r) => r.outcome === 'no_answer').length,
      results,
      leaderboard,
      nextAtMs:
        session.hostMode === ArenaHostMode.AUTO && round.revealedAt
          ? round.revealedAt.getTime() + session.revealPauseSec * 1000
          : null,
      isLastRound: round.order + 1 >= session._count.rounds,
    };
  }

  // Chọn câu KẾ TIẾP và phát pha "chuẩn bị" (báo lĩnh vực) trước khi bật
  // chính thức — publish sự kiện qua bus để ArenaClockService hẹn giờ
  // ARENA_PREPARE_SEC giây rồi mới gọi showQuestion() thật sự (round vẫn
  // PENDING suốt lúc chờ nên recordAnswer() tự chối mọi đáp án gửi sớm).
  // Dùng cho cả câu đầu tiên (startSession gọi lại hàm này) lẫn khi MC bấm
  // "Câu tiếp theo"/ArenaClockService tự next ở chế độ AUTO.
  //
  // Chọn round PENDING theo order TĂNG DẦN — cố tình KHÔNG dùng
  // currentRoundOrder + 1 — để nếu tiến trình API bị mất giữa lúc đang chuẩn
  // bị (khởi động lại), gọi lại hàm này vẫn ra đúng câu còn dang dở, kể cả
  // khi đó là câu đầu tiên (order 0, lúc currentRoundOrder vẫn đang là 0).
  async nextQuestion(
    sessionId: string,
  ): Promise<({ type: 'preparing' } & ArenaPreparePayload) | ArenaEndPayload> {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { _count: { select: { rounds: true } } },
    });
    if (session.status !== ArenaStatus.RUNNING)
      throw new BadRequestException('Phiên không đang chạy');

    const round = await this.prisma.arenaRound.findFirst({
      where: { arenaSessionId: sessionId, status: ArenaRoundStatus.PENDING },
      orderBy: { order: 'asc' },
      include: {
        question: { select: { subject: { select: { name: true } } } },
      },
    });
    if (!round) return this.endSession(sessionId);

    const payload: ArenaPreparePayload = {
      roundId: round.id,
      order: round.order,
      totalRounds: session._count.rounds,
      subjectName: round.question.subject?.name ?? null,
      prepareSec: ARENA_PREPARE_SEC,
      hostMode: session.hostMode,
    };
    this.eventBus.publish({ kind: 'preparing', sessionId, payload });
    return { type: 'preparing' as const, ...payload };
  }

  async endSession(sessionId: string): Promise<ArenaEndPayload> {
    // Chốt trạng thái TRƯỚC khi cộng XP — MC bấm "Kết thúc" đúng lúc câu cuối
    // tự nhảy sang FINISHED sẽ gọi endSession hai lần; không có CAS này là
    // cộng XP nhân đôi.
    const claimed = await this.prisma.arenaSession.updateMany({
      where: {
        id: sessionId,
        status: { in: [ArenaStatus.LOBBY, ArenaStatus.RUNNING] },
      },
      data: { status: ArenaStatus.FINISHED },
    });
    if (claimed.count === 0) {
      return this.buildEndPayload(sessionId);
    }

    const teams = await this.prisma.arenaTeam.findMany({
      where: { arenaSessionId: sessionId },
      include: { members: true },
    });
    // Xếp hạng cuối: điểm cao hơn → nhiều câu đúng hơn → tổng thời gian trả
    // lời đúng ngắn hơn → vào phòng sớm hơn (chốt hạ, luôn tất định). Dùng
    // CHUNG comparator với bảng xếp hạng live để không mâu thuẫn nhau.
    const ranked = [...teams].sort((a, b) =>
      compareTeamsForRanking(this.toRankable(a), this.toRankable(b)),
    );

    for (let i = 0; i < ranked.length; i++) {
      await this.prisma.arenaTeam.update({
        where: { id: ranked[i].id },
        data: { rank: i + 1 },
      });
    }

    // Cộng XP + thăng bậc (dùng chung hệ Gamification với làm bài quiz)
    const xpResults: Record<string, ArenaXpResult> = {};
    for (let i = 0; i < ranked.length; i++) {
      const team = ranked[i];
      const rank = i + 1;
      const isWinner = rank === 1;

      // Đội nhiều người: mỗi thành viên đều nhận XP tham gia/thắng như nhau
      for (const member of team.members) {
        const userId = member.userId;
        await this.gamification.updateActivity(userId);
        if (isWinner) await this.gamification.incrementArenaWins(userId);

        const participateResult = await this.gamification.awardXp(
          userId,
          10,
          XpSource.ARENA_PARTICIPATE,
          sessionId,
          `Tham gia Arena, hạng ${rank}`,
        );
        const winResult = isWinner
          ? await this.gamification.awardXp(
              userId,
              30,
              XpSource.ARENA_WIN,
              sessionId,
              'Vô địch Arena',
            )
          : null;

        xpResults[userId] = {
          levelUp: participateResult.levelUp || (winResult?.levelUp ?? false),
          newLevel: Math.max(
            participateResult.newLevel,
            winResult?.newLevel ?? 0,
          ),
          newBadges: [
            ...participateResult.newBadges,
            ...(winResult?.newBadges ?? []),
          ],
        };
      }
    }

    const payload: ArenaEndPayload = {
      type: 'ended',
      ranking: ranked.map((t, i) => this.toLeaderboardRow(t, i + 1, i + 1, 0)),
      xpResults,
    };
    this.eventBus.publish({ kind: 'ended', sessionId, payload });
    return payload;
  }

  /** endSession() gọi lặp lại (idempotent) — trả lại kết quả đã chốt, không có XP mới. */
  private async buildEndPayload(sessionId: string): Promise<ArenaEndPayload> {
    const teams = await this.prisma.arenaTeam.findMany({
      where: { arenaSessionId: sessionId },
      orderBy: { rank: 'asc' },
    });
    return {
      type: 'ended',
      ranking: teams.map((t, i) =>
        this.toLeaderboardRow(t, t.rank ?? i + 1, t.rank ?? i + 1, 0),
      ),
      xpResults: {},
    };
  }

  /**
   * Snapshot đầy đủ trạng thái phiên — dùng khi người chơi/MC vào lại giữa
   * trận (F5, rớt mạng, đổi máy) để dựng lại UI mà không cần chờ sự kiện kế
   * tiếp mới có dữ liệu.
   */
  async getLiveState(
    sessionId: string,
    userId: string | null,
  ): Promise<ArenaStatePayload> {
    const session = await this.prisma.arenaSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { _count: { select: { rounds: true } } },
    });

    const teams = await this.prisma.arenaTeam.findMany({
      where: { arenaSessionId: sessionId, members: { some: {} } },
    });
    const ranked = [...teams].sort((a, b) =>
      compareTeamsForRanking(this.toRankable(a), this.toRankable(b)),
    );
    const leaderboard = ranked.map((t, i) =>
      this.toLeaderboardRow(t, i + 1, i + 1, 0),
    );

    let myTeamId: string | null = null;
    let myTeamName: string | null = null;
    let myTeamColor: string | null = null;
    if (userId) {
      const membership = await this.prisma.arenaTeamMember.findUnique({
        where: {
          arenaSessionId_userId: { arenaSessionId: sessionId, userId },
        },
        include: { arenaTeam: true },
      });
      if (membership) {
        myTeamId = membership.arenaTeamId;
        myTeamName = membership.arenaTeam.name;
        myTeamColor = membership.arenaTeam.color;
      }
    }

    let currentQuestion: ArenaQuestionPayload | null = null;
    let lastReveal: ArenaRevealPayload | null = null;
    let myAnswer: { selectedOptionIds: string[]; responseMs: number } | null =
      null;
    let buzzes: ArenaBuzzPayload[] = [];

    if (session.status === ArenaStatus.RUNNING) {
      const round = await this.prisma.arenaRound.findUnique({
        where: {
          arenaSessionId_order: {
            arenaSessionId: sessionId,
            order: session.currentRoundOrder,
          },
        },
        include: {
          question: {
            include: { options: true, subject: { select: { name: true } } },
          },
          buzzes: { orderBy: [{ answeredAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (
        round?.status === ArenaRoundStatus.ACTIVE &&
        round.startedAt &&
        round.deadlineAt
      ) {
        currentQuestion = {
          roundId: round.id,
          order: round.order,
          totalRounds: session._count.rounds,
          question: {
            id: round.question.id,
            content: round.question.content,
            imageUrl: round.question.imageUrl,
            questionType: round.question.questionType,
            subjectName: round.question.subject?.name ?? null,
            options: round.question.options.map((o) => ({
              id: o.id,
              content: o.content,
            })),
          },
          startedAtMs: round.startedAt.getTime(),
          deadlineAtMs: round.deadlineAt.getTime(),
          durationMs: round.deadlineAt.getTime() - round.startedAt.getTime(),
          serverNowMs: Date.now(),
          hostMode: session.hostMode,
          revealPauseSec: session.revealPauseSec,
          teamsTotal: teams.length,
          answeredCount: round.buzzes.length,
        };
        buzzes = round.buzzes.map((b, i) => {
          const t = teams.find((tt) => tt.id === b.teamId);
          return {
            teamId: b.teamId,
            teamName: t?.name ?? '',
            teamColor: t?.color ?? '#999999',
            order: i + 1,
            responseMs: b.responseMs,
            answeredCount: round.buzzes.length,
            teamsTotal: teams.length,
            serverNowMs: Date.now(),
          };
        });
        if (myTeamId) {
          const mine = round.buzzes.find((b) => b.teamId === myTeamId);
          if (mine) {
            myAnswer = {
              selectedOptionIds: this.toSelectedOptionIds(
                mine.selectedOptionIds,
              ),
              responseMs: mine.responseMs,
            };
          }
        }
      } else if (round?.status === ArenaRoundStatus.REVEALED) {
        lastReveal = await this.buildRevealPayload(sessionId, round.id);
      }
    }

    let final: ArenaEndPayload | null = null;
    if (session.status === ArenaStatus.FINISHED) {
      final = await this.buildEndPayload(sessionId);
    }

    return {
      sessionId,
      status: session.status,
      serverNowMs: Date.now(),
      myTeamId,
      myTeamName,
      myTeamColor,
      teams: leaderboard,
      currentQuestion,
      myAnswer,
      buzzes,
      lastReveal,
      final,
    };
  }

  // ─── Khôi phục hẹn giờ sau khi API restart ─────────────────────────────────

  /**
   * Danh sách phiên đang RUNNING kèm round hiện tại — dùng làm nguồn cho
   * ArenaClockService.resumeAfterRestart() gọi lúc ArenaGateway.afterInit().
   */
  async getRunningSessionsForClockResume() {
    const sessions = await this.prisma.arenaSession.findMany({
      where: { status: ArenaStatus.RUNNING },
      select: {
        id: true,
        hostMode: true,
        revealPauseSec: true,
        currentRoundOrder: true,
      },
    });
    return Promise.all(
      sessions.map(async (s) => {
        const currentRound = await this.prisma.arenaRound.findUnique({
          where: {
            arenaSessionId_order: {
              arenaSessionId: s.id,
              order: s.currentRoundOrder,
            },
          },
          select: {
            id: true,
            status: true,
            deadlineAt: true,
            revealedAt: true,
          },
        });
        return {
          id: s.id,
          hostMode: s.hostMode,
          revealPauseSec: s.revealPauseSec,
          currentRound,
        };
      }),
    );
  }

  // ─── Tự phục vụ: lịch sử Đấu trường của chính người dùng ──────────────────

  // Trả về các phiên mà user đã từng vào (kể cả đang diễn ra) — dùng cho trang
  // chủ học viên. Không lộ phiên của người khác, chỉ lấy theo membership của
  // chính userId nên không cần kiểm tra allowlist riêng.
  async getMyHistory(userId: string) {
    const memberships = await this.prisma.arenaTeamMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      take: 30,
      include: {
        arenaTeam: {
          include: {
            arenaSession: {
              select: {
                id: true,
                name: true,
                // joinCode an toàn để trả về ở đây: chỉ lấy phiên mà chính user
                // đã là thành viên, tức là họ vốn đã biết mã để vào được
                joinCode: true,
                status: true,
                updatedAt: true,
                quiz: { select: { title: true } },
              },
            },
          },
        },
      },
    });

    return memberships.map((m) => ({
      sessionId: m.arenaTeam.arenaSession.id,
      sessionName: m.arenaTeam.arenaSession.name,
      joinCode: m.arenaTeam.arenaSession.joinCode,
      status: m.arenaTeam.arenaSession.status,
      quizTitle: m.arenaTeam.arenaSession.quiz.title,
      teamName: m.arenaTeam.name,
      teamColor: m.arenaTeam.color,
      score: m.arenaTeam.score,
      rank: m.arenaTeam.rank,
      joinedAt: m.joinedAt,
      finishedAt: m.arenaTeam.arenaSession.updatedAt,
    }));
  }
}
