import {
  khoaGiongDoc,
  khoaGiongDocCauHoi,
  giongCuaCauHoi,
} from './giong-doc-key';

// Bộ vector đóng băng — PHẢI khớp tuyệt đối với bộ ở
// apps/web/src/lib/giong-doc-key.spec.ts. Đây là "khoá liên kết" giữa server
// (script sinh audio) và client (dựng URL lúc phát) — bên nào đổi thuật toán
// một mình sẽ làm bộ test của chính bên đó đỏ ngay tại đây, TRƯỚC khi kịp lên
// production và làm audio câm hàng loạt.
describe('khoaGiongDoc', () => {
  it('băm đúng các giá trị đã đóng băng', () => {
    expect(khoaGiongDoc('')).toBe('cbf29ce484222325');
    expect(khoaGiongDoc('a')).toBe('af63dc4c8601ec8c');
    expect(khoaGiongDoc('Xin chào')).toBe('bd0a981101045201');
    expect(
      khoaGiongDoc('Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam'),
    ).toBe('ca2756242052d8de');
    expect(
      khoaGiongDoc('Theo Quy định số 3838/QyĐ-NHNo-TD ngày 15/11/2024'),
    ).toBe('6e9db7c8f99ddcf7');
    expect(
      khoaGiongDoc(
        'Câu hỏi có ký tự đặc biệt: 70% – "giá trị" … (ghi chú) ≥ 100%',
      ),
    ).toBe('5f0c944b38036090');
    expect(khoaGiongDoc('A. Đáp án A')).toBe('815b475f42416f83');
    expect(khoaGiongDoc('B. Đáp án B')).toBe('2ef297d4ec319279');
    expect(khoaGiongDoc('Lĩnh vực')).toBe('52c078786c96f730');
    expect(khoaGiongDoc('0,5% và 1.000.000 đồng')).toBe('aa2d822ce9338a22');
  });

  it('luôn ra đúng 16 ký tự hex', () => {
    for (const s of ['', 'a', 'câu hỏi bất kỳ', 'x'.repeat(500)]) {
      expect(khoaGiongDoc(s)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('NFC và NFD của cùng một chuỗi tiếng Việt phải ra CÙNG một khoá', () => {
    const nfc = 'Xin chào'.normalize('NFC');
    const nfd = 'Xin chào'.normalize('NFD');
    expect(khoaGiongDoc(nfc)).toBe(khoaGiongDoc(nfd));
  });

  it('khoảng trắng thừa/đầu-cuối không đổi khoá', () => {
    expect(khoaGiongDoc('Xin chào')).toBe(khoaGiongDoc('  Xin   chào   '));
  });

  it('nội dung khác nhau phải ra khoá khác nhau (không đụng nhau ở vài mẫu gần giống)', () => {
    const a = khoaGiongDoc('Đáp án A');
    const b = khoaGiongDoc('Đáp án B');
    const c = khoaGiongDoc('đáp án a'); // khác hoa/thường — KHÔNG coi là giống nhau
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

// Bộ vector đóng băng cho phần "giọng theo câu hỏi" (đề bài + đáp án) — PHẢI
// khớp tuyệt đối với bộ ở apps/web/src/lib/giong-doc-key.spec.ts, cùng lý do
// nêu trên.
describe('khoaGiongDocCauHoi', () => {
  it('băm đúng các giá trị đã đóng băng', () => {
    expect(khoaGiongDocCauHoi('Xin chào', 'vi-VN-Neural2-A')).toBe(
      '5e38cffdc67490c5',
    );
    expect(khoaGiongDocCauHoi('Xin chào', 'vi-VN-Neural2-D')).toBe(
      '5e38cafdc6748846',
    );
    expect(khoaGiongDocCauHoi('Đáp án A', 'vi-VN-Neural2-A')).toBe(
      '2e00f5765ec43266',
    );
  });

  it('cùng text nhưng khác giọng phải ra khoá khác nhau', () => {
    const a = khoaGiongDocCauHoi('Xin chào', 'vi-VN-Neural2-A');
    const d = khoaGiongDocCauHoi('Xin chào', 'vi-VN-Neural2-D');
    expect(a).not.toBe(d);
  });
});

describe('giongCuaCauHoi', () => {
  it('quyết định đúng các giá trị đã đóng băng', () => {
    expect(giongCuaCauHoi('Xin chào')).toBe('vi-VN-Neural2-A');
    expect(
      giongCuaCauHoi('Theo Quy định số 3838/QyĐ-NHNo-TD ngày 15/11/2024'),
    ).toBe('vi-VN-Neural2-A');
  });

  it('cùng 1 nội dung luôn ra cùng 1 giọng (ổn định qua nhiều lần gọi)', () => {
    const noiDung = 'Câu hỏi bất kỳ để kiểm tra tính ổn định';
    expect(giongCuaCauHoi(noiDung)).toBe(giongCuaCauHoi(noiDung));
  });
});
