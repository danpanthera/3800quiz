import { useEffect } from 'react'
import { notification } from 'antd'
import { mocCanBaoTiepTheo } from '../lib/screen-time'

const CHU_KY_DEM_MS = 60 * 1000 // tick mỗi phút — đủ mịn cho ngưỡng tính bằng giờ

const KEY_TICH_LUY = 'screenTime.accumulatedMs'
const KEY_MOC_DA_BAO = 'screenTime.lastNotifiedMs'

function docSo(key: string): number {
  const raw = sessionStorage.getItem(key)
  const value = raw ? Number(raw) : 0
  return Number.isFinite(value) ? value : 0
}

/**
 * Cộng dồn thời gian THỰC SỰ đang mở tab này (bỏ qua lúc tab ở nền/thu nhỏ) vào
 * sessionStorage — tự reset khi đóng trình duyệt/tab, đúng tinh thần "một buổi
 * ngồi máy". Khi cộng dồn vượt mốc 4 giờ (rồi 5h, 6h...) thì bắn thông báo nhắc
 * nghỉ ngơi (logic tính mốc nằm ở lib/screen-time.ts để test được không cần DOM).
 * Không tính là "session đăng nhập" — chỉ đơn thuần thời gian mở web.
 */
export function useScreenTimeReminder() {
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return

      const tichLuyMs = docSo(KEY_TICH_LUY) + CHU_KY_DEM_MS
      sessionStorage.setItem(KEY_TICH_LUY, String(tichLuyMs))

      const mocCanBao = mocCanBaoTiepTheo(tichLuyMs, docSo(KEY_MOC_DA_BAO))
      if (mocCanBao === null) return

      sessionStorage.setItem(KEY_MOC_DA_BAO, String(mocCanBao))
      notification.warning({
        message: 'Bạn nên nghỉ ngơi',
        description: 'Đã quá 4 giờ tại máy tính',
        placement: 'topRight',
        duration: 0,
      })
    }, CHU_KY_DEM_MS)

    return () => clearInterval(interval)
  }, [])
}
