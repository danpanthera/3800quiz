import { describe, it, expect } from 'vitest'
import { mocCanBaoTiepTheo, NGUONG_DAU_MS, CHU_KY_LAP_LAI_MS } from './screen-time'

describe('mocCanBaoTiepTheo', () => {
  it('chưa tới 4 giờ → null, không báo', () => {
    expect(mocCanBaoTiepTheo(NGUONG_DAU_MS - 1, 0)).toBeNull()
  })

  it('vừa chạm mốc 4 giờ, chưa báo lần nào → báo mốc 4h', () => {
    expect(mocCanBaoTiepTheo(NGUONG_DAU_MS, 0)).toBe(NGUONG_DAU_MS)
  })

  it('đã báo mốc 4h rồi, vẫn trong khung 4h-5h → không báo lại', () => {
    expect(mocCanBaoTiepTheo(NGUONG_DAU_MS + 1000, NGUONG_DAU_MS)).toBeNull()
  })

  it('chạm mốc 5h sau khi đã báo mốc 4h → báo mốc 5h', () => {
    expect(mocCanBaoTiepTheo(NGUONG_DAU_MS + CHU_KY_LAP_LAI_MS, NGUONG_DAU_MS)).toBe(
      NGUONG_DAU_MS + CHU_KY_LAP_LAI_MS,
    )
  })

  it('tich luỹ nhảy vọt qua nhiều mốc (máy ngủ rồi thức) → chỉ báo mốc mới nhất, không báo bù mốc đã lỡ', () => {
    const tichLuyMs = NGUONG_DAU_MS + 3.5 * CHU_KY_LAP_LAI_MS // 7h30, đã lỡ mốc 5h/6h/7h
    expect(mocCanBaoTiepTheo(tichLuyMs, 0)).toBe(NGUONG_DAU_MS + 3 * CHU_KY_LAP_LAI_MS) // 7h, không phải 5h
  })

  it('mốc hiện tại trùng mốc đã báo → không báo lại', () => {
    const moc = NGUONG_DAU_MS + 2 * CHU_KY_LAP_LAI_MS
    expect(mocCanBaoTiepTheo(moc, moc)).toBeNull()
  })
})
