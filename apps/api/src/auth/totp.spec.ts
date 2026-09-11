import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateTotpCode,
  generateTotpSecret,
  hotp,
  verifyTotpCode,
} from './totp';

describe('totp', () => {
  it('hotp: khớp đúng vector mẫu chính thức RFC 4226 Appendix D (secret ASCII "12345678901234567890")', () => {
    const secret = Buffer.from('12345678901234567890', 'ascii');
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 1)).toBe('287082');
    expect(hotp(secret, 9)).toBe('520489');
  });

  it('base32Encode/Decode: mã hoá rồi giải mã lại đúng byte gốc', () => {
    const original = Buffer.from('12345678901234567890', 'ascii');
    const encoded = base32Encode(original);
    expect(base32Decode(encoded)).toEqual(original);
  });

  it('generateTotpSecret: sinh secret base32 hợp lệ, độ dài ổn định', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThan(20);
  });

  it('verifyTotpCode: mã vừa sinh tại đúng thời điểm phải hợp lệ', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });

  it('verifyTotpCode: cho phép lệch 1 bước (30 giây) do đồng hồ không khớp tuyệt đối', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now + 25_000)).toBe(true);
    expect(verifyTotpCode(secret, code, now - 25_000)).toBe(true);
  });

  it('verifyTotpCode: lệch quá 1 bước phải bị từ chối', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now + 90_000)).toBe(false);
  });

  it('verifyTotpCode: mã sai bị từ chối', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '000000', Date.now())).toBe(false);
  });

  it('verifyTotpCode: định dạng không phải 6 chữ số bị từ chối ngay, không ném lỗi', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, 'abcdef', Date.now())).toBe(false);
    expect(verifyTotpCode(secret, '12345', Date.now())).toBe(false);
  });

  it('buildOtpauthUrl: chứa đúng secret và username', () => {
    const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'nhanvien01');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('nhanvien01');
  });
});
