// Kiểu chung cho mọi adapter nhà cung cấp TTS — xem 4 file cùng thư mục.
export interface TuyChonSinhAmThanh {
  voice: string;
  /** Tốc độ đọc — chỉ macos dùng (say -r); các provider khác bỏ qua. */
  rate?: number;
}

export interface NhaCungCapTts {
  id: string;
  /** Giọng nữ miền Bắc mặc định của nhà cung cấp này. */
  giongMacDinh: string;
  /** true = TTS provider tự đọc số/ngày tháng tốt qua SSML — KHÔNG cần soSangChu(). */
  hoTroSsml: boolean;
  /** Giới hạn ký tự an toàn cho 1 lần gọi — vượt thì script tách câu trước khi gửi. */
  gioiHanKyTu: number;
  /**
   * Sinh audio thô (WAV/AIFF/MP3 tuỳ provider) cho `text`, ghi ra `duongDanTho`.
   * KHÔNG nén ở đây — sinh-giong-doc.ts sẽ chạy ffmpeg nén/chuẩn hoá loudness sau.
   */
  sinh(text: string, duongDanTho: string, tuyChon: TuyChonSinhAmThanh): Promise<void>;
}
