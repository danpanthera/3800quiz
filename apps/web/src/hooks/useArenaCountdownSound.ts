// Phát tiếng tích tắc 4 giây cuối (to dần) + chuông "reeng!" khi hết giờ nếu
// còn chưa trả lời. Tách riêng khỏi useArenaCountdown vì điều kiện "còn chưa
// trả lời" khác nhau ở từng màn hình: người chơi xét chính đội mình
// (hasAnswered), còn MC/khán giả xét CẢ PHÒNG (đã đủ số đội bấm chưa).

import { useEffect, useRef } from 'react'
import { playTickSound, playTimeUpBell } from '../lib/feedback-fx'

const TICK_START_SEC = 4

export function useArenaCountdownSound(
  seconds: number,
  isExpired: boolean,
  shouldRingBell: boolean,
  resetKey: string | null | undefined,
  enabled: boolean,
) {
  const lastTickSecondRef = useRef<number | null>(null)
  const belledRef = useRef(false)

  // Sang câu mới (roundId đổi) thì cho phép tick/chuông chạy lại từ đầu.
  useEffect(() => {
    lastTickSecondRef.current = null
    belledRef.current = false
  }, [resetKey])

  useEffect(() => {
    if (!enabled) return
    if (isExpired) {
      if (belledRef.current) return
      belledRef.current = true
      if (shouldRingBell) void playTimeUpBell()
      return
    }
    if (seconds >= 1 && seconds <= TICK_START_SEC && lastTickSecondRef.current !== seconds) {
      lastTickSecondRef.current = seconds
      void playTickSound(seconds)
    }
  }, [seconds, isExpired, shouldRingBell, enabled])
}
