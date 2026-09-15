import { randomBytes } from 'crypto';

// Mật khẩu nội bộ đặt cho tài khoản dùng "Đăng nhập bằng AD" — KHÔNG BAO GIỜ
// được dùng để xác thực (tài khoản AD luôn bind qua LDAP, xem
// auth/ldap.service.ts), chỉ tồn tại vì cột passwordHash của User là NOT
// NULL. Không cần dễ đọc như mật khẩu mặc định cấp cho tài khoản nội bộ vì
// không ai được thấy giá trị này — sinh ngẫu nhiên thật để không ai đoán
// hay khai thác được.
export function sinhMatKhauNgauNhienChoTaiKhoanAD(): string {
  return randomBytes(24).toString('hex');
}

// Mật khẩu ngẫu nhiên NGƯỜI DÙNG THẬT phải tự gõ tay khi đăng nhập lần đầu
// (chế độ "mật khẩu ngẫu nhiên" lúc admin reset cho cán bộ, xem
// admin.service.ts:resetCanBoPasswords) — khác hẳn hàm phía trên (chuỗi hex
// 48 ký tự, không ai cần đọc). Bỏ các ký tự dễ nhầm khi đọc/gõ: 0/O, 1/l/I.
const BANG_CHU_DE_DOC = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function sinhMatKhauNgauNhienDeDoc(doDai = 10): string {
  const bytes = randomBytes(doDai);
  let ketQua = '';
  for (let i = 0; i < doDai; i++) {
    ketQua += BANG_CHU_DE_DOC[bytes[i] % BANG_CHU_DE_DOC.length];
  }
  return ketQua;
}
