// Module dùng chung phát giọng đọc thuyết minh — dùng ở 2 nơi: chế độ phản hồi
// tức thì (InstantQuizPlayer) và Đấu trường (ArenaPage màn MC + ArenaSpectatorPage
// màn trình chiếu). KHÔNG dùng ở thi cổ điển (QuizPlayerPage) hay máy người chơi
// Đấu trường (ArenaPlayerPage) — cố ý, xem TinhNang.md.
//
// File audio sinh sẵn bằng `npm run giong-doc` (apps/api/scripts/sinh-giong-doc.ts),
// đặt tên theo hash nội dung — xem urlGiongDoc() ở giong-doc-key.ts. Thiếu file
// (câu mới thêm/sửa chưa sinh lại audio) → im lặng, KHÔNG báo lỗi ầm ĩ (fail-safe).
import { urlGiongDoc, urlGiongDocCauHoi } from './giong-doc-key'

export type PhamViGiongDoc = 'instant' | 'arena-host' | 'arena-spectator'

const KHOA_LUU: Record<PhamViGiongDoc, string> = {
  instant: '7800quiz.instant-player.giong-doc',
  'arena-host': '7800quiz.arena-host.giong-doc',
  'arena-spectator': '7800quiz.arena-spectator.giong-doc',
}

/** Mặc định TẮT ở mọi phạm vi — phải == 'on' mới coi là bật. */
export function dangBatGiongDoc(phamVi: PhamViGiongDoc): boolean {
  try {
    return localStorage.getItem(KHOA_LUU[phamVi]) === 'on'
  } catch {
    return false
  }
}

export function datGiongDoc(phamVi: PhamViGiongDoc, bat: boolean): void {
  try {
    localStorage.setItem(KHOA_LUU[phamVi], bat ? 'on' : 'off')
  } catch {
    /* trình duyệt chặn localStorage — chỉ mất ghi nhớ lựa chọn, bỏ qua */
  }
}

// ── Phát audio nối tiếp ──────────────────────────────────────────────────────
// Dùng lại DUY NHẤT 1 <audio> cấp module cho mọi lượt phát — đây là cách chắc
// chắn nhất để qua được chính sách autoplay của trình duyệt: phần tử đã được
// "mồi" bằng 1 cử chỉ bấm tay (moiGiongDoc) thì mọi lần play() bằng code sau đó
// trên CHÍNH phần tử đó đều được phép; tạo `new Audio()` mới cho từng câu có
// thể bị chặn lại từ đầu.

let theHienAudio: HTMLAudioElement | null = null
let daMoiKhoa = false
// "Thế hệ" — tăng mỗi khi dừng/phát lượt mới. Một lượt docLanLuot() đang chạy
// tự kiểm tra thế hệ của mình sau mỗi đoạn; lệch là dừng ngay, không có "đuôi"
// phát tiếp câu cũ khi đã chuyển câu mới hoặc bị dungGiongDoc() gọi tới.
let theHe = 0
// Callback huỷ của (các) phatMotFile đang chờ — dungGiongDoc() gọi thẳng thay vì
// dựa vào sự kiện 'abort' của <audio>: gán el.src mới cho CLIP KẾ TIẾP cũng tự
// nhiên phát sinh 'abort' cho clip VỪA phát xong (hành vi bình thường của trình
// duyệt khi đổi src) — nếu lắng nghe 'abort' để coi là "clip mới lỗi" thì mỗi
// đoạn sẽ bị chính đoạn kế tiếp "cắt" gần như ngay khi vừa bắt đầu, chỉ đoạn
// CUỐI cùng (không có đoạn nào sau để chen ngang) mới phát trọn vẹn.
let nguoiNhanHuy: Array<() => void> = []
// Nhớ các URL đã từng phát lỗi/404 — khỏi thử lại vô ích trong cùng phiên trang,
// đỡ chờ oan mỗi lần chuyển câu.
const khoaThieu = new Set<string>()

function layAudioElement(): HTMLAudioElement {
  if (!theHienAudio) {
    theHienAudio = new Audio()
    theHienAudio.preload = 'auto'
  }
  return theHienAudio
}

// Clip WAV câm dài 1 mẫu — chỉ dùng để "mồi" quyền autoplay, không phát ra tiếng.
const CLIP_CAM =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** Gọi TRONG chính handler click bật công tắc — mở khoá autoplay cho các lần play() sau. */
export function moiGiongDoc(): void {
  if (daMoiKhoa) return
  const el = layAudioElement()
  el.src = CLIP_CAM
  el.play()
    .then(() => el.pause())
    .catch(() => {
      /* trình duyệt vẫn chặn — các lần play() sau có thể tiếp tục bị chặn, bỏ qua im lặng */
    })
  daMoiKhoa = true
}

/** Dừng ngay lượt đang phát (nếu có) — an toàn gọi nhiều lần, gọi cả khi chưa phát gì. */
export function dungGiongDoc(): void {
  theHe++
  const el = theHienAudio
  if (el) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
  const canBao = nguoiNhanHuy
  nguoiNhanHuy = []
  canBao.forEach((huy) => huy())
}

function phatMotFile(url: string, theHeCuaLuotNay: number): Promise<void> {
  if (khoaThieu.has(url)) return Promise.resolve()
  return new Promise((resolve) => {
    const el = layAudioElement()
    let daXong = false
    const donDep = () => {
      el.removeEventListener('ended', xong)
      el.removeEventListener('error', loi)
      const i = nguoiNhanHuy.indexOf(huy)
      if (i >= 0) nguoiNhanHuy.splice(i, 1)
    }
    const xongMotLan = () => {
      if (daXong) return
      daXong = true
      donDep()
      resolve()
    }
    const xong = () => xongMotLan()
    const loi = () => {
      // Chỉ đánh dấu "thiếu file" khi đây vẫn là lượt hiện hành — lỗi do bị
      // dungGiongDoc() cắt ngang (đổi src giữa chừng) KHÔNG có nghĩa file thiếu.
      if (theHe === theHeCuaLuotNay) khoaThieu.add(url)
      xongMotLan()
    }
    // Huỷ do dungGiongDoc() gọi thẳng — CỐ Ý không lắng nghe sự kiện 'abort' của
    // <audio>: sự kiện đó cũng tự phát sinh khi đoạn KẾ TIẾP gán src mới (xem
    // giải thích ở khai báo nguoiNhanHuy phía trên).
    const huy = () => xongMotLan()
    nguoiNhanHuy.push(huy)
    el.addEventListener('ended', xong)
    el.addEventListener('error', loi)
    el.src = url
    el.currentTime = 0
    el.play().catch(loi)
  })
}

export interface TuyChonDocLanLuot {
  /** Khoảng nghỉ giữa 2 câu (ms). Mặc định 150ms. */
  gapMs?: number
  /** Hạn chót tính từ lúc gọi (ms) — hết giờ thì ngưng, không phát tiếp câu còn lại. */
  maxMs?: number
}

/**
 * 1 mục cần đọc — chuỗi thường (nhãn "A/B/C/D", tên lĩnh vực…) dùng URL 1 giọng
 * cố định chung toàn hệ thống (urlGiongDoc); còn ĐỀ BÀI/ĐÁP ÁN của 1 câu hỏi
 * phải truyền kèm `giong` (lấy từ giongCuaCauHoi(noiDungDeBai) ở nơi gọi) để
 * dùng ĐÚNG bản audio khớp giọng của câu đó (urlGiongDocCauHoi) — xem lý do ở
 * giong-doc-key.ts (đáp án có thể bị nhiều câu khác giọng dùng chung).
 */
export type MucDocLanLuot = string | { text: string; giong: string }

function cho(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Phát nối tiếp các mục — TỰ dựng URL từ nội dung (urlGiongDoc/urlGiongDocCauHoi
 * tuỳ mục có kèm `giong` hay không), tự bỏ qua chuỗi rỗng. An toàn gọi lượt mới
 * trong khi lượt cũ đang phát (lượt cũ tự dừng ở lần kiểm tra thế hệ kế tiếp).
 */
export async function docLanLuot(cacMuc: MucDocLanLuot[], tuyChon: TuyChonDocLanLuot = {}): Promise<void> {
  const theHeCuaLuotNay = ++theHe
  const gapMs = tuyChon.gapMs ?? 150
  const hetHanLuc = tuyChon.maxMs != null ? Date.now() + tuyChon.maxMs : null

  for (const mucGoc of cacMuc) {
    if (theHe !== theHeCuaLuotNay) return
    if (hetHanLuc != null && Date.now() >= hetHanLuc) return
    const text = (typeof mucGoc === 'string' ? mucGoc : mucGoc.text).trim()
    if (!text) continue
    const url = typeof mucGoc === 'string' ? urlGiongDoc(text) : urlGiongDocCauHoi(text, mucGoc.giong)

    await phatMotFile(url, theHeCuaLuotNay)
    if (theHe !== theHeCuaLuotNay) return
    await cho(gapMs)
  }
}

// ── Chống chồng tiếng giữa 2 tab/thiết bị (MC mở thêm tab trình chiếu…) ────────
// Chỉ áp dụng cho Đấu trường (arena-host/arena-spectator) — thi thường mỗi người
// làm bài riêng, không có tình huống "cùng phòng, chung loa" để phải phối hợp.

let kenhPhatSong: BroadcastChannel | null = null

function layKenhPhatSong(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === 'undefined') return null
    if (!kenhPhatSong) kenhPhatSong = new BroadcastChannel('7800quiz-giong-doc')
    return kenhPhatSong
  } catch {
    return null
  }
}

/** Báo cho các tab khác (cùng máy) biết mình vừa bắt đầu đọc — gọi khi bật công tắc. */
export function baoDangDoc(phamVi: PhamViGiongDoc): void {
  layKenhPhatSong()?.postMessage({ phamVi })
}

/**
 * Lắng nghe tab khác (cùng máy, cùng origin) báo đang đọc — dùng để tự tắt công
 * tắc của MÌNH và tránh 2 nguồn tiếng cùng lúc trong 1 phòng. Trả về hàm huỷ lắng nghe.
 */
export function theoDoiGiongDocONoiKhac(xuLy: (phamVi: PhamViGiongDoc) => void): () => void {
  const kenh = layKenhPhatSong()
  if (!kenh) return () => {}
  const nghe = (e: MessageEvent<{ phamVi: PhamViGiongDoc }>) => xuLy(e.data.phamVi)
  kenh.addEventListener('message', nghe)
  return () => kenh.removeEventListener('message', nghe)
}
