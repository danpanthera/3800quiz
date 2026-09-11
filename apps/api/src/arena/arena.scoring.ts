// Các hàm THUẦN cho logic chấm điểm/xếp hạng/thời gian của Đấu trường — không
// phụ thuộc Prisma hay Socket.IO nên test được trực tiếp, không cần mock.
// arena.service.ts và arena.gateway.ts gọi lại các hàm này, không tự viết
// logic tương đương ở nơi khác (tránh lệch công thức chấm điểm giữa 2 nơi).

import type { QuestionType } from '@prisma/client';
import type { ArenaTeamRoundResult } from './arena.types';

// ─── Chấm đúng/sai một câu trả lời ───────────────────────────────────────────

export interface GradableQuestion {
  questionType: QuestionType;
  options: { id: string; isCorrect: boolean; orderIndex: number }[];
}

export interface GradeResult {
  isCorrect: boolean;
  correctOptionIds: string[];
}

/**
 * Chấm 1 câu trả lời Arena — cùng ngữ nghĩa với
 * attempts.service.ts#gradeQuestion để không lệch cách chấm giữa 2 module.
 *
 * ORDERING: so sánh CÓ THỨ TỰ (không sort selectedOptionIds) — sắp sai thứ tự
 * là sai, dù chọn đúng bộ đáp án.
 * SINGLE/MULTIPLE: so sánh tập hợp đã sort — thứ tự chọn không quan trọng.
 */
export function gradeArenaAnswer(
  question: GradableQuestion,
  selectedOptionIds: string[],
): GradeResult {
  if (question.questionType === 'ORDERING') {
    const correctOrder = question.options
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((option) => option.id);
    return {
      isCorrect:
        JSON.stringify(correctOrder) === JSON.stringify(selectedOptionIds),
      correctOptionIds: correctOrder,
    };
  }

  const correctOptionIds = question.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id)
    .sort();
  return {
    isCorrect:
      JSON.stringify(correctOptionIds) ===
      JSON.stringify([...selectedOptionIds].sort()),
    correctOptionIds,
  };
}

// ─── Thời gian phản hồi: kẹp theo độ trễ đã bù + thời lượng câu hỏi ─────────

export interface ComputeResponseMsInput {
  receivedAtMs: number;
  startedAtMs: number;
  deadlineAtMs: number;
  compensationMs: number;
}

export interface ComputeResponseMsResult {
  responseMs: number;
  rawResponseMs: number;
}

/**
 * Tính thời gian phản hồi thô và thời gian chính thức (đã bù độ trễ mạng).
 * responseMs LUÔN nằm trong [0, durationMs] — không thể âm (bù quá đà) và
 * không thể vượt quá thời lượng câu hỏi (đáp án đến sau deadline không được
 * tính lố quá thời lượng câu).
 */
export function computeResponseMs(
  input: ComputeResponseMsInput,
): ComputeResponseMsResult {
  const rawResponseMs = Math.max(0, input.receivedAtMs - input.startedAtMs);
  const durationMs = Math.max(0, input.deadlineAtMs - input.startedAtMs);
  const responseMs = Math.min(
    Math.max(0, rawResponseMs - input.compensationMs),
    durationMs,
  );
  return { responseMs, rawResponseMs };
}

// ─── Xếp hạng tốc độ + tính điểm theo pointsForRank ─────────────────────────

export interface RankableBuzz {
  id: string;
  teamId: string;
  isCorrect: boolean;
  responseMs: number;
  answeredAt: Date;
}

export interface RankedBuzz extends RankableBuzz {
  speedRank: number; // 1-based, tính trên MỌI đáp án (kể cả sai)
  correctRank: number | null; // 1-based, chỉ tính trên đáp án ĐÚNG
  pointsAwarded: number;
}

/**
 * Gán speedRank cho mọi đáp án và correctRank + điểm cho đáp án đúng, theo
 * đúng thứ tự answeredAt tăng dần (tiêu chí phụ id để tất định khi trùng
 * mili-giây). pointsForRank hết phần tử thì dùng giá trị cuối cùng của mảng;
 * mảng rỗng thì không cộng điểm.
 */
export function rankAndScoreBuzzes(
  buzzes: RankableBuzz[],
  pointsForRank: number[],
  penaltyWrong: number,
): RankedBuzz[] {
  const sorted = [...buzzes].sort((a, b) => {
    const diff = a.answeredAt.getTime() - b.answeredAt.getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  let correctIndex = 0;
  return sorted.map((buzz, index) => {
    if (buzz.isCorrect) {
      const pts =
        pointsForRank[correctIndex] ??
        pointsForRank[pointsForRank.length - 1] ??
        0;
      const result: RankedBuzz = {
        ...buzz,
        speedRank: index + 1,
        correctRank: correctIndex + 1,
        pointsAwarded: pts,
      };
      correctIndex++;
      return result;
    }
    return {
      ...buzz,
      speedRank: index + 1,
      correctRank: null,
      pointsAwarded: penaltyWrong > 0 ? -penaltyWrong : 0,
    };
  });
}

// ─── Phá hoà xếp hạng đội ────────────────────────────────────────────────────

export interface RankableTeam {
  id: string;
  score: number;
  correctCount: number;
  totalAnswerMs: number;
  joinedAt: Date;
}

/**
 * Thứ tự xếp hạng đội — dùng CHUNG cho bảng xếp hạng LIVE và bảng xếp hạng
 * cuối trận để không mâu thuẫn nhau:
 *   1. Điểm cao hơn thắng
 *   2. Bằng điểm: nhiều câu đúng hơn thắng
 *   3. Vẫn bằng: tổng thời gian trả lời đúng ngắn hơn thắng
 *   4. Vẫn bằng: vào phòng sớm hơn thắng (chốt hạ, luôn tất định)
 */
export function compareTeamsForRanking(
  a: RankableTeam,
  b: RankableTeam,
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.correctCount !== b.correctCount) return b.correctCount - a.correctCount;
  if (a.totalAnswerMs !== b.totalAnswerMs)
    return a.totalAnswerMs - b.totalAnswerMs;
  return a.joinedAt.getTime() - b.joinedAt.getTime();
}

// ─── Dựng kết quả từng đội cho payload arena.revealed ───────────────────────

export interface TeamForReveal {
  id: string;
  name: string;
  color: string;
}

export interface BuzzForReveal {
  teamId: string;
  isCorrect: boolean;
  selectedOptionIds: string[];
  responseMs: number;
  rawResponseMs: number;
  latencyMs: number;
  speedRank: number | null;
  correctRank: number | null;
  pointsAwarded: number;
  scoreBefore: number;
  scoreAfter: number;
}

/**
 * Dựng đầy đủ kết quả từng đội cho 1 vòng — kể cả đội KHÔNG trả lời (outcome
 * 'no_answer', responseMs null). Đội không trả lời có scoreBefore = scoreAfter
 * = điểm hiện tại của đội (không đổi trong vòng này). Sắp sẵn: đúng theo tốc
 * độ → sai theo tốc độ → không trả lời, để UI render thẳng không cần sort lại.
 */
export function buildTeamRoundResults(
  teams: TeamForReveal[],
  buzzesByTeamId: Map<string, BuzzForReveal>,
  currentScoreByTeamId: Map<string, number>,
  rankBeforeByTeamId: Map<string, number>,
  rankAfterByTeamId: Map<string, number>,
): ArenaTeamRoundResult[] {
  const rows = teams.map((team): ArenaTeamRoundResult => {
    const buzz = buzzesByTeamId.get(team.id);
    const rankBefore = rankBeforeByTeamId.get(team.id) ?? 0;
    const rankAfter = rankAfterByTeamId.get(team.id) ?? 0;
    if (!buzz) {
      const currentScore = currentScoreByTeamId.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color,
        outcome: 'no_answer',
        selectedOptionIds: [],
        responseMs: null,
        rawResponseMs: null,
        latencyMs: 0,
        speedRank: null,
        correctRank: null,
        isFastestCorrect: false,
        pointsDelta: 0,
        scoreBefore: currentScore,
        scoreAfter: currentScore,
        rankBefore,
        rankAfter,
        rankDelta: rankBefore - rankAfter,
      };
    }
    return {
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      outcome: buzz.isCorrect ? 'correct' : 'wrong',
      selectedOptionIds: buzz.selectedOptionIds,
      responseMs: buzz.responseMs,
      rawResponseMs: buzz.rawResponseMs,
      latencyMs: buzz.latencyMs,
      speedRank: buzz.speedRank,
      correctRank: buzz.correctRank,
      isFastestCorrect: buzz.correctRank === 1,
      pointsDelta: buzz.pointsAwarded,
      scoreBefore: buzz.scoreBefore,
      scoreAfter: buzz.scoreAfter,
      rankBefore,
      rankAfter,
      rankDelta: rankBefore - rankAfter,
    };
  });

  // Sắp: đúng (theo correctRank) → sai (theo speedRank) → không trả lời
  return rows.sort((a, b) => {
    const rank = (r: ArenaTeamRoundResult) =>
      r.outcome === 'correct' ? 0 : r.outcome === 'wrong' ? 1 : 2;
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.outcome === 'correct' && b.outcome === 'correct') {
      return (a.correctRank ?? 0) - (b.correctRank ?? 0);
    }
    if (a.outcome === 'wrong' && b.outcome === 'wrong') {
      return (a.speedRank ?? 0) - (b.speedRank ?? 0);
    }
    return 0;
  });
}
