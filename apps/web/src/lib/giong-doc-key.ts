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
