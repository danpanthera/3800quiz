import { useEffect, useState } from 'react'
import { Grid } from 'antd'

export type DeviceCategory = 'phone' | 'tablet' | 'desktop'
export type DeviceOS = 'ios' | 'android' | 'other'

export interface DeviceType {
  /** Phân loại theo bề ngang màn hình: phone <576px, tablet 576-991px, desktop ≥992px. */
  category: DeviceCategory
  /** true khi category khác 'desktop' — dùng cho quyết định điều hướng kiểu AppLayout (ngưỡng lg). */
  isCompact: boolean
  /** Input chạm là chính (matchMedia pointer:coarse) — độc lập với kích thước màn hình. */
  isTouch: boolean
  /** Chỉ dùng để tinh chỉnh riêng nền tảng (safe-area, style thanh trạng thái...), không rẽ nhánh nghiệp vụ. */
  os: DeviceOS
  /** Bản đồ breakpoint gốc của antd — dùng khi cần ngưỡng khác lg (vd md) mà không phải gọi Grid.useBreakpoint() lần 2. */
  screens: ReturnType<typeof Grid.useBreakpoint>
}

const detectedOS: DeviceOS = (() => {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  if (isIOS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
})()

function getIsTouch() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

export function useDeviceType(): DeviceType {
  const screens = Grid.useBreakpoint()
  const [isTouch, setIsTouch] = useState(getIsTouch)

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)')
    const onChange = () => setIsTouch(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const category: DeviceCategory = !screens.sm ? 'phone' : !screens.lg ? 'tablet' : 'desktop'

  return {
    category,
    isCompact: category !== 'desktop',
    isTouch,
    os: detectedOS,
    screens,
  }
}
