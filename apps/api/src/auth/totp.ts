import { createHmac, randomBytes } from 'crypto';

// TOTP (RFC 6238) tự cài đặt bằng crypto có sẵn của Node — không thêm thư viện
// mới (otplib/speakeasy) để giữ footprint dependency tối thiểu.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// HOTP (RFC 4226) — dynamic truncation chuẩn, dùng chung cho TOTP bên dưới.
// Xuất riêng để unit test đối chiếu trực tiếp với vector mẫu chính thức của RFC.
export function hotp(secretBytes: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit — khuyến nghị RFC 4226
}

export function generateTotpCode(
  secretBase32: string,
  at: number = Date.now(),
): string {
  const counter = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

// Cho phép lệch ±1 bước (30 giây) để bù đồng hồ điện thoại/máy chủ không khớp tuyệt đối.
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  at: number = Date.now(),
): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  const secretBytes = base32Decode(secretBase32);
  return [0, -1, 1].some(
    (drift) => hotp(secretBytes, counter + drift) === normalized,
  );
}

export function buildOtpauthUrl(
  secretBase32: string,
  username: string,
  issuer = '3800Quiz',
): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
