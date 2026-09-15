import { Injectable, Logger } from '@nestjs/common';
import { Client, InvalidCredentialsError } from 'ldapts';

// Kết quả 1 lần thử bind — phân biệt rõ "sai mật khẩu" (lỗi của người dùng,
// tính vào bộ đếm khoá tài khoản như mật khẩu nội bộ) với "AD không phản
// hồi" (lỗi hạ tầng, KHÔNG được tính là 1 lần sai, càng không được lùi về
// xác thực nội bộ — fail-closed).
export type KetQuaBindAD =
  | { ok: true }
  | { ok: false; lyDo: 'saiMatKhau' | 'khongKetNoiDuoc' };

@Injectable()
export class LdapAuthService {
  private readonly logger = new Logger(LdapAuthService.name);

  // Đã xác nhận thật (Sếp, 2026-09-15): tên máy RODC "3800-RODC-01", IP
  // `10.73.0.11` (DEPLOYMENT.md mục 3.2). CHƯA xác nhận: cổng LDAPS có mở
  // không, chứng chỉ CA nào cấp. Bắt buộc chạy scripts/kiem-tra-ldap-rodc.sh
  // trên PROD 3800quiz trước khi bật tính năng này cho bất kỳ ai — xem
  // LDAP.md.
  private readonly url =
    process.env.LDAP_URL?.trim() ||
    'ldaps://3800-RODC-01.corp.agribank.com.vn:636';
  // Định dạng tên đăng nhập gửi lên AD khi bind — "%s" thay bằng username.
  // Mặc định kiểu "down-level" CORP\username — đúng kiểu cán bộ 7800quiz vẫn
  // gõ ở màn hình đăng nhập Windows/AD (CORP là NetBIOS domain — giả định
  // dùng chung 1 rừng AD toàn ngân hàng, CHƯA kiểm chứng riêng bằng 1 lần bind
  // thật cho 3800). Nếu tài khoản test báo sai mật khẩu dù gõ đúng mật khẩu AD
  // thật, thử đổi biến này sang kiểu UPN "%s@corp.agribank.com.vn" rồi khởi
  // động lại container, KHÔNG cần build lại.
  private readonly bindTemplate =
    process.env.LDAP_BIND_TEMPLATE?.trim() || 'CORP\\%s';
  private readonly timeoutMs = Number(process.env.LDAP_TIMEOUT_MS) || 5000;

  // Bind pass-through: gửi thẳng username/password người dùng vừa gõ lên AD
  // để chính AD tự xác thực — không dùng tài khoản dịch vụ, không lưu, không
  // đồng bộ mật khẩu AD về phía ứng dụng. Kết quả bind NÀY chính là kết quả
  // xác thực, dùng đúng 1 lần rồi bỏ.
  async binhBangMatKhauAD(
    username: string,
    password: string,
  ): Promise<KetQuaBindAD> {
    const client = new Client({
      url: this.url,
      connectTimeout: this.timeoutMs,
      timeout: this.timeoutMs,
    });
    try {
      await client.bind(this.bindTemplate.replace('%s', username), password);
      return { ok: true };
    } catch (err: unknown) {
      // resultCode 49 (InvalidCredentialsError) gộp chung mọi lý do AD từ
      // chối bind — sai mật khẩu, tài khoản khoá/hết hạn/ngoài giờ đăng nhập
      // (AD phân biệt bằng mã phụ "data 52e/525/530/..." trong message, IT
      // tra ở log nếu cần) — với người dùng thì đều là "không vào được", nên
      // gộp thành 1 thông báo quen thuộc.
      if (err instanceof InvalidCredentialsError) {
        return { ok: false, lyDo: 'saiMatKhau' };
      }
      const thongDiep = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Bind AD thất bại cho "${username}" — không phải do sai mật khẩu: ${thongDiep}`,
      );
      return { ok: false, lyDo: 'khongKetNoiDuoc' };
    } finally {
      try {
        await client.unbind();
      } catch {
        // Bỏ qua — bind có thể chưa từng thành công nên chưa có gì để unbind.
      }
    }
  }
}
