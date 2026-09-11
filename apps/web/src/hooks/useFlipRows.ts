// Hoạt ảnh đổi hạng bảng xếp hạng bằng kỹ thuật FLIP (First-Last-Invert-Play)
// thuần CSS/JS — không cần framer-motion (không có trong dependency của repo).
//
// Cách dùng: gọi bindRow(teamId) làm ref-callback cho mỗi hàng trong danh sách
// (key={teamId} — BẮT BUỘC dùng teamId làm key, không dùng index, để React giữ
// nguyên DOM node khi thứ tự đổi, nếu không FLIP vô nghĩa).

import { useLayoutEffect, useRef } from 'react'

const FLIP_DURATION_MS = 520
const FLIP_EASING = 'cubic-bezier(0.2, 0.9, 0.3, 1)'
const MIN_DELTA_PX = 1

export function useFlipRows(signature: string) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const prevTops = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    nodes.current.forEach((el, key) => {
      const top = el.getBoundingClientRect().top
      const before = prevTops.current.get(key)
      if (before !== undefined && !reduceMotion) {
        const dy = before - top
        if (Math.abs(dy) > MIN_DELTA_PX) {
          // Invert: nhảy thẳng về vị trí cũ không hoạt ảnh...
          el.style.transition = 'none'
          el.style.transform = `translateY(${dy}px)`
          // ...rồi Play: gỡ transform có hoạt ảnh ở frame kế tiếp — trình
          // duyệt trượt mượt từ vị trí cũ về vị trí mới thật.
          requestAnimationFrame(() => {
            el.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`
            el.style.transform = ''
          })
        }
      }
      prevTops.current.set(key, top)
    })
    // signature (vd: danh sách teamId theo thứ tự mới, join bằng dấu phẩy) là
    // tín hiệu duy nhất cần theo dõi — nội dung nodes/prevTops đổi liên tục
    // theo từng render nên không đưa vào dependency.
  }, [signature])

  return (key: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el)
    else nodes.current.delete(key)
  }
}
