// Vòng đếm ngược cho Đấu trường — dùng chung màn MC và màn người chơi. Nhận
// từng field rời từ useArenaCountdown() (không gộp thành 1 object) vì
// ringRef ghi thẳng CSS custom property, không qua React state, và gộp
// chung với seconds/isExpired vào 1 object khiến ESLint (react-hooks/refs)
// hiểu lầm là đọc ref lúc render.

import type { RefObject } from 'react'

const LOW_THRESHOLD_SEC = 5

export function ArenaCountdownRing({
  ringRef,
  seconds,
  isExpired,
  size = 56,
}: {
  ringRef: RefObject<HTMLElement | null>
  seconds: number
  isExpired: boolean
  size?: number
}) {
  const isLow = seconds <= LOW_THRESHOLD_SEC && !isExpired
  return (
    <div
      ref={ringRef as RefObject<HTMLDivElement>}
      className={`arena-timer-ring${isLow ? ' arena-timer-low' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      <span className="arena-timer-ring-value">{isExpired ? 0 : seconds}</span>
    </div>
  )
}
