// Adapter Azure Cognitive Services Speech (TTS) — dự phòng (provider chính thức
// đã chuyển sang Google, xem providers/google.ts). Giữ lại để đổi provider chỉ
// cần chạy lại 1 lệnh nếu sau này cần so sánh chất lượng hoặc Google có vấn đề.
// Giọng mặc định vi-VN-HoaiMyNeural (nữ, phát âm chuẩn Hà Nội).
// Cần biến môi trường AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (vd. "southeastasia").
//
// Neural TTS của Azure có bộ chuẩn hoá số/ngày tháng riêng khá tốt — không bắt
// buộc phải bọc SSML <say-as> cho từng số. Wrap SSML tối giản (chỉ để chọn giọng),
// để lại việc tinh chỉnh cách đọc số cho lần lặp sau nếu nghe thử phát hiện sai.
import type { NhaCungCapTts } from './loai';

let tokenDangCache: { gia_tri: string; hetHanLuc: number } | null = null;

function vungAzure(): string {
  const v = process.env.AZURE_SPEECH_REGION;
  if (!v) throw new Error('Thiếu biến môi trường AZURE_SPEECH_REGION (vd. southeastasia)');
  return v;
}

function khoaAzure(): string {
  const v = process.env.AZURE_SPEECH_KEY;
  if (!v) throw new Error('Thiếu biến môi trường AZURE_SPEECH_KEY');
  return v;
}

async function layAccessToken(): Promise<string> {
  const gioNay = Date.now();
  if (tokenDangCache && tokenDangCache.hetHanLuc > gioNay) return tokenDangCache.gia_tri;

  const res = await fetch(`https://${vungAzure()}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': khoaAzure(), 'Content-Length': '0' },
  });
  if (!res.ok) {
    throw new Error(`Azure từ chối cấp token (${res.status}): ${await res.text()}`);
  }
  const gia_tri = await res.text();
  // Token Azure sống 10 phút — cache 9 phút cho an toàn, đỡ xin lại liên tục.
  tokenDangCache = { gia_tri, hetHanLuc: gioNay + 9 * 60 * 1000 };
  return gia_tri;
}

function thoatXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const azure: NhaCungCapTts = {
  id: 'azure',
  giongMacDinh: 'vi-VN-HoaiMyNeural',
  hoTroSsml: true,
  gioiHanKyTu: 3000, // Azure khuyến nghị SSML < ~7500 byte UTF-8 — 3000 ký tự là ngưỡng an toàn
  async sinh(text, duongDanTho, tuyChon) {
    const token = await layAccessToken();
    const ssml =
      `<speak version="1.0" xml:lang="vi-VN">` +
      `<voice name="${tuyChon.voice}">${thoatXml(text)}</voice>` +
      `</speak>`;

    const res = await fetch(`https://${vungAzure()}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': '3800quiz-giong-doc',
      },
      body: ssml,
    });
    if (!res.ok) {
      throw new Error(`Azure TTS lỗi (${res.status}): ${await res.text()}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const { writeFile } = await import('node:fs/promises');
    await writeFile(duongDanTho, buf);
  },
};
