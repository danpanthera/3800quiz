// Adapter macOS `say` — CHỈ dùng để chạy thử/kiểm tra đường ống, KHÔNG dùng cho
// bản chính thức (chất lượng ghép âm cũ, đọc số/mã văn bản máy móc). Miễn phí,
// hoàn toàn offline, không cần đăng ký — chạy được ngay trên máy DEV macOS.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NhaCungCapTts } from './loai';

const execFileAsync = promisify(execFile);

export const macos: NhaCungCapTts = {
  id: 'macos',
  giongMacDinh: 'Linh', // vi_VN, giọng nữ duy nhất có sẵn trên macOS — xác nhận bằng `say -v ?`
  hoTroSsml: false,
  gioiHanKyTu: 20000, // `say` không giới hạn thực sự — đặt cao chỉ để tách câu quá dài cho đỡ lag
  async sinh(text, duongDanTho, tuyChon) {
    // `say -o` NHẬN DIỆN định dạng theo ĐUÔI FILE — ".raw" không được nhận diện
    // ("Opening output file failed: fmt?"), phải dùng ".wav" dù nội dung là PCM thô.
    const duongDanWav = duongDanTho.replace(/\.raw$/, '.wav');
    const args = ['-v', tuyChon.voice, '-o', duongDanWav, '--data-format=LEI16@22050'];
    if (tuyChon.rate) args.push('-r', String(tuyChon.rate));
    args.push(text);
    await execFileAsync('say', args);
    if (duongDanWav !== duongDanTho) {
      const { renameSync } = await import('node:fs');
      renameSync(duongDanWav, duongDanTho);
    }
  },
};
