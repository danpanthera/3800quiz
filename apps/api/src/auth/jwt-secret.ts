// Khoá mặc định chỉ dùng cho máy dev — không bao giờ được phép sống ở production.
const SECRET_MAC_DINH = 'change-this-secret';

// Độ dài tối thiểu chấp nhận được cho khoá ký JWT ở production.
const DO_DAI_TOI_THIEU = 32;

/**
 * Lấy khoá ký JWT.
 *
 * Ở production bắt buộc phải cấu hình khoá thật: thà dừng ngay lúc khởi động
 * còn hơn chạy im lặng bằng khoá mặc định mà ai đọc mã nguồn cũng đoán được —
 * khi đó bất kỳ ai cũng tự ký được token quản trị.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const laProduction = process.env.NODE_ENV === 'production';

  if (
    !secret ||
    secret === SECRET_MAC_DINH ||
    secret.length < DO_DAI_TOI_THIEU
  ) {
    if (laProduction) {
      throw new Error(
        `Thiếu JWT_SECRET hợp lệ (tối thiểu ${DO_DAI_TOI_THIEU} ký tự, khác giá trị mặc định) — ` +
          'không thể khởi động ở chế độ production.',
      );
    }
    return SECRET_MAC_DINH;
  }

  return secret;
}
