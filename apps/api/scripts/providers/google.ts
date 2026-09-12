// Adapter Google Cloud Text-to-Speech — provider CHÍNH THỨC (chọn giữa 3 lựa chọn
// ElevenLabs/Google/FPT.AI-Viettel: Google cân bằng tốt nhất giữa chi phí, chất
// lượng giọng, và ĐỘ CHÍNH XÁC đọc số/ngày tháng/mã văn bản — ưu tiên hàng đầu cho
// nội dung thi nghiệp vụ ngân hàng, hơn là giọng biểu cảm kiểu ElevenLabs).
// Cần biến môi trường GOOGLE_TTS_API_KEY (API key, không cần service account để
// đơn giản hoá). Giọng nữ mặc định: vi-VN-Neural2-A (dự phòng vi-VN-Wavenet-A/
// vi-VN-Standard-A nếu Neural2 chưa khả dụng ở khu vực).
import type { NhaCungCapTts } from './loai';

function khoaGoogle(): string {
  const v = process.env.GOOGLE_TTS_API_KEY;
  if (!v) throw new Error('Thiếu biến môi trường GOOGLE_TTS_API_KEY');
  return v;
}

export const google: NhaCungCapTts = {
  id: 'google',
  giongMacDinh: 'vi-VN-Neural2-A',
  hoTroSsml: true,
  gioiHanKyTu: 4900, // Google giới hạn cứng 5000 ký tự/request
  async sinh(text, duongDanTho, tuyChon) {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${khoaGoogle()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'vi-VN', name: tuyChon.voice },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      },
    );
    if (!res.ok) throw new Error(`Google TTS lỗi (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { audioContent: string };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(duongDanTho, Buffer.from(data.audioContent, 'base64'));
  },
};
