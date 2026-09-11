// Đồng bộ đồng hồ client-server theo thuật toán Cristian — dùng để đếm ngược
// đúng theo deadlineAtMs (mốc epoch ms tuyệt đối server phát ra) thay vì tin
// đồng hồ máy người dùng, vốn có thể lệch vài giây.

import { useCallback, useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'

const RESYNC_INTERVAL_MS = 20_000
const SYNC_TIMEOUT_MS = 2000
const INITIAL_SAMPLES = 3

/**
 * Trả về hàm getServerNow() — luôn đọc offset mới nhất, không gây re-render.
 * Đồng bộ lại định kỳ (nới dần ngưỡng "mẫu tốt nhất" để bám theo mạng đổi).
 */
export function useServerClock(socket: Socket | null): () => number {
  const offsetRef = useRef(0) // serverNowMs - clientNowMs
  const bestRttRef = useRef(Infinity)

  const sync = useCallback(async () => {
    if (!socket?.connected) return
    const t0 = Date.now()
    try {
      const res = (await socket.timeout(SYNC_TIMEOUT_MS).emitWithAck('arena.time')) as {
        serverNowMs: number
      }
      const rtt = Date.now() - t0
      // Chỉ nhận mẫu TỐT HƠN mẫu đã có — RTT nhỏ nhất là mẫu ít nhiễu nhất.
      if (rtt < bestRttRef.current) {
        bestRttRef.current = rtt
        offsetRef.current = res.serverNowMs - (t0 + rtt / 2)
      }
    } catch {
      // Quá hạn hoặc mất kết nối — bỏ qua mẫu này, giữ offset cũ
    }
  }, [socket])

  useEffect(() => {
    if (!socket) return
    void sync()
    void sync()
    void sync()

    const id = setInterval(() => {
      // Nới ngưỡng "mẫu tốt nhất" dần theo thời gian để mạng đổi (tốt lên hoặc
      // xấu đi) vẫn được ghi nhận, không bị mẫu cũ khoá cứng mãi.
      bestRttRef.current *= 1.5
      void sync()
    }, RESYNC_INTERVAL_MS)

    const onConnect = () => {
      bestRttRef.current = Infinity
      for (let i = 0; i < INITIAL_SAMPLES; i++) void sync()
    }
    socket.on('connect', onConnect)

    return () => {
      clearInterval(id)
      socket.off('connect', onConnect)
    }
  }, [socket, sync])

  return useCallback(() => Date.now() + offsetRef.current, [])
}
