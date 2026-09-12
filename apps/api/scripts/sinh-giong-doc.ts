// Script sinh sẵn file audio giọng đọc thuyết minh (đề bài/đáp án/lĩnh vực) —
// PROD chạy mạng nội bộ không có Internet nên KHÔNG thể gọi TTS lúc chạy thật;
// toàn bộ audio phải sinh sẵn ở máy DEV rồi mang lên server (DEPLOYMENT.md, Phụ lục E).
//
// Dùng:
//   cd apps/api
//   npm run giong-doc -- --provider google --voice vi-VN-Neural2-A
//   npm run giong-doc -- --provider macos --limit 40 --dry-run
//   npm run giong-doc -- --subject "CNTT"
//   npm run giong-doc -- --prune
//
// Xem toàn bộ tham số ở hàm parseArgs() bên dưới.
import { PrismaClient } from '@prisma/client';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { khoaGiongDoc } from '../src/common/giong-doc-key';
import { chuanHoaVanBanDeDoc } from './chuan-hoa-van-ban';
import { macos } from './providers/macos';
import { azure } from './providers/azure';
import { fptai } from './providers/fptai';
import { google } from './providers/google';
import type { NhaCungCapTts } from './providers/loai';

const execFileAsync = promisify(execFile);

const NHA_CUNG_CAP: Record<string, NhaCungCapTts> = { macos, azure, fptai, google };

const THU_MUC_GOC = join(__dirname, '..', '..', '..'); // apps/api/scripts/.. .. .. → gốc repo
const THU_MUC_AUDIO = join(THU_MUC_GOC, 'assets', 'giong-doc');
const FILE_MANIFEST = join(THU_MUC_AUDIO, 'manifest.json');

const CUM_CO_DINH = ['Lĩnh vực', 'Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'];

interface ThamSo {
  provider: string;
  voice: string;
  rate?: number;
  limit?: number;
  subject?: string;
  quiz?: string;
  arenaLimit: number;
  prune: boolean;
  dryRun: boolean;
  force: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): ThamSo {
  const get = (ten: string): string | undefined => {
    const i = argv.indexOf(`--${ten}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (ten: string): boolean => argv.includes(`--${ten}`);

  const provider = get('provider') ?? 'macos';
  const nhaCungCap = NHA_CUNG_CAP[provider];
  if (!nhaCungCap) {
    throw new Error(`--provider không hợp lệ: "${provider}". Chọn 1 trong: ${Object.keys(NHA_CUNG_CAP).join(', ')}`);
  }

  return {
    provider,
    voice: get('voice') ?? nhaCungCap.giongMacDinh,
    rate: get('rate') ? Number(get('rate')) : undefined,
    limit: get('limit') ? Number(get('limit')) : undefined,
    subject: get('subject'),
    quiz: get('quiz'),
    arenaLimit: get('arena-limit') ? Number(get('arena-limit')) : 20,
    prune: has('prune'),
    dryRun: has('dry-run'),
    force: has('force'),
    concurrency: get('concurrency') ? Number(get('concurrency')) : 3,
  };
}

function kiemTraFfmpeg(): void {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
    } catch {
      throw new Error(
        `Không tìm thấy "${bin}" — cài bằng: brew install ffmpeg (macOS) hoặc apt-get install ffmpeg (Linux).`,
      );
    }
  }
}

interface MucManifest {
  preview: string;
  norm: string;
  dur: number;
  bytes: number;
  provider: string;
  voice: string;
}
type Manifest = Record<string, MucManifest>;

function docManifest(): Manifest {
  if (!existsSync(FILE_MANIFEST)) return {};
  return JSON.parse(readFileSync(FILE_MANIFEST, 'utf-8')) as Manifest;
}

function ghiManifest(m: Manifest): void {
  const sapXep: Manifest = {};
  for (const k of Object.keys(m).sort()) sapXep[k] = m[k];
  writeFileSync(FILE_MANIFEST, JSON.stringify(sapXep, null, 2) + '\n', 'utf-8');
}

/** Tách câu dài quá giới hạn provider thành các đoạn nhỏ hơn, gộp theo câu (dấu . ! ?). */
function tachDoanQuaDai(text: string, gioiHan: number): string[] {
  if (text.length <= gioiHan) return [text];
  const cau = text.split(/(?<=[.!?])\s+/);
  const doan: string[] = [];
  let hienTai = '';
  for (const c of cau) {
    if ((hienTai + ' ' + c).trim().length > gioiHan && hienTai) {
      doan.push(hienTai.trim());
      hienTai = c;
    } else {
      hienTai = (hienTai + ' ' + c).trim();
    }
  }
  if (hienTai) doan.push(hienTai);
  return doan;
}

async function docThoiLuong(duongDan: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', duongDan,
  ]);
  return Number(stdout.trim());
}

const BO_LOC_AM_THANH =
  'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,' +
  'areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse,' +
  'loudnorm=I=-16:TP=-1.5:LRA=11';

/** Nén + chuẩn hoá loudness + cắt khoảng lặng đầu/cuối — ghi thẳng ra file .mp3 cuối cùng. */
async function nenVaGhi(cacFileTho: string[], dichMp3: string): Promise<void> {
  const args: string[] = ['-y'];
  for (const f of cacFileTho) args.push('-i', f);
  if (cacFileTho.length === 1) {
    args.push('-af', BO_LOC_AM_THANH);
  } else {
    const dauVao = cacFileTho.map((_, i) => `[${i}:a]`).join('');
    args.push('-filter_complex', `${dauVao}concat=n=${cacFileTho.length}:v=0:a=1[noiL];[noiL]${BO_LOC_AM_THANH}[out]`);
    args.push('-map', '[out]');
  }
  // "-f mp3" bắt buộc: đích ghi ra là "<key>.mp3.tmp" (ghi tạm rồi mới rename), đuôi
  // ".tmp" khiến ffmpeg không tự đoán được muxer từ phần mở rộng.
  args.push('-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '32k', '-write_xing', '1', '-f', 'mp3', dichMp3);
  await execFileAsync('ffmpeg', args);
}

interface MucCanDoc {
  key: string;
  text: string;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  kiemTraFfmpeg();
  mkdirSync(THU_MUC_AUDIO, { recursive: true });

  // Dọn file tạm còn sót lại từ lần chạy trước bị dừng giữa chừng (Ctrl+C, crash…).
  for (const f of readdirSync(THU_MUC_AUDIO)) {
    if (f.startsWith('.tmp-') || f.endsWith('.mp3.tmp')) rmSync(join(THU_MUC_AUDIO, f), { force: true });
  }

  const nhaCungCap = NHA_CUNG_CAP[opts.provider];
  console.log(`Provider: ${nhaCungCap.id} | Giọng: ${opts.voice}${opts.dryRun ? ' | [DRY-RUN]' : ''}`);

  const prisma = new PrismaClient();
  const subjects = await prisma.subject.findMany();
  const questions = await prisma.question.findMany({
    include: { options: true, subject: true, quiz: true },
  });
  const quizVersions = await prisma.quizVersion.findMany({ select: { snapshot: true } });
  await prisma.$disconnect();

  const apDungBoLoc = (q: (typeof questions)[number]): boolean => {
    if (opts.subject && q.subject?.name !== opts.subject && !q.subject?.name?.includes(opts.subject)) return false;
    if (opts.quiz && q.quiz?.title !== opts.quiz && !q.quiz?.title?.includes(opts.quiz)) return false;
    return true;
  };

  // ── Gom toàn bộ văn bản cần đọc, khử trùng lặp theo khoaGiongDoc() ──────────
  const kho = new Map<string, string>(); // key -> text gốc (bản đầu tiên gặp)
  const themVaoKho = (text: string | null | undefined) => {
    const t = (text ?? '').trim();
    if (!t) return;
    const k = khoaGiongDoc(t);
    if (!kho.has(k)) kho.set(k, t);
  };

  for (const c of CUM_CO_DINH) themVaoKho(c);
  for (const s of subjects) themVaoKho(s.name);

  const cauHoiDaLoc = questions.filter(apDungBoLoc);
  for (const q of cauHoiDaLoc) {
    themVaoKho(q.content);
    for (const o of q.options) themVaoKho(o.content);
  }

  // Quét cả snapshot đã đóng băng (QuizVersion.snapshot) — khi thi, câu hỏi đọc
  // từ đây chứ KHÔNG đọc trực tiếp bảng questions (xem attempts.service.ts).
  // Chỉ áp bộ lọc --subject/--quiz ở mức thô (theo quiz.title trong snapshot);
  // không lọc theo subject vì snapshot cũ có thể thiếu subjectName.
  for (const qv of quizVersions) {
    const snap = qv.snapshot as {
      quiz?: { title?: string };
      questions?: { content?: string; options?: { content?: string }[] }[];
    } | null;
    if (!snap?.questions) continue;
    if (opts.quiz && !snap.quiz?.title?.includes(opts.quiz)) continue;
    for (const q of snap.questions) {
      themVaoKho(q.content);
      for (const o of q.options ?? []) themVaoKho(o.content);
    }
  }

  let danhSach: MucCanDoc[] = [...kho.entries()].map(([key, text]) => ({ key, text }));
  if (opts.limit) danhSach = danhSach.slice(0, opts.limit);

  console.log(`Tổng số chuỗi văn bản cần xét: ${danhSach.length} (đã khử trùng lặp)`);

  // ── Sinh audio ───────────────────────────────────────────────────────────
  const manifest = docManifest();
  let daSinh = 0, daBoQua = 0;
  let ghiManifestTuLanCuoi = 0;

  for (const muc of danhSach) {
    const spellOut = !nhaCungCap.hoTroSsml;
    const vanBanDaChuan = chuanHoaVanBanDeDoc(muc.text, { spellOut });
    const mucCu = manifest[muc.key];
    const fileDich = join(THU_MUC_AUDIO, `${muc.key}.mp3`);
    const daCoDuNoiDung =
      !opts.force &&
      mucCu &&
      mucCu.norm === vanBanDaChuan &&
      mucCu.provider === opts.provider &&
      mucCu.voice === opts.voice &&
      existsSync(fileDich);

    if (daCoDuNoiDung) {
      daBoQua++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[dry-run] sẽ sinh: ${muc.key}  "${muc.text.slice(0, 60)}"`);
      daSinh++;
      continue;
    }

    try {
      const doan = tachDoanQuaDai(vanBanDaChuan, nhaCungCap.gioiHanKyTu);
      const fileThoTmp = doan.map((_, i) => join(THU_MUC_AUDIO, `.tmp-${muc.key}-${i}.raw`));
      for (let i = 0; i < doan.length; i++) {
        await nhaCungCap.sinh(doan[i], fileThoTmp[i], { voice: opts.voice, rate: opts.rate });
      }
      const fileTmpDich = fileDich + '.tmp';
      await nenVaGhi(fileThoTmp, fileTmpDich);
      const thoiLuong = await docThoiLuong(fileTmpDich);
      renameSync(fileTmpDich, fileDich);
      for (const f of fileThoTmp) rmSync(f, { force: true });

      manifest[muc.key] = {
        preview: muc.text.slice(0, 60),
        norm: vanBanDaChuan,
        dur: Math.round(thoiLuong * 100) / 100,
        bytes: statSync(fileDich).size,
        provider: opts.provider,
        voice: opts.voice,
      };
      daSinh++;
      if (daSinh % 10 === 0) console.log(`  ... đã sinh ${daSinh}/${danhSach.length - daBoQua}`);
    } catch (err) {
      console.error(`LỖI khi sinh "${muc.key}" ("${muc.text.slice(0, 40)}..."):`, (err as Error).message);
    }

    ghiManifestTuLanCuoi++;
    if (!opts.dryRun && ghiManifestTuLanCuoi >= 25) {
      ghiManifest(manifest);
      ghiManifestTuLanCuoi = 0;
    }
  }

  if (!opts.dryRun) ghiManifest(manifest);

  console.log(`\nHoàn tất: sinh mới ${daSinh}, bỏ qua (đã có) ${daBoQua}, tổng ${danhSach.length}.`);

  // ── Báo cáo câu có ĐỀ BÀI vượt --arena-limit (Đấu trường chỉ đọc đề bài) ───
  const canhBaoArena: { key: string; dur: number; preview: string }[] = [];
  for (const q of cauHoiDaLoc) {
    const k = khoaGiongDoc(q.content.trim());
    const m = manifest[k];
    if (m && m.dur > opts.arenaLimit) canhBaoArena.push({ key: k, dur: m.dur, preview: m.preview });
  }
  if (canhBaoArena.length > 0) {
    canhBaoArena.sort((a, b) => b.dur - a.dur);
    console.log(`\n⚠ ${canhBaoArena.length} câu có ĐỀ BÀI đọc vượt ${opts.arenaLimit}s (Đấu trường chỉ đọc đề):`);
    for (const c of canhBaoArena.slice(0, 20)) {
      console.log(`   [${c.key}] ${c.dur.toFixed(1)}s  "${c.preview}..."`);
    }
    if (canhBaoArena.length > 20) console.log(`   ... và ${canhBaoArena.length - 20} câu khác.`);
    console.log(`→ Gợi ý: đặt questionDurationSec ≥ ${Math.ceil(Math.max(...canhBaoArena.map((c) => c.dur)) + 5)}` +
      ` giây cho các bộ đề chứa câu này, hoặc rút gọn nội dung câu hỏi.`);
  }

  // ── Dọn file mồ côi ────────────────────────────────────────────────────────
  if (existsSync(THU_MUC_AUDIO)) {
    const khoaHopLe = new Set(danhSach.map((m) => m.key));
    const moCoi = readdirSync(THU_MUC_AUDIO)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => f.slice(0, -4))
      .filter((k) => !khoaHopLe.has(k));
    if (moCoi.length > 0) {
      console.log(`\n${opts.prune ? 'Đang xoá' : 'Phát hiện'} ${moCoi.length} file mồ côi (nội dung không còn dùng):`);
      for (const k of moCoi) {
        console.log(`   ${k}.mp3`);
        if (opts.prune) {
          rmSync(join(THU_MUC_AUDIO, `${k}.mp3`), { force: true });
          delete manifest[k];
        }
      }
      if (opts.prune) ghiManifest(manifest);
      else console.log('   (chạy lại kèm --prune để xoá)');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
