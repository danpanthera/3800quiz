// Chuẩn hoá văn bản TRƯỚC KHI đưa vào máy đọc (TTS) — KHÔNG liên quan gì tới hàm băm
// khoaGiongDoc() (băm luôn dùng văn bản GỐC, xem apps/api/src/common/giong-doc-key.ts).
// Dữ liệu câu hỏi thật chứa những chuỗi mà mọi máy TTS đều đọc thành âm vô nghĩa, ví dụ:
//   "Theo Quy định số 3838/QyĐ-NHNo-TD ngày 15/11/2024 … thì TSBĐ …"
// Module này biến chuỗi trên thành văn bản máy đọc được, theo đúng thứ tự:
//   NFC → mã văn bản (số/QyĐ-...) → ngày tháng → từ điển viết tắt → số/phần trăm → ký hiệu

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type TuDienVietTat = Record<string, string>;

let tuDienDaTai: TuDienVietTat | null = null;

export function taiTuDienVietTat(): TuDienVietTat {
  if (tuDienDaTai) return tuDienDaTai;
  const raw = readFileSync(join(__dirname, 'tu-dien-viet-tat.json'), 'utf-8');
  const parsed = JSON.parse(raw) as TuDienVietTat;
  delete parsed._ghi_chu;
  tuDienDaTai = parsed;
  return parsed;
}

/** Escape 1 chuỗi để dùng an toàn trong RegExp. */
function thoatRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Thay `key` bằng `value` trong `text`, chỉ khi `key` không dính liền chữ/số ở
 * 2 đầu (vd. "NHNo" không khớp giữa "NHNoX"). Dùng \p{L}/\p{N} vì \b của JS
 * không nhận diện đúng biên từ với ký tự có dấu tiếng Việt.
 */
function thayKhongDinhChu(text: string, key: string, value: string): string {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${thoatRegex(key)}(?![\\p{L}\\p{N}])`, 'gu');
  return text.replace(re, value);
}

/** Áp từ điển viết tắt — khớp cụm DÀI trước cụm NGẮN để "NHNo&PTNT" thắng "NHNo". */
export function apDungTuDien(text: string, tuDien: TuDienVietTat): string {
  const cacKhoa = Object.keys(tuDien).sort((a, b) => b.length - a.length);
  let ket = text;
  for (const khoa of cacKhoa) {
    ket = thayKhongDinhChu(ket, khoa, tuDien[khoa]);
  }
  return ket;
}

// "\w" của JS chỉ nhận [A-Za-z0-9_] — KHÔNG nhận ký tự tiếng Việt có dấu (vd. "Đ"
// trong "QyĐ"), làm mã văn bản bị cắt nửa. Dùng \p{L}\p{N} + cờ "u" thay thế.
const KY_TU_CHU_SO = '[\\p{L}\\p{N}]';

/**
 * "15/11/2024" → "15 tháng 11 năm 2024". KHÔNG thêm chữ "ngày" ở đầu — dữ liệu
 * thật hầu như luôn viết sẵn "ngày 15/11/2024" trong câu, thêm nữa sẽ lặp
 * thành "ngày ngày 15...". Chỉ khớp ngày hợp lệ (01-31/01-12).
 */
export function chuyenNgayThang(text: string): string {
  return text.replace(
    /(?<![\d/])([0-3]?\d)\/([01]?\d)\/(\d{4})(?!\d)/g,
    (m, d: string, mo: string, y: string) => {
      const dd = Number(d);
      const mm = Number(mo);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return m;
      return `${dd} tháng ${mm} năm ${y}`;
    },
  );
}

/**
 * Số văn bản đọc TỪNG CHỮ SỐ riêng lẻ, KHÔNG đọc theo giá trị số học — quy ước
 * đọc số hồ sơ/công văn thực tế. VD: "2929" → "hai chín hai chín", KHÔNG phải
 * "hai nghìn chín trăm hai mươi chín".
 */
function docTungChuSo(so: string): string {
  return so
    .split('')
    .map((c) => TEN_SO_HANG[Number(c)])
    .join(' ');
}

/**
 * Tên chữ cái tiếng Việt dùng để ĐÁNH VẦN các cụm viết tắt xuất hiện TRONG số/
 * ký hiệu văn bản (vd. "2234/QTr-NHNo-KHDN") — KHÁC với đọc nguyên nghĩa ở
 * tu-dien-viet-tat.json (dùng cho văn bản/câu nói thông thường, vd. "tăng
 * trưởng KHDN" → "tăng trưởng khách hàng doanh nghiệp"). Chữ nào CHƯA có tên ở
 * đây thì giữ nguyên ký tự gốc (an toàn hơn đoán sai, chờ bổ sung khi gặp).
 */
const TEN_CHU_CAI: Record<string, string> = {
  b: 'bê', c: 'xê', d: 'đê', đ: 'đê', g: 'gờ', h: 'hắt', i: 'i', k: 'ca',
  l: 'lờ', m: 'mờ', n: 'nờ', o: 'o', p: 'pê', q: 'quy', r: 'rờ', s: 'ét',
  t: 'tê', u: 'u', v: 'vê', x: 'ích', y: 'i',
};

/** Đánh vần TỪNG CHỮ CÁI của 1 cụm viết tắt — vd. "NHNo" → "nờ hắt nờ o". */
function docTungChuCai(tu: string): string {
  return tu
    .split('')
    .map((c) => TEN_CHU_CAI[c.toLowerCase()] ?? c)
    .join(' ');
}

/**
 * Mã văn bản kiểu "3838/QyĐ-NHNo-TD" → "ba tám ba tám, quy i đê, nờ hắt nờ o,
 * tê đê" — phần số đọc từng chữ số (docTungChuSo), MỌI cụm chữ sau đó (kể cả
 * cụm đầu tiên như QyĐ/QĐ/QC/QTr) đều đánh vần từng chữ cái (docTungChuCai),
 * KHÔNG tra từ điển nghĩa apDungTuDien() — cụm chữ trong mã văn bản luôn đọc
 * kiểu đánh vần, bất kể có/không nằm trong từ điển viết tắt. Đọc nguyên nghĩa
 * (QyĐ→"Quy định", KHDN→"khách hàng doanh nghiệp"...) CHỈ áp dụng khi cụm đó
 * đứng trong câu văn thông thường, không nằm trong mã dạng "số/chữ-chữ-...".
 * Chạy TRƯỚC chuyển ngày tháng để "3838/QyĐ..." không bị nhận nhầm là ngày.
 */
export function chuyenMaVanBan(text: string): string {
  // Mã 3 khúc kiểu "11/2026/TT-NHNN" (số hiệu/năm/loại văn bản-cơ quan) — số
  // hiệu đọc THEO GIÁ TRỊ ("mười một", dùng soSangChu như đọc số thường), năm
  // đọc TỪNG CHỮ SỐ ("hai không hai sáu", docTungChuSo), phần chữ vẫn đánh vần
  // như mã 2 khúc. Chạy TRƯỚC mẫu 2 khúc để không bị "nuốt" mất khúc năm.
  const re3 = new RegExp(
    `(?<!${KY_TU_CHU_SO})(\\d{2,5})/(\\d{4})/([\\p{L}][\\p{L}\\p{N}]*(?:-[\\p{L}\\p{N}]+)*)(?!${KY_TU_CHU_SO})`,
    'gu',
  );
  let ket = text.replace(re3, (_m, soHieu: string, nam: string, phan: string) => {
    const cacCum = phan.split('-').map(docTungChuCai);
    return `${soSangChu(Number(soHieu))}, ${docTungChuSo(nam)}, ${cacCum.join(', ')}`;
  });

  const re2 = new RegExp(
    `(?<!${KY_TU_CHU_SO})(\\d{2,5})/([\\p{L}][\\p{L}\\p{N}]*(?:-[\\p{L}\\p{N}]+)*)(?!${KY_TU_CHU_SO})`,
    'gu',
  );
  ket = ket.replace(re2, (_m, so: string, phan: string) => {
    const cacCum = phan.split('-').map(docTungChuCai);
    return `${docTungChuSo(so)}, ${cacCum.join(', ')}`;
  });

  return ket;
}

const TEN_SO_DON_VI = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];
const TEN_SO_HANG = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc 1 nhóm 3 số (000-999) ra chữ, `coTram` = có cần đọc "không trăm" khi là nhóm giữa. */
function docNhomBaSo(n: number, coTram: boolean): string {
  const tram = Math.floor(n / 100);
  const chuc = Math.floor((n % 100) / 10);
  const donvi = n % 10;
  const phan: string[] = [];
  if (tram > 0 || coTram) phan.push(`${TEN_SO_HANG[tram]} trăm`);
  if (chuc === 0) {
    if (donvi > 0 && (tram > 0 || coTram)) phan.push('không');
  } else if (chuc === 1) {
    phan.push('mười');
  } else {
    phan.push(`${TEN_SO_HANG[chuc]} mươi`);
  }
  if (donvi > 0) {
    if (chuc === 0) phan.push(TEN_SO_HANG[donvi]);
    else if (donvi === 1 && chuc >= 2) phan.push('mốt');
    else if (donvi === 5 && chuc >= 1) phan.push('lăm');
    else phan.push(TEN_SO_HANG[donvi]);
  }
  return phan.join(' ');
}

/** Đọc số nguyên không dấu ra chữ tiếng Việt — dùng cho provider không hỗ trợ SSML (macos). */
export function soSangChu(n: number): string {
  if (n === 0) return 'không';
  const am = n < 0;
  let x = Math.abs(Math.trunc(n));
  const nhom: number[] = [];
  while (x > 0) {
    nhom.unshift(x % 1000);
    x = Math.floor(x / 1000);
  }
  const phan: string[] = [];
  for (let i = 0; i < nhom.length; i++) {
    const giaTri = nhom[i];
    if (giaTri === 0 && nhom.length > 1) continue;
    const donVi = TEN_SO_DON_VI[nhom.length - 1 - i] ?? '';
    const chu = docNhomBaSo(giaTri, i > 0);
    phan.push(donVi ? `${chu} ${donVi}` : chu);
  }
  return (am ? 'âm ' : '') + phan.join(' ');
}

/**
 * Số/phần trăm/thập phân:
 *  - "70%" → "70 phần trăm"
 *  - "1.000.000" (dấu chấm phân nhóm nghìn, ≥2 nhóm 3 số) → nếu spellOut thì đọc ra
 *    chữ bằng soSangChu(), ngược lại chỉ gỡ dấu chấm để engine TTS tự đọc đúng.
 *  - "0,5" (dấu phẩy thập phân) → "0 phẩy 5" (đọc từng chữ số sau phẩy).
 * `spellOut=true` dành cho provider không hỗ trợ SSML (macos); Azure/Google hỗ trợ
 * SSML <say-as> nên để nguyên số, chỉ cần convertNumbers xử lý % và dấu phân nhóm.
 */
export function chuyenSo(text: string, spellOut: boolean): string {
  let ket = text.replace(/(\d+(?:[.,]\d+)?)\s*%/g, '$1 phần trăm');

  // Số phân nhóm nghìn kiểu 1.000.000 (≥2 nhóm 3 số sau dấu chấm)
  ket = ket.replace(/\b\d{1,3}(?:\.\d{3}){1,}\b/g, (m) => {
    const soThuc = Number(m.replace(/\./g, ''));
    return spellOut ? soSangChu(soThuc) : String(soThuc);
  });

  // Thập phân dấu phẩy kiểu 0,5 — CHỈ khi là cặp số ĐƠN LẺ, không phải danh
  // sách liệt kê kiểu "1,2,3" (đáp án nhiều lựa chọn/thứ tự). Phân biệt bằng
  // cách đòi hỏi không có ",số" ngay trước và không có ",số" ngay sau — một
  // số thập phân thật chỉ có ĐÚNG 1 dấu phẩy, còn danh sách có từ 2 dấu trở lên.
  ket = ket.replace(/(?<!\d,)\b(\d+),(\d{1,2})\b(?!,\d)/g, (_m, nguyen: string, le: string) => {
    if (!spellOut) return `${nguyen}.${le}`;
    const chuNguyen = soSangChu(Number(nguyen));
    const chuLe = le
      .split('')
      .map((c) => TEN_SO_HANG[Number(c)])
      .join(' ');
    return `${chuNguyen} phẩy ${chuLe}`;
  });

  // Số nguyên trần trụi còn lại, chỉ đọc ra chữ khi spellOut (macos) — Azure/Google
  // để nguyên, dùng SSML <say-as interpret-as="cardinal"> ở phía provider. KHÔNG
  // loại trừ dấu phẩy ở đây (chỉ loại trừ dấu chấm — an toàn cho số phân nhóm nghìn
  // sót lại): tới bước này, số thập phân THẬT đã được thay bằng chữ ở bước trên rồi,
  // nên phần còn dính dấu phẩy chỉ là danh sách kiểu "1,2,3" — đọc từng số tách rời
  // qua dấu phẩy nghe tự nhiên hơn là để lẫn lộn chữ với số ("một,2,3").
  if (spellOut) {
    ket = ket.replace(/(?<![\p{L}\p{N}.])\d{1,15}(?![\p{L}\p{N}])/gu, (m) => soSangChu(Number(m)));
  }

  return ket;
}

/** Ký hiệu tạo nhịp nghỉ — không đổi ý nghĩa, chỉ giúp máy đọc ngắt câu tự nhiên hơn. */
export function chuyenKyHieu(text: string): string {
  return text
    .replace(/[–—]/g, ',')
    .replace(/…/g, '...')
    .replace(/≥/g, ' lớn hơn hoặc bằng ')
    .replace(/≤/g, ' nhỏ hơn hoặc bằng ')
    .replace(/[""]/g, '"')
    .replace(/\s+([,.;:])/g, '$1') // bỏ khoảng trắng thừa trước dấu câu (do thay – → ",")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface TuyChonChuanHoa {
  /** true = đọc số ra chữ bằng soSangChu() (provider không hỗ trợ SSML, vd. macos). */
  spellOut: boolean;
}

/** Áp toàn bộ pipeline chuẩn hoá theo đúng thứ tự — dùng trước khi gửi cho TTS. */
export function chuanHoaVanBanDeDoc(text: string, opts: TuyChonChuanHoa): string {
  const tuDien = taiTuDienVietTat();
  let ket = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  ket = chuyenMaVanBan(ket);
  ket = chuyenNgayThang(ket);
  ket = apDungTuDien(ket, tuDien);
  ket = chuyenSo(ket, opts.spellOut);
  ket = chuyenKyHieu(ket);
  return ket;
}
