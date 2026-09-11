// Hợp đồng dữ liệu WebSocket của Đấu trường — dùng chung giữa ArenaPage.tsx và
// ArenaPlayerPage.tsx.
//
// ⚠️ File này là bản GƯƠNG chép tay của apps/api/src/arena/arena.types.ts — 2
// app không chia sẻ build step nên KHÔNG tự động đồng bộ. Sửa file nào cũng
// phải sửa file kia cho khớp. (Không mirror riêng ArenaOutgoing — đó là kênh
// nội bộ trong tiến trình API, không phơi ra qua WebSocket.)

export type ArenaOutcome = 'correct' | 'wrong' | 'no_answer'

export type ArenaRevealReasonValue = 'HOST' | 'DEADLINE' | 'SKIPPED'

// ─── arena.question ─────────────────────────────────────────────────────────

export interface ArenaQuestionOptionPayload {
  id: string
  content: string
}

export interface ArenaQuestionPayload {
  roundId: string
  order: number // 0-based
  totalRounds: number
  question: {
    id: string
    content: string
    imageUrl: string | null
    questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'
    subjectName: string | null // lĩnh vực trong ngân hàng câu hỏi, null nếu chưa phân loại
    options: ArenaQuestionOptionPayload[] // không kèm isCorrect
  }
  startedAtMs: number // epoch ms — mốc server bắt đầu tính giờ
  deadlineAtMs: number // epoch ms — mốc server tự khoá và công bố
  durationMs: number
  serverNowMs: number // epoch ms lúc phát — client ước lượng lệch đồng hồ
  hostMode: 'MANUAL' | 'AUTO'
  revealPauseSec: number
  teamsTotal: number // số đội CÓ người chơi
  answeredCount: number // luôn 0 ở đầu câu; dùng lại shape cho arena.state
}

// ─── arena.prepare (hiện lĩnh vực trước khi bật câu hỏi) ───────────────────

export interface ArenaPreparePayload {
  roundId: string
  order: number
  totalRounds: number
  subjectName: string | null
  prepareSec: number
  hostMode: 'MANUAL' | 'AUTO'
}

// ─── arena.buzz_in ──────────────────────────────────────────────────────────

export interface ArenaBuzzPayload {
  teamId: string
  teamName: string
  teamColor: string
  order: number // thứ tự bấm trong câu này (1-based)
  responseMs: number // đã bù trễ — dùng để hiển thị ss:ms ngay lập tức
  answeredCount: number
  teamsTotal: number
  serverNowMs: number
}

// ─── arena.locked ───────────────────────────────────────────────────────────

export interface ArenaLockedPayload {
  roundId: string
  serverNowMs: number
}

// ─── arena.revealed ─────────────────────────────────────────────────────────

export interface ArenaTeamRoundResult {
  teamId: string
  teamName: string
  teamColor: string
  outcome: ArenaOutcome
  selectedOptionIds: string[] // rỗng khi không trả lời
  responseMs: number | null // null khi không trả lời — UI hiện "—"
  rawResponseMs: number | null // thời gian thô, MC bật "chi tiết" mới xem
  latencyMs: number // RTT đã bù, minh bạch với người chơi
  speedRank: number | null // hạng tốc độ trên MỌI đáp án
  correctRank: number | null // hạng trong nhóm ĐÚNG — cái quyết định điểm
  isFastestCorrect: boolean // correctRank === 1
  pointsDelta: number // +10 / -5 / 0
  scoreBefore: number
  scoreAfter: number
  rankBefore: number
  rankAfter: number
  rankDelta: number // rankBefore - rankAfter (dương = thăng hạng)
}

export interface ArenaLeaderboardRow {
  teamId: string
  teamName: string
  teamColor: string
  score: number
  rank: number
  previousRank: number
  rankDelta: number
  correctCount: number
  totalAnswerMs: number
  lastPointsDelta: number
}

export interface ArenaRevealPayload {
  roundId: string
  order: number
  totalRounds: number
  questionId: string
  correctOptionIds: string[]
  explanation: string | null
  revealedAtMs: number
  serverNowMs: number
  revealReason: ArenaRevealReasonValue
  durationMs: number
  fastestTeamId: string | null // nhanh nhất TRONG SỐ trả lời đúng
  fastestOverallTeamId: string | null // bấm nhanh nhất bất kể đúng sai
  correctCount: number
  wrongCount: number
  noAnswerCount: number
  // MỌI đội trong phiên, đã sắp sẵn: đúng theo tốc độ → sai theo tốc độ → không trả lời
  results: ArenaTeamRoundResult[]
  leaderboard: ArenaLeaderboardRow[]
  nextAtMs: number | null // AUTO: mốc server sẽ tự sang câu kế
  isLastRound: boolean
}

// ─── arena.ended ────────────────────────────────────────────────────────────

export interface ArenaXpResult {
  levelUp: boolean
  newLevel: number
  newBadges: { code: string; name: string; iconSlug: string }[]
}

export interface ArenaEndPayload {
  type: 'ended'
  ranking: ArenaLeaderboardRow[]
  xpResults: Record<string, ArenaXpResult>
}

// ─── arena.state (snapshot khi vào lại giữa trận) ──────────────────────────

export interface ArenaStatePayload {
  sessionId: string
  status: 'LOBBY' | 'RUNNING' | 'FINISHED'
  serverNowMs: number
  myTeamId: string | null
  myTeamName: string | null
  myTeamColor: string | null
  teams: ArenaLeaderboardRow[]
  currentQuestion: ArenaQuestionPayload | null
  myAnswer: { selectedOptionIds: string[]; responseMs: number } | null
  buzzes: ArenaBuzzPayload[] // ai đã bấm, để dựng lại dải chip
  lastReveal: ArenaRevealPayload | null
  final: ArenaEndPayload | null
}

// ─── Đội & thành viên (dùng chung sảnh chờ + bảng điểm) ─────────────────────

export interface ArenaTeamMember {
  userId: string
  fullName: string
}

export interface ArenaTeam {
  id: string
  name: string
  color: string
  score: number
  rank?: number
  members?: ArenaTeamMember[]
  isPreset?: boolean
}
