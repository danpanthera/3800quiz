// Kết nối Socket.IO dùng chung cho ArenaPage.tsx (MC) và ArenaPlayerPage.tsx
// (người chơi) — trước đây mỗi trang tự viết logic io(...) riêng, nay gộp lại
// 1 chỗ để không lệch cấu hình (auth token, transports, phản hồi arena.ping).

import { io, Socket } from 'socket.io-client'

const WS_URL = import.meta.env.VITE_WS_URL ?? window.location.origin

/**
 * Tạo 1 kết nối Socket.IO mới cho Đấu trường — tự gắn JWT hiện có và tự đáp
 * lại arena.ping (đo RTT phía server) bằng 1 dòng ack rỗng. Chỉ dùng
 * transport 'websocket' — Caddyfile prod không có phương án lùi về polling.
 */
export function createArenaSocket(): Socket {
  const token = localStorage.getItem('token')
  const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] })
  // Server đo độ trễ khứ hồi bằng emitWithAck — chỉ cần gọi ack() ngay lập tức,
  // không cần trả dữ liệu gì.
  socket.on('arena.ping', (ack: () => void) => ack())
  return socket
}
