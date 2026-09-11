/**
 * Danh sách origin được phép gọi API, đọc từ biến môi trường CORS_ORIGIN
 * (nhiều giá trị ngăn cách bằng dấu phẩy).
 *
 * Ở production web và API dùng chung một domain qua Caddy nên thực tế trình duyệt
 * không phát sinh request cross-origin nào; khai báo cụ thể chỉ để chặn các trang
 * ngoài gọi API bằng token của cán bộ. Không đặt biến thì mở cho mọi origin như cũ,
 * giữ nguyên trải nghiệm trên máy dev.
 */
export function getCorsOrigin(): string[] | true {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return true;

  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : true;
}
