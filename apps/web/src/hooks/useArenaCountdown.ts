// Đếm ngược mượt theo requestAnimationFrame, bám theo mốc deadlineAtMs tuyệt
// đối do SERVER phát ra (không phải setInterval đếm lùi từ 1 số giây cố định
// như trước — máy chủ mới là trọng tài duy nhất về thời gian).
//
// Tối ưu hiệu năng: ghi thẳng % thời gian còn lại vào CSS custom property của
// DOM node qua ref (mượt 60fps), chỉ setState khi số giây NGUYÊN đổi (dùng
// dạng hàm cập nhật trả về CHÍNH prev để React tự bỏ qua re-render những
// frame không đổi giây) — vòng tròn chạy mượt mà React không phải render lại
// mỗi frame.

import { useEffect, useRef, useState } from 'react'
import { formatCountdown } from '../lib/arena-format'

export interface ArenaCountdownState {
  /** Gắn vào node muốn nhận biến CSS --arena-progress (0 → 1, giảm dần theo thời gian). */
  ringRef: React.RefObject<HTMLElement | null>
  /** Số giây còn lại, làm tròn lên. */
  seconds: number
  /** true khi đã hết giờ (remain <= 0) hoặc chưa có deadline. */
  isExpired: boolean
}

export function useArenaCountdown(
  deadlineAtMs: number | null,
  startedAtMs: number | null,
  getServerNow: () => number,
): ArenaCountdownState {
  const ringRef = useRef<HTMLElement | null>(null)

  // "Điều chỉnh state lúc render" (mẫu chính thức của React để reset state
  // theo prop đổi, xem react.dev/learn/you-might-not-need-an-effect) thay vì
  // setState đồng bộ trong effect — tránh cascading render và đúng theo luật
  // react-hooks/set-state-in-effect.
  const [prevDeadline, setPrevDeadline] = useState(deadlineAtMs)
  const [remainMs, setRemainMs] = useState(() =>
    deadlineAtMs == null ? 0 : Math.max(0, deadlineAtMs - getServerNow()),
  )
  if (deadlineAtMs !== prevDeadline) {
    setPrevDeadline(deadlineAtMs)
    setRemainMs(deadlineAtMs == null ? 0 : Math.max(0, deadlineAtMs - getServerNow()))
  }

  useEffect(() => {
    if (deadlineAtMs == null) return
    const totalMs = Math.max(1, deadlineAtMs - (startedAtMs ?? deadlineAtMs - 1))
    let raf = 0

    const tick = () => {
      const remain = Math.max(0, deadlineAtMs - getServerNow())
      const progress = Math.min(1, Math.max(0, remain / totalMs))
      ringRef.current?.style.setProperty('--arena-progress', String(progress))
      // Chỉ đổi state (→ chỉ re-render) khi số giây NGUYÊN thay đổi — trả về
      // chính prev thì React tự bỏ qua re-render (Object.is bail-out).
      setRemainMs((prev) => (formatCountdown(prev) === formatCountdown(remain) ? prev : remain))
      if (remain > 0) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deadlineAtMs, startedAtMs, getServerNow])

  return {
    ringRef,
    seconds: formatCountdown(remainMs),
    isExpired: deadlineAtMs == null || remainMs <= 0,
  }
}
