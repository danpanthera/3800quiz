// Hàm băm dùng để đặt tên file audio thuyết minh (đề bài/đáp án/lĩnh vực).
// URL audio được dựng thẳng từ nội dung đang hiển thị: /giong-doc/<khoaGiongDoc(text)>.mp3
// — không có cột DB nào lưu đường dẫn này (xem lý do trong DEPLOYMENT.md, Phụ lục E).
//
// ⚠️ CHÉP TAY 2 BẢN — PHẢI GIỐNG TUYỆT ĐỐI bản ở apps/api/src/common/giong-doc-key.ts
// (đúng quy ước dự án đã áp dụng với arena.types.ts <-> apps/web/src/lib/arena-types.ts).
// Đổi thuật toán ở đây mà quên đổi bên kia sẽ làm URL audio sinh ra ở server không
// khớp với URL client tự dựng lúc phát. Bộ test vector đóng băng ở giong-doc-key.spec.ts
// tồn tại ở CẢ HAI phía để bên nào đổi một mình sẽ tự báo đỏ.
//
// Dùng FNV-1a 64-bit — KHÔNG dùng crypto.subtle/SHA-256 — vì crypto.subtle không tồn
// tại trên origin không bảo mật (http://<IP-LAN>:...), mà máy trình chiếu Đấu trường ở
// hội trường rất có thể mở bằng địa chỉ IP thay vì localhost/HTTPS. FNV-1a chạy đồng bộ,
// chỉ cần BigInt + TextEncoder (có sẵn ở cả Node và mọi trình duyệt), không phụ thuộc gì.

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/** Chuẩn hoá nhẹ trước khi băm: NFC, gộp khoảng trắng liên tiếp, cắt 2 đầu. */
export function chuanHoaNheDeBam(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** Băm FNV-1a 64-bit, trả về đúng 16 ký tự hex (đệm số 0 ở đầu nếu thiếu). */
export function bamFnv1a64(text: string): string {
  let hash = FNV_OFFSET_BASIS
  const bytes = new TextEncoder().encode(text)
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * Khoá dùng để đặt tên file: /giong-doc/<khoaGiongDoc(text)>.mp3
 * `text` là nội dung GỐC (chưa qua chuẩn hoá đọc số/viết tắt của script sinh audio)
 * — nhờ vậy client không cần biết gì về từ điển viết tắt, và hai phía không thể lệch.
 */
export function khoaGiongDoc(text: string): string {
  return bamFnv1a64(chuanHoaNheDeBam(text))
}

/** URL file audio tương ứng — nginx phục vụ tĩnh từ thư mục bind-mount /giong-doc/. */
export function urlGiongDoc(text: string): string {
  return `/giong-doc/${khoaGiongDoc(text)}.mp3`
}

// ─── Giọng Nam/Nữ theo TỪNG CÂU HỎI (đề bài + toàn bộ đáp án của câu đó) ────
// ⚠️ apps/api/scripts/sinh-giong-doc.ts IMPORT ĐÚNG 3 hằng số này (không tự
// định nghĩa lại) — client không có API nào cho biết "câu này giọng gì", phải
// TỰ TÍNH giống hệt server rồi mới ghép đúng URL. Đổi 1 trong 3 số dưới đây mà
// không sinh lại TOÀN BỘ audio ngay sẽ khiến phần đọc câu hỏi/đáp án bị CÂM
// (miss file), không lỗi ầm ĩ.
export const GIONG_NU_MAC_DINH = 'vi-VN-Neural2-A'
export const GIONG_NAM_MAC_DINH = 'vi-VN-Neural2-D'
export const TI_LE_GIONG_NAM = 0.5

/**
 * Quyết định giọng Nam/Nữ cho 1 câu hỏi — DỰA THẲNG vào khoá băm của NỘI DUNG
 * ĐỀ BÀI (ổn định qua mọi lần chạy, không cần biết ID) — gọi HÀM NÀY (không
 * phải tự băm riêng từng đáp án) rồi áp DÙNG CHUNG kết quả cho cả đề bài lẫn
 * mọi đáp án của câu, để trọn 1 câu hỏi luôn cùng 1 giọng.
 */
export function giongCuaCauHoi(noiDungDeBai: string): string {
  const k = khoaGiongDoc(noiDungDeBai)
  const n = parseInt(k.slice(0, 8), 16)
  return (n % 10000) / 10000 < TI_LE_GIONG_NAM ? GIONG_NAM_MAC_DINH : GIONG_NU_MAC_DINH
}

/**
 * Khoá audio CHO ĐỀ BÀI/ĐÁP ÁN — có ghép thêm `giong` vì cùng 1 đáp án có thể
 * bị NHIỀU CÂU HỎI KHÁC GIỌNG dùng chung (bộ đề ngân hàng hay tái dùng lại
 * đúng 1 đáp án ở nhiều câu) — nếu chỉ băm theo nội dung như khoaGiongDoc() sẽ
 * xảy ra tranh chấp: câu xử lý trước "chiếm" giọng, câu xử lý sau bị lệch.
 * Ký tự ␞ (record separator) không thể xuất hiện trong nội dung câu hỏi
 * thật, dùng làm dấu phân cách an toàn giữa text và giong.
 * KHÁC với khoaGiongDoc()/urlGiongDoc() — dùng cho nhãn "A/B/C/D" và tên lĩnh
 * vực, LUÔN đúng 1 giọng cố định dùng chung toàn hệ thống, không gắn theo câu.
 */
export function khoaGiongDocCauHoi(text: string, giong: string): string {
  return bamFnv1a64(`${chuanHoaNheDeBam(text)}␞${giong}`)
}

/** URL file audio cho đề bài/đáp án — xem khoaGiongDocCauHoi(). */
export function urlGiongDocCauHoi(text: string, giong: string): string {
  return `/giong-doc/${khoaGiongDocCauHoi(text, giong)}.mp3`
}
