// Logic thuần cho tính năng "nhắc nghỉ ngơi" — tách riêng khỏi hook để test được
// không cần DOM/antd (useScreenTimeReminder.ts chỉ lo timer + sessionStorage + hiển thị).

// Ngưỡng nhắc đầu tiên: 4 giờ, sau đó lặp lại mỗi 1 giờ tiếp theo nếu vẫn còn ở màn
// hình (5h, 6h, 7h...) — tránh việc chỉ nhắc đúng 1 lần rồi im re dù ngồi máy cả buổi.
export const NGUONG_DAU_MS = 4 * 60 * 60 * 1000
export const CHU_KY_LAP_LAI_MS = 60 * 60 * 1000

/**
 * Tính mốc (mili-giây tích luỹ) cần báo tiếp theo, hoặc null nếu chưa tới lúc báo.
 * `mocDaBaoMs` là mốc gần nhất ĐÃ báo (0 nếu chưa báo lần nào) — dùng để không báo
 * lại nhiều lần trong cùng 1 khung giờ, kể cả khi có nhiều tick dồn lại (VD máy
 * ngủ rồi thức dậy, tichLuyMs nhảy vọt qua nhiều mốc cùng lúc thì chỉ lấy mốc mới
 * nhất, không báo bù các mốc đã bỏ lỡ ở giữa).
 */
export function mocCanBaoTiepTheo(tichLuyMs: number, mocDaBaoMs: number): number | null {
  if (tichLuyMs < NGUONG_DAU_MS) return null
  const soChuKyDaTich = Math.floor((tichLuyMs - NGUONG_DAU_MS) / CHU_KY_LAP_LAI_MS)
  const mocHienTai = NGUONG_DAU_MS + soChuKyDaTich * CHU_KY_LAP_LAI_MS
  return mocHienTai > mocDaBaoMs ? mocHienTai : null
}
