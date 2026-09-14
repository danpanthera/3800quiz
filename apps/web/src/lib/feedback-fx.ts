// Hiệu ứng phản hồi nhẹ cho phần luyện tập/Arena — KHÔNG dùng cho thi chính thức
// (giữ trải nghiệm thi nghiêm túc, không xao nhãng). Âm thanh tổng hợp bằng Web
// Audio API (không cần file mp3), an toàn bỏ qua nếu trình duyệt chặn AudioContext.

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

function beep(frequency: number, durationMs: number, delayMs = 0, type: OscillatorType = 'sine', volume = 0.15) {
  const ctx = getAudioContext()
  if (!ctx) return
  const startAt = ctx.currentTime + delayMs / 1000
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startAt)
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationMs / 1000)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + durationMs / 1000 + 0.02)
}

export function playCorrectSound() {
  beep(660, 90, 0)
  beep(880, 140, 90)
}

export function playWrongSound() {
  beep(220, 220, 0, 'sawtooth', 0.1)
}

export function playWinSound() {
  beep(523, 100, 0)
  beep(659, 100, 100)
  beep(784, 220, 200)
}

// Tiếng tích tắc đếm ngược — chỉ vang ở 4 giây cuối, TO DẦN theo từng giây
// (secondsLeft 4 → 1) để tạo cảm giác gấp gáp. Cùng cao độ, chỉ đổi âm lượng.
export function playTickSound(secondsLeft: number) {
  const clamped = Math.min(4, Math.max(1, Math.round(secondsLeft)))
  const volume = 0.08 + (4 - clamped) * 0.06 // giây 4: 0.08 → giây 1: 0.26
  beep(784, 90, 0, 'square', volume)
}

// Chuông "reeng!" khi hết giờ mà đội/người chơi đó VẪN CHƯA gửi đáp án. Đội đã
// trả lời rồi thì không gọi hàm này (xem useArenaCountdownSound).
export function playTimeUpBell() {
  beep(988, 200, 0, 'triangle', 0.22)
  beep(1480, 420, 60, 'triangle', 0.16)
}

export async function fireConfetti() {
  const confetti = (await import('canvas-confetti')).default
  confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } })
}

export async function fireConfettiBurst() {
  const confetti = (await import('canvas-confetti')).default
  const end = Date.now() + 700
  // Tông thương hiệu Agribank: đỏ bordeaux + vàng + trắng ngọc trai
  const colors = ['#7A1428', '#FFB300', '#F8F4EC']
  ;(function frame() {
    confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors })
    confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors })
    if (Date.now() < end) requestAnimationFrame(frame)
  })()
}

// Arpeggio 3 nốt cao, ngắn gọn hơn playWinSound — chỉ đội NHANH NHẤT trả lời
// đúng trong 1 câu mới nghe thấy, phân biệt với "đúng" (playCorrectSound) và
// "vô địch chung cuộc" (playWinSound).
export function playFastestSound() {
  beep(880, 70, 0)
  beep(1046, 70, 60)
  beep(1318, 120, 120)
}

// Lấp lánh nhỏ tông vàng cho đội nhanh nhất đúng — nhẹ hơn fireConfettiBurst
// (dùng cho vô địch chung cuộc), không làm rối màn hình công bố từng câu.
export async function fireGoldSparkle() {
  const confetti = (await import('canvas-confetti')).default
  confetti({
    particleCount: 24,
    spread: 60,
    scalar: 0.7,
    startVelocity: 28,
    origin: { y: 0.4 },
    colors: ['#FFB300', '#E0B44C', '#F8F4EC'],
  })
}
