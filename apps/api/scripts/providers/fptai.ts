// Adapter FPT.AI TTS — nhà cung cấp TRONG NƯỚC (dự phòng, dùng khi cần hợp đồng/
// hoá đơn VAT trong nước thay vì Azure). Cần biến môi trường FPTAI_API_KEY.
// Giọng nữ miền Bắc mặc định: "banmai". API bất đồng bộ — trả về URL file, phải
// poll tới khi sẵn sàng rồi mới tải MP3 về.
import type { NhaCungCapTts } from './loai';

function khoaFptAi(): string {
  const v = process.env.FPTAI_API_KEY;
  if (!v) throw new Error('Thiếu biến môi trường FPTAI_API_KEY');
  return v;
}

function cho(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const fptai: NhaCungCapTts = {
  id: 'fptai',
  giongMacDinh: 'banmai',
  hoTroSsml: false,
  gioiHanKyTu: 5000,
  async sinh(text, duongDanTho, tuyChon) {
    const res = await fetch('https://api.fpt.ai/hmi/tts/v5', {
      method: 'POST',
      headers: {
        'api-key': khoaFptAi(),
        voice: tuyChon.voice,
        speed: '0',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: text,
    });
    if (!res.ok) throw new Error(`FPT.AI TTS lỗi (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { async: string; error?: number; message?: string };
    if (data.error) throw new Error(`FPT.AI TTS báo lỗi: ${data.message ?? data.error}`);

    // API bất đồng bộ — file cần vài giây để sẵn sàng, poll tối đa 10 lần.
    let noiDung: Buffer | null = null;
    for (let i = 0; i < 10; i++) {
      await cho(1000);
      const thu = await fetch(data.async);
      if (thu.ok && Number(thu.headers.get('content-length') ?? '0') > 0) {
        noiDung = Buffer.from(await thu.arrayBuffer());
        break;
      }
    }
    if (!noiDung) throw new Error(`FPT.AI TTS: file audio chưa sẵn sàng sau 10 giây (${data.async})`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(duongDanTho, noiDung);
  },
};
