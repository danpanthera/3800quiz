/**
 * Thang breakpoint dùng chung cho toàn bộ web — khớp mặc định của antd Grid.
 * Không tự đổi giá trị ở đây nếu không đổi luôn theme antd — hook useDeviceType
 * và mọi @media trong index.css đều phải giữ đồng bộ thủ công với các mốc này
 * (CSS custom property không dùng được bên trong @media nên không thể chia sẻ
 * trực tiếp giữa TS và CSS).
 */
export const BREAKPOINTS = {
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
} as const
