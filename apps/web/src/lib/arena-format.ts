// Định dạng hiển thị dùng chung cho ArenaPage.tsx (MC) và ArenaPlayerPage.tsx
// (người chơi) — thời gian trả lời, đếm ngược, điểm cộng/trừ, đổi hạng.

/**
 * Thời gian trả lời dạng ss:ms — ví dụ 3412 → "03:412". null/undefined → "—"
 * (chưa trả lời). Trên 99 giây tự nở thành 3 chữ số: 103005 → "103:005".
 */
export function formatResponseTime(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const v = Math.max(0, Math.round(ms))
  const seconds = Math.floor(v / 1000)
  const millis = v % 1000
  return `${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`
}

/** Đếm ngược dạng giây nguyên, không bao giờ âm — dùng cho vòng đếm ngược. */
export function formatCountdown(remainMs: number): number {
  return Math.max(0, Math.ceil(remainMs / 1000))
}

/** Điểm cộng/trừ có dấu — 10 → "+10", -5 → "-5", 0 → "0". */
export function formatSignedPoints(points: number): string {
  if (points > 0) return `+${points}`
  return String(points)
}

/**
 * Nhãn đổi hạng — dương = thăng hạng, âm = tụt hạng, 0 = giữ nguyên.
 * Dùng rankBefore - rankAfter (số hạng NHỎ hơn là tốt hơn) làm quy ước.
 */
export function rankDeltaLabel(rankDelta: number): string {
  if (rankDelta > 0) return `▲${rankDelta}`
  if (rankDelta < 0) return `▼${Math.abs(rankDelta)}`
  return '–'
}
