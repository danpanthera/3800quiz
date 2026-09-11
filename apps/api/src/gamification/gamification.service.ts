import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { XpSource, BadgeCategory } from '@prisma/client';

type ConditionType =
  | 'submission_count'
  | 'pass_count'
  | 'perfect_score'
  | 'streak_days'
  | 'arena_win_count'
  | 'level_reached'
  | 'consecutive_pass'
  | 'arena_participate_count'
  | 'fast_answer_count'
  | 'flawless_session_speed'
  | 'subject_mastery'
  | 'lifetime_xp'
  | 'all_badges_except'
  | 'first_time_pass'
  | 'improved_retake'
  | 'arena_win_streak'
  | 'arena_early_joiner'
  | 'department_rank'
  | 'first_n_to_complete_quiz'
  | 'activity_return'
  | 'night_owl'
  | 'flawless_program';

interface BadgeCondition {
  type: ConditionType;
  value: number; // ngưỡng chính (số lần đạt / mốc) — vài loại dùng thêm field phụ bên dưới
  maxMs?: number; // fast_answer_count, flawless_session_speed — ngưỡng thời gian (ms)
  scope?: 'arena' | 'exam' | 'both'; // fast_answer_count — nguồn dữ liệu tính tốc độ
  minAccuracy?: number; // fast_answer_count — % chính xác tối thiểu cả phiên/bài, chặn đoán bừa
  subjectId?: string; // subject_mastery
  minAvgScore?: number; // subject_mastery
  minCount?: number; // subject_mastery — số bài tối thiểu để coi là "đã học đủ"
  topN?: number; // arena_early_joiner, first_n_to_complete_quiz, department_rank
  minDeltaPoints?: number; // improved_retake
}

interface ConditionProgress {
  xp: number;
  totalSubmissions: number;
  totalPassed: number;
  currentStreak: number;
  totalArenaWins: number;
  level: number;
}

const STREAK_FREEZE_MAX_RESERVE = 2;
const STREAK_FREEZE_GRANT_INTERVAL_DAYS = 30;

@Injectable()
export class GamificationService {
  constructor(private prisma: PrismaService) {}

  // ─── awardXp ─────────────────────────────────────────────────────────────

  async awardXp(
    userId: string,
    amount: number,
    source: XpSource,
    referenceId?: string,
    note?: string,
  ): Promise<{
    levelUp: boolean;
    newLevel: number;
    newBadges: { code: string; name: string; iconSlug: string }[];
  }> {
    // Tạo mới hoặc cập nhật UserProgress (upsert)
    let progress = await this.prisma.userProgress.upsert({
      where: { userId },
      update: { xp: { increment: amount } },
      create: { userId, xp: amount },
    });

    // Thêm bản ghi XpTransaction
    await this.prisma.xpTransaction.create({
      data: {
        userProgressId: progress.id,
        userId,
        amount,
        source,
        referenceId,
        note,
      },
    });

    // Lấy lại progress vừa cập nhật
    progress = await this.prisma.userProgress.findUniqueOrThrow({
      where: { userId },
    });

    // Tính lại cấp độ (dựa theo dữ liệu trong DB)
    const levelDef = await this.prisma.levelDefinition.findFirst({
      where: { minXp: { lte: progress.xp } },
      orderBy: { minXp: 'desc' },
    });
    const newLevel = levelDef?.level ?? 1;
    const oldLevel = progress.level;
    const levelUp = newLevel > oldLevel;

    if (levelUp) {
      await this.prisma.userProgress.update({
        where: { userId },
        data: { level: newLevel },
      });
    }

    // Kiểm tra huy hiệu
    const newBadges = await this.checkAndAwardBadges(userId, progress.id);

    return { levelUp, newLevel, newBadges };
  }

  // ─── updateActivity (logic chuỗi ngày + phao cứu streak) ──────────────────

  async updateActivity(userId: string): Promise<void> {
    const progress = await this.prisma.userProgress.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const today = new Date(nowUtc7.toISOString().slice(0, 10)); // yyyy-mm-dd UTC+7

    const lastDate = progress.lastActivityDate;

    if (!lastDate) {
      await this.prisma.userProgress.update({
        where: { userId },
        data: {
          currentStreak: 1,
          maxStreak: Math.max(1, progress.maxStreak),
          lastActivityDate: today,
        },
      });
      await this.maybeGrantStreakFreeze(
        userId,
        progress.streakFreezeCount,
        progress.lastStreakFreezeGrantAt,
      );
      return;
    }

    const lastUtc7 = new Date(
      new Date(lastDate).getTime() + 7 * 60 * 60 * 1000,
    );
    const lastDay = new Date(lastUtc7.toISOString().slice(0, 10));
    const diffDays = Math.round(
      (today.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) {
      // Cùng ngày, streak không đổi — vẫn kiểm tra cấp phao định kỳ.
      await this.maybeGrantStreakFreeze(
        userId,
        progress.streakFreezeCount,
        progress.lastStreakFreezeGrantAt,
      );
      return;
    }

    let newStreak: number;
    let freezeCount = progress.streakFreezeCount;

    if (diffDays === 1) {
      newStreak = progress.currentStreak + 1;
    } else if (diffDays === 2 && freezeCount > 0) {
      // Nghỉ ĐÚNG 1 ngày và còn phao cứu (kiểu Duolingo streak freeze) — tự
      // động dùng 1 phao, coi như ngày nghỉ đó được "che", chuỗi vẫn nối tiếp.
      freezeCount -= 1;
      newStreak = progress.currentStreak + 1;
    } else {
      newStreak = 1;
    }

    const newMaxStreak = Math.max(newStreak, progress.maxStreak);

    await this.prisma.userProgress.update({
      where: { userId },
      data: {
        currentStreak: newStreak,
        maxStreak: newMaxStreak,
        lastActivityDate: today,
        streakFreezeCount: freezeCount,
      },
    });

    await this.maybeGrantStreakFreeze(
      userId,
      freezeCount,
      progress.lastStreakFreezeGrantAt,
    );

    // Thưởng mốc chuỗi ngày liên tiếp
    if (newStreak === 7 || newStreak === 30 || newStreak === 90) {
      const bonusXp = newStreak === 7 ? 100 : newStreak === 30 ? 500 : 1500;
      await this.awardXp(
        userId,
        bonusXp,
        XpSource.STREAK_BONUS,
        undefined,
        `Streak ${newStreak} ngày`,
      );
    }
  }

  // Cấp thêm 1 phao cứu streak mỗi 30 ngày, dự trữ tối đa 2 — độc lập với
  // việc nghỉ phép thật hay không (không có nguồn dữ liệu lịch nghỉ phép để
  // đối chiếu tự động), người dùng tự quyết định lúc nào cần "để dành".
  private async maybeGrantStreakFreeze(
    userId: string,
    currentCount: number,
    lastGrantAt: Date | null,
  ): Promise<void> {
    if (!lastGrantAt) {
      // Chưa từng có mốc cấp phao (user mới, hoặc dữ liệu cũ trước khi có
      // tính năng này) — chỉ THIẾT LẬP mốc bắt đầu đếm 30 ngày, không cấp
      // ngay. Nếu coi null là "vô hạn ngày trước" thì phao vừa dùng xong sẽ
      // bị hoàn lại ngay lập tức ở lượt gọi kế tiếp — vô hiệu hoá cơ chế.
      await this.prisma.userProgress.update({
        where: { userId },
        data: { lastStreakFreezeGrantAt: new Date() },
      });
      return;
    }
    if (currentCount >= STREAK_FREEZE_MAX_RESERVE) return;
    const daysSinceGrant =
      (Date.now() - lastGrantAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceGrant < STREAK_FREEZE_GRANT_INTERVAL_DAYS) return;

    await this.prisma.userProgress.update({
      where: { userId },
      data: {
        streakFreezeCount: { increment: 1 },
        lastStreakFreezeGrantAt: new Date(),
      },
    });
  }

  // ─── incrementStats ───────────────────────────────────────────────────────

  async incrementSubmissionStats(
    userId: string,
    isPassed: boolean,
  ): Promise<void> {
    await this.prisma.userProgress.upsert({
      where: { userId },
      update: {
        totalSubmissions: { increment: 1 },
        ...(isPassed ? { totalPassed: { increment: 1 } } : {}),
      },
      create: { userId, totalSubmissions: 1, totalPassed: isPassed ? 1 : 0 },
    });
  }

  async incrementArenaWins(userId: string): Promise<void> {
    await this.prisma.userProgress.upsert({
      where: { userId },
      update: { totalArenaWins: { increment: 1 } },
      create: { userId, totalArenaWins: 1 },
    });
  }

  // ─── checkAndAwardBadges ─────────────────────────────────────────────────

  async checkAndAwardBadges(
    userId: string,
    userProgressId: string,
  ): Promise<{ code: string; name: string; iconSlug: string }[]> {
    const progress = await this.prisma.userProgress.findUniqueOrThrow({
      where: { userId },
      include: { userBadges: true },
    });

    const alreadyHas = new Set(
      progress.userBadges.map((ub) => ub.badgeDefinitionId),
    );
    const allBadges = await this.prisma.badgeDefinition.findMany();

    const newBadges: { code: string; name: string; iconSlug: string }[] = [];

    for (const badge of allBadges) {
      if (alreadyHas.has(badge.id)) continue;

      const condition = badge.conditionJson as unknown as BadgeCondition;
      const met = await this.evaluateCondition(
        condition,
        userId,
        progress,
        badge.id,
      );

      if (met) {
        await this.prisma.userBadge.create({
          data: { userProgressId, userId, badgeDefinitionId: badge.id },
        });

        // Cộng thêm xpBonus nếu có
        if (badge.xpBonus > 0) {
          await this.prisma.userProgress.update({
            where: { userId },
            data: { xp: { increment: badge.xpBonus } },
          });
          await this.prisma.xpTransaction.create({
            data: {
              userProgressId,
              userId,
              amount: badge.xpBonus,
              source: XpSource.BADGE_BONUS,
              referenceId: badge.id,
              note: `Badge bonus: ${badge.name}`,
            },
          });
        }

        newBadges.push({
          code: badge.code,
          name: badge.name,
          iconSlug: badge.iconSlug,
        });
      }
    }

    return newBadges;
  }

  private async evaluateCondition(
    condition: BadgeCondition,
    userId: string,
    progress: ConditionProgress,
    currentBadgeId?: string,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'submission_count':
        return progress.totalSubmissions >= condition.value;

      case 'pass_count':
        return progress.totalPassed >= condition.value;

      case 'perfect_score': {
        const perfectCount = await this.prisma.submission.count({
          where: { userId, score: 100 },
        });
        return perfectCount >= condition.value;
      }

      case 'streak_days':
        return progress.currentStreak >= condition.value;

      case 'arena_win_count':
        return progress.totalArenaWins >= condition.value;

      case 'level_reached':
        return progress.level >= condition.value;

      case 'lifetime_xp':
        return progress.xp >= condition.value;

      case 'consecutive_pass': {
        const recent = await this.prisma.submission.findMany({
          where: { userId, status: 'GRADED' },
          orderBy: { submittedAt: 'desc' },
          take: condition.value,
          select: { isPassed: true },
        });
        return (
          recent.length >= condition.value &&
          recent.every((s) => s.isPassed === true)
        );
      }

      // Số phiên Đấu trường đã THAM GIA (khác với arena_win_count — không cần thắng)
      case 'arena_participate_count': {
        const count = await this.prisma.arenaTeamMember.count({
          where: { userId },
        });
        return count >= condition.value;
      }

      // Số câu trả lời ĐÚNG trong thời gian ≤ maxMs — gộp Đấu trường (ArenaBuzz,
      // đã có sẵn responseMs bù trễ mạng) và/hoặc bài thi thường (QuizAttemptAnswer,
      // answeredMs tính từ mốc lưu tự động gần nhất, xem attempts.service.ts).
      case 'fast_answer_count': {
        const maxMs = condition.maxMs ?? 5000;
        const scope = condition.scope ?? 'both';
        const minAccuracy = condition.minAccuracy;
        let count = 0;

        if (scope === 'arena' || scope === 'both') {
          if (minAccuracy == null) {
            count += await this.prisma.arenaBuzz.count({
              where: {
                isCorrect: true,
                responseMs: { lte: maxMs, gt: 0 },
                team: { members: { some: { userId } } },
              },
            });
          } else {
            const buzzes = await this.prisma.arenaBuzz.findMany({
              where: { team: { members: { some: { userId } } } },
              select: {
                isCorrect: true,
                responseMs: true,
                arenaRound: { select: { arenaSessionId: true } },
              },
            });
            const bySession = new Map<
              string,
              { total: number; correct: number; fast: number }
            >();
            for (const b of buzzes) {
              const sid = b.arenaRound.arenaSessionId;
              const s = bySession.get(sid) ?? { total: 0, correct: 0, fast: 0 };
              s.total += 1;
              if (b.isCorrect) s.correct += 1;
              if (b.isCorrect && b.responseMs > 0 && b.responseMs <= maxMs)
                s.fast += 1;
              bySession.set(sid, s);
            }
            for (const s of bySession.values()) {
              const accuracy = s.total > 0 ? (s.correct / s.total) * 100 : 0;
              if (accuracy >= minAccuracy) count += s.fast;
            }
          }
        }

        if (scope === 'exam' || scope === 'both') {
          if (minAccuracy == null) {
            count += await this.prisma.quizAttemptAnswer.count({
              where: {
                isCorrect: true,
                answeredMs: { lte: maxMs, gte: 0 },
                attempt: { userId },
              },
            });
          } else {
            const answers = await this.prisma.quizAttemptAnswer.findMany({
              where: { attempt: { userId } },
              select: { isCorrect: true, answeredMs: true, attemptId: true },
            });
            const byAttempt = new Map<
              string,
              { total: number; correct: number; fast: number }
            >();
            for (const a of answers) {
              const s = byAttempt.get(a.attemptId) ?? {
                total: 0,
                correct: 0,
                fast: 0,
              };
              s.total += 1;
              if (a.isCorrect) s.correct += 1;
              if (a.isCorrect && a.answeredMs != null && a.answeredMs <= maxMs)
                s.fast += 1;
              byAttempt.set(a.attemptId, s);
            }
            for (const s of byAttempt.values()) {
              const accuracy = s.total > 0 ? (s.correct / s.total) * 100 : 0;
              if (accuracy >= minAccuracy) count += s.fast;
            }
          }
        }

        return count >= condition.value;
      }

      // 1 phiên Đấu trường trả lời ĐÚNG hết mọi câu, tốc độ trung bình ≤ maxMs.
      case 'flawless_session_speed': {
        const maxAvgMs = condition.maxMs ?? 6000;
        const buzzes = await this.prisma.arenaBuzz.findMany({
          where: { team: { members: { some: { userId } } } },
          select: {
            isCorrect: true,
            responseMs: true,
            arenaRound: { select: { arenaSessionId: true } },
          },
        });
        const bySession = new Map<
          string,
          { total: number; correct: number; sumMs: number }
        >();
        for (const b of buzzes) {
          const sid = b.arenaRound.arenaSessionId;
          const s = bySession.get(sid) ?? { total: 0, correct: 0, sumMs: 0 };
          s.total += 1;
          if (b.isCorrect) s.correct += 1;
          s.sumMs += b.responseMs;
          bySession.set(sid, s);
        }
        let qualifying = 0;
        for (const s of bySession.values()) {
          if (s.total === 0) continue;
          if (s.correct === s.total && s.sumMs / s.total <= maxAvgMs)
            qualifying += 1;
        }
        return qualifying >= condition.value;
      }

      // Điểm trung bình ≥ minAvgScore trên ≥ minCount bài GRADED thuộc 1 lĩnh
      // vực (subjectId), CHỈ tính bài dùng đúng QuizVersion MỚI NHẤT hiện tại —
      // nhờ vậy huy hiệu tự "hết hạn" khi đề cập nhật, không cần cron riêng.
      case 'subject_mastery': {
        if (!condition.subjectId) return false;
        const quizzesWithSubject = await this.prisma.quiz.findMany({
          where: { questions: { some: { subjectId: condition.subjectId } } },
          select: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        });
        const latestVersionIds = quizzesWithSubject
          .map((q) => q.versions[0]?.id)
          .filter((id): id is string => Boolean(id));
        if (latestVersionIds.length === 0) return false;

        const submissions = await this.prisma.submission.findMany({
          where: {
            userId,
            status: 'GRADED',
            quizVersionId: { in: latestVersionIds },
          },
          select: { score: true },
        });
        const minCount = condition.minCount ?? 3;
        if (submissions.length < minCount) return false;
        const avg =
          submissions.reduce((sum, s) => sum + (s.score ?? 0), 0) /
          submissions.length;
        return avg >= (condition.minAvgScore ?? 90);
      }

      // "Toàn diện" — tự động mở khi đã có MỌI huy hiệu khác (trừ nhóm SPECIAL
      // ẩn, mang tính may rủi/bất ngờ, không hợp lý bắt buộc) và trừ chính nó.
      case 'all_badges_except': {
        const [allBadges, userBadges] = await Promise.all([
          this.prisma.badgeDefinition.findMany({
            where: { category: { not: BadgeCategory.SPECIAL } },
            select: { id: true },
          }),
          this.prisma.userBadge.findMany({
            where: { userId },
            select: { badgeDefinitionId: true },
          }),
        ]);
        const requiredIds = allBadges
          .map((b) => b.id)
          .filter((id) => id !== currentBadgeId);
        if (requiredIds.length === 0) return false;
        const haveIds = new Set(userBadges.map((b) => b.badgeDefinitionId));
        return requiredIds.every((id) => haveIds.has(id));
      }

      // Số assignment PASS ngay ở lần làm (QuizAttempt GRADED) ĐẦU TIÊN.
      case 'first_time_pass': {
        const attempts = await this.prisma.quizAttempt.findMany({
          where: { userId, status: 'GRADED' },
          orderBy: { startedAt: 'asc' },
          select: {
            assignmentId: true,
            submission: { select: { isPassed: true } },
          },
        });
        const seen = new Set<string>();
        let count = 0;
        for (const a of attempts) {
          if (seen.has(a.assignmentId)) continue;
          seen.add(a.assignmentId);
          if (a.submission?.isPassed === true) count += 1;
        }
        return count >= condition.value;
      }

      // Số assignment có điểm làm lại cao hơn lần đầu ≥ minDeltaPoints.
      case 'improved_retake': {
        const minDelta = condition.minDeltaPoints ?? 20;
        const attempts = await this.prisma.quizAttempt.findMany({
          where: { userId, status: 'GRADED' },
          orderBy: { startedAt: 'asc' },
          select: {
            assignmentId: true,
            submission: { select: { score: true } },
          },
        });
        const byAssignment = new Map<string, number[]>();
        for (const a of attempts) {
          if (a.submission?.score == null) continue;
          const list = byAssignment.get(a.assignmentId) ?? [];
          list.push(a.submission.score);
          byAssignment.set(a.assignmentId, list);
        }
        let count = 0;
        for (const scores of byAssignment.values()) {
          if (scores.length < 2) continue;
          const best = Math.max(...scores.slice(1));
          if (best - scores[0] >= minDelta) count += 1;
        }
        return count >= condition.value;
      }

      // Chuỗi thắng (rank=1) liên tiếp DÀI NHẤT từng đạt qua nhiều phiên Đấu trường.
      case 'arena_win_streak': {
        const memberships = await this.prisma.arenaTeamMember.findMany({
          where: { userId },
          select: {
            arenaTeam: {
              select: {
                rank: true,
                arenaSession: { select: { createdAt: true, status: true } },
              },
            },
          },
        });
        const sorted = memberships
          .filter((m) => m.arenaTeam.arenaSession.status === 'FINISHED')
          .sort(
            (a, b) =>
              a.arenaTeam.arenaSession.createdAt.getTime() -
              b.arenaTeam.arenaSession.createdAt.getTime(),
          );
        let maxStreak = 0;
        let current = 0;
        for (const m of sorted) {
          if (m.arenaTeam.rank === 1) {
            current += 1;
            maxStreak = Math.max(maxStreak, current);
          } else {
            current = 0;
          }
        }
        return maxStreak >= condition.value;
      }

      // Số phiên Đấu trường mà user thuộc topN người join sớm nhất.
      case 'arena_early_joiner': {
        const topN = condition.topN ?? 10;
        const myMemberships = await this.prisma.arenaTeamMember.findMany({
          where: { userId },
          select: { arenaSessionId: true, joinedAt: true },
        });
        let qualifying = 0;
        for (const m of myMemberships) {
          const earlier = await this.prisma.arenaTeamMember.count({
            where: {
              arenaSessionId: m.arenaSessionId,
              joinedAt: { lt: m.joinedAt },
            },
          });
          if (earlier < topN) qualifying += 1;
        }
        return qualifying >= condition.value;
      }

      // Hiện đang xếp hạng top-N theo XP trong CÙNG phòng ban (chỉ so với đồng
      // nghiệp active) — sửa lại đúng nghĩa cho badge "department_top" cũ.
      case 'department_rank': {
        const topN = condition.value ?? 1;
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { departmentId: true },
        });
        if (!user?.departmentId) return false;
        const peers = await this.prisma.userProgress.findMany({
          where: { user: { departmentId: user.departmentId, isActive: true } },
          orderBy: { xp: 'desc' },
          take: topN,
          select: { userId: true },
        });
        return peers.some((p) => p.userId === userId);
      }

      // Số lần thuộc topN người đầu tiên hoàn thành 1 QuizVersion MỚI NHẤT của
      // 1 quiz — sửa lại đúng nghĩa cho badge "early_bird" cũ.
      case 'first_n_to_complete_quiz': {
        const topN = condition.topN ?? 10;
        const mySubmissions = await this.prisma.submission.findMany({
          where: { userId, status: 'GRADED' },
          select: { quizId: true, quizVersionId: true, submittedAt: true },
        });
        let qualifying = 0;
        for (const sub of mySubmissions) {
          if (!sub.submittedAt) continue;
          const latestVersion = await this.prisma.quizVersion.findFirst({
            where: { quizId: sub.quizId },
            orderBy: { version: 'desc' },
            select: { id: true },
          });
          if (latestVersion?.id !== sub.quizVersionId) continue;
          const earlier = await this.prisma.submission.count({
            where: {
              quizVersionId: sub.quizVersionId,
              status: 'GRADED',
              submittedAt: { lt: sub.submittedAt },
            },
          });
          if (earlier < topN) qualifying += 1;
        }
        return qualifying >= condition.value;
      }

      // Từng có khoảng cách ≥ value ngày giữa 2 lần nộp bài liên tiếp rồi vẫn
      // quay lại hoạt động — khen ngợi quay lại, không chỉ phạt đứt streak.
      case 'activity_return': {
        const submissions = await this.prisma.submission.findMany({
          where: { userId, submittedAt: { not: null } },
          orderBy: { submittedAt: 'asc' },
          select: { submittedAt: true },
        });
        for (let i = 1; i < submissions.length; i++) {
          const prev = submissions[i - 1].submittedAt as Date;
          const curr = submissions[i].submittedAt as Date;
          const gapDays = (curr.getTime() - prev.getTime()) / 86_400_000;
          if (gapDays >= condition.value) return true;
        }
        return false;
      }

      // Số bài nộp ngoài giờ hành chính (trước 6h/sau 22h, giờ UTC+7).
      case 'night_owl': {
        const submissions = await this.prisma.submission.findMany({
          where: { userId, submittedAt: { not: null } },
          select: { submittedAt: true },
        });
        let count = 0;
        for (const s of submissions) {
          const utc7 = new Date(
            (s.submittedAt as Date).getTime() + 7 * 60 * 60 * 1000,
          );
          const hour = utc7.getUTCHours();
          if (hour >= 22 || hour < 6) count += 1;
        }
        return count >= condition.value;
      }

      // Mọi bài thuộc mọi quiz đang mở đều đạt 100% (lấy điểm CAO NHẤT nếu có
      // làm lại — không phạt việc làm lại, chỉ cần đã từng đạt tuyệt đối).
      case 'flawless_program': {
        const activeQuizzes = await this.prisma.quiz.findMany({
          where: { isActive: true },
          select: {
            id: true,
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        });
        if (activeQuizzes.length === 0) return false;
        const latestVersionIds = activeQuizzes
          .map((q) => q.versions[0]?.id)
          .filter((id): id is string => Boolean(id));
        const submissions = await this.prisma.submission.findMany({
          where: {
            userId,
            status: 'GRADED',
            quizVersionId: { in: latestVersionIds },
          },
          select: { quizId: true, score: true },
        });
        const bestByQuiz = new Map<string, number>();
        for (const s of submissions) {
          const prevBest = bestByQuiz.get(s.quizId) ?? 0;
          bestByQuiz.set(s.quizId, Math.max(prevBest, s.score ?? 0));
        }
        if (bestByQuiz.size < activeQuizzes.length) return false;
        return [...bestByQuiz.values()].every((score) => score >= 100);
      }

      default:
        return false;
    }
  }

  // ─── getProgress ─────────────────────────────────────────────────────────

  async getProgress(userId: string) {
    const progress = await this.prisma.userProgress.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        userBadges: {
          include: { badgeDefinition: true },
          orderBy: { awardedAt: 'desc' },
        },
      },
    });

    const currentLevelDef = await this.prisma.levelDefinition.findFirst({
      where: { level: progress.level },
    });
    const nextLevelDef = await this.prisma.levelDefinition.findFirst({
      where: { level: progress.level + 1 },
    });

    const xpInCurrentLevel = progress.xp - (currentLevelDef?.minXp ?? 0);
    const xpToNext = nextLevelDef
      ? nextLevelDef.minXp - (currentLevelDef?.minXp ?? 0)
      : 0;
    const percentToNext =
      xpToNext > 0
        ? Math.min(100, Math.round((xpInCurrentLevel / xpToNext) * 100))
        : 100;

    // Xếp hạng toàn hệ thống
    const rank = await this.prisma.userProgress.count({
      where: { xp: { gt: progress.xp } },
    });

    return {
      xp: progress.xp,
      level: progress.level,
      levelName: currentLevelDef?.name ?? 'Tân binh',
      color: currentLevelDef?.color ?? '#9E9E9E',
      xpToNext: nextLevelDef?.minXp ? nextLevelDef.minXp - progress.xp : 0,
      xpInCurrentLevel,
      percentToNext,
      currentStreak: progress.currentStreak,
      maxStreak: progress.maxStreak,
      streakFreezeCount: progress.streakFreezeCount,
      totalSubmissions: progress.totalSubmissions,
      totalArenaWins: progress.totalArenaWins,
      rank: rank + 1,
      badges: progress.userBadges.map((ub) => ({
        code: ub.badgeDefinition.code,
        name: ub.badgeDefinition.name,
        iconSlug: ub.badgeDefinition.iconSlug,
        category: ub.badgeDefinition.category,
        awardedAt: ub.awardedAt,
      })),
    };
  }

  async getBadges(userId: string) {
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: { badgeDefinition: true },
      orderBy: { awardedAt: 'desc' },
    });
  }

  async getXpHistory(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.xpTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.xpTransaction.count({ where: { userId } }),
    ]);
    return { items, total, page, limit };
  }

  // ─── Admin: Bảng xếp hạng ─────────────────────────────────────────────────

  async getLeaderboard(
    period: 'all' | 'month' | 'week' = 'all',
    departmentId?: string,
  ) {
    if (period === 'all' && !departmentId) {
      // Dùng UserProgress trực tiếp
      const [rows, levelDefs] = await Promise.all([
        this.prisma.userProgress.findMany({
          orderBy: { xp: 'desc' },
          take: 100,
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                departmentId: true,
                department: { select: { name: true } },
              },
            },
          },
        }),
        this.prisma.levelDefinition.findMany({
          select: { level: true, name: true },
        }),
      ]);
      // Map cấp độ (số) sang tên cấp để hiển thị, vd 2 -> "Học viên"
      const levelNameByLevel = new Map(levelDefs.map((l) => [l.level, l.name]));
      return rows
        .filter((r) => !departmentId || r.user.departmentId === departmentId)
        .map((r, i) => ({
          rank: i + 1,
          userId: r.userId,
          fullName: r.user.fullName,
          department: r.user.department?.name,
          xp: r.xp,
          level: r.level,
          levelName: levelNameByLevel.get(r.level) ?? null,
        }));
    }

    // Tính XP theo khoảng thời gian
    const now = new Date();
    let since: Date;
    if (period === 'month') {
      since = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      const day = now.getDay();
      since = new Date(now);
      since.setDate(now.getDate() - day);
      since.setHours(0, 0, 0, 0);
    }

    const txGroups = await this.prisma.xpTransaction.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 100,
    });

    const userIds = txGroups.map((g) => g.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        fullName: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return txGroups
      .filter(
        (g) =>
          !departmentId || userMap.get(g.userId)?.departmentId === departmentId,
      )
      .map((g, i) => {
        const u = userMap.get(g.userId);
        return {
          rank: i + 1,
          userId: g.userId,
          fullName: u?.fullName ?? '',
          department: u?.department?.name,
          xp: g._sum.amount ?? 0,
        };
      });
  }

  async getBadgeStats() {
    const badges = await this.prisma.badgeDefinition.findMany({
      include: { _count: { select: { userBadges: true } } },
      orderBy: { category: 'asc' },
    });
    return badges.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      category: b.category,
      iconSlug: b.iconSlug,
      xpBonus: b.xpBonus,
      awardedCount: b._count.userBadges,
    }));
  }

  // ─── Admin: CRUD LevelDefinition ─────────────────────────────────────────

  getLevels() {
    return this.prisma.levelDefinition.findMany({ orderBy: { level: 'asc' } });
  }

  createLevel(data: {
    level: number;
    name: string;
    minXp: number;
    color: string;
    iconSlug?: string;
  }) {
    return this.prisma.levelDefinition.create({ data });
  }

  updateLevel(
    id: string,
    data: Partial<{
      name: string;
      minXp: number;
      color: string;
      iconSlug: string;
    }>,
  ) {
    return this.prisma.levelDefinition.update({ where: { id }, data });
  }

  // ─── recomputeUserProgress ───────────────────────────────────────────────
  // Gọi sau khi xóa bài thi/vết tích thi của 1 người dùng (xem AdminService)
  // để XP, cấp độ, huy hiệu và bảng xếp hạng phản ánh đúng dữ liệu còn lại.
  // Giả định gọi nơi khác đã dọn xong các XpTransaction mồ côi (referenceId
  // trỏ tới bài thi vừa xóa) trước khi gọi hàm này.
  async recomputeUserProgress(userId: string): Promise<void> {
    const progress = await this.prisma.userProgress.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    // 1. Đếm lại tổng bài nộp / bài đạt từ dữ liệu Submission còn lại
    const [totalSubmissions, totalPassed] = await Promise.all([
      this.prisma.submission.count({ where: { userId } }),
      this.prisma.submission.count({ where: { userId, isPassed: true } }),
    ]);

    // 2. Tính lại XP = tổng các XpTransaction còn lại, rồi suy ra cấp độ
    const recalcXpAndLevel = async () => {
      const agg = await this.prisma.xpTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      });
      const xp = agg._sum.amount ?? 0;
      const levelDef = await this.prisma.levelDefinition.findFirst({
        where: { minXp: { lte: xp } },
        orderBy: { minXp: 'desc' },
      });
      return { xp, level: levelDef?.level ?? 1 };
    };
    let { xp, level } = await recalcXpAndLevel();

    await this.prisma.userProgress.update({
      where: { userId },
      data: { xp, level, totalSubmissions, totalPassed },
    });

    // 3. Gỡ những huy hiệu không còn đủ điều kiện với dữ liệu mới (dùng đúng
    //    totalSubmissions/totalPassed/level/xp vừa cập nhật ở bước 2)
    const userBadges = await this.prisma.userBadge.findMany({
      where: { userId },
      select: { badgeDefinitionId: true, badgeDefinition: true },
    });
    const evalProgress: ConditionProgress = {
      xp,
      totalSubmissions,
      totalPassed,
      currentStreak: progress.currentStreak,
      totalArenaWins: progress.totalArenaWins,
      level,
    };
    const revokedIds: string[] = [];
    for (const ub of userBadges) {
      const condition = ub.badgeDefinition
        .conditionJson as unknown as BadgeCondition;
      const stillMet = await this.evaluateCondition(
        condition,
        userId,
        evalProgress,
        ub.badgeDefinitionId,
      );
      if (!stillMet) revokedIds.push(ub.badgeDefinitionId);
    }

    if (revokedIds.length > 0) {
      await this.prisma.userBadge.deleteMany({
        where: { userId, badgeDefinitionId: { in: revokedIds } },
      });
      // Thu hồi luôn XP thưởng gắn với các huy hiệu vừa bị gỡ, rồi tính lại XP/cấp độ
      await this.prisma.xpTransaction.deleteMany({
        where: {
          userId,
          source: XpSource.BADGE_BONUS,
          referenceId: { in: revokedIds },
        },
      });
      const after = await recalcXpAndLevel();
      xp = after.xp;
      level = after.level;
      await this.prisma.userProgress.update({
        where: { userId },
        data: { xp, level },
      });
    }

    // 4. Ngược lại, dữ liệu mới cũng có thể vừa đủ điều kiện cho huy hiệu nào
    //    đó trước kia chưa đạt — dùng lại đúng luồng awardXp/checkAndAwardBadges
    //    hiện có để nhất quán (kể cả cộng XP thưởng nếu có).
    await this.checkAndAwardBadges(userId, progress.id);
  }

  async deleteLevel(id: string) {
    const levelDef = await this.prisma.levelDefinition.findUniqueOrThrow({
      where: { id },
    });
    const usersAtLevel = await this.prisma.userProgress.count({
      where: { level: levelDef.level },
    });
    if (usersAtLevel > 0) {
      throw new Error(
        `Không thể xóa cấp ${levelDef.level} vì có ${usersAtLevel} người dùng đang ở cấp này`,
      );
    }
    return this.prisma.levelDefinition.delete({ where: { id } });
  }
}
