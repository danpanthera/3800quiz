import { describe, it, expect } from 'vitest'
import { formatResponseTime, formatCountdown, formatSignedPoints, rankDeltaLabel } from './arena-format'

describe('formatResponseTime', () => {
  it('định dạng ss:ms cơ bản', () => {
    expect(formatResponseTime(3412)).toBe('03:412')
  })

  it('0ms → 00:000', () => {
    expect(formatResponseTime(0)).toBe('00:000')
  })

  it('null → gạch ngang (chưa trả lời)', () => {
    expect(formatResponseTime(null)).toBe('—')
  })

  it('undefined → gạch ngang', () => {
    expect(formatResponseTime(undefined)).toBe('—')
  })

  it('trên 99 giây tự nở thành 3 chữ số', () => {
    expect(formatResponseTime(103005)).toBe('103:005')
  })

  it('làm tròn số thập phân', () => {
    expect(formatResponseTime(1234.6)).toBe('01:235')
  })

  it('kẹp giá trị âm về 0', () => {
    expect(formatResponseTime(-50)).toBe('00:000')
  })
})

describe('formatCountdown', () => {
  it('làm tròn lên số giây nguyên', () => {
    expect(formatCountdown(4001)).toBe(5)
  })

  it('không bao giờ âm', () => {
    expect(formatCountdown(-500)).toBe(0)
  })

  it('0ms → 0 giây', () => {
    expect(formatCountdown(0)).toBe(0)
  })
})

describe('formatSignedPoints', () => {
  it('điểm dương có dấu +', () => {
    expect(formatSignedPoints(10)).toBe('+10')
  })

  it('điểm âm giữ nguyên dấu -', () => {
    expect(formatSignedPoints(-5)).toBe('-5')
  })

  it('điểm 0 không có dấu', () => {
    expect(formatSignedPoints(0)).toBe('0')
  })
})

describe('rankDeltaLabel', () => {
  it('thăng hạng hiện mũi tên lên', () => {
    expect(rankDeltaLabel(2)).toBe('▲2')
  })

  it('tụt hạng hiện mũi tên xuống', () => {
    expect(rankDeltaLabel(-3)).toBe('▼3')
  })

  it('giữ nguyên hạng hiện gạch ngang', () => {
    expect(rankDeltaLabel(0)).toBe('–')
  })
})
