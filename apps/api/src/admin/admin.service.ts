import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  AttemptViolationType,
  AuthSource,
  Prisma,
  QuestionType,
  XpSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { ImportBankQuestionRowDto } from './dto/import-bank-questions.dto';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcrypt';
import {
  sinhMatKhauNgauNhienChoTaiKhoanAD,
  sinhMatKhauNgauNhienDeDoc,
} from '../common/mat-khau-ad.util';

type NSpellChecker = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nspellLib = require('nspell') as (dict: {
  aff: Buffer;
  dic: Buffer;
}) => NSpellChecker;

// Bộ kiểm tra chính tả khởi tạo trễ (lazy)
let _spellChecker: NSpellChecker | null = null;
async function getSpellChecker(): Promise<NSpellChecker> {
  if (!_spellChecker) {
    const dict = await import('dictionary-vi');
    _spellChecker = nspellLib(dict.default);
  }
  return _spellChecker;
}

// nspell.suggest() rất chậm (~40ms/từ): import 240 câu từng mất hơn 20 giây chỉ
// ở bước kiểm tra chính tả. Nhớ kết quả theo từng từ trong suốt vòng đời tiến
// trình — cùng một từ lạ (tên riêng, viết tắt nghiệp vụ như CNTT, IPCAS...) lặp
// lại ở hàng trăm dòng thì chỉ tính đúng 1 lần. null = từ đúng chính tả.
const SPELL_CACHE_MAX = 50_000;
const spellCache = new Map<string, string[] | null>();
function lookupSpelling(checker: NSpellChecker, word: string): string[] | null {
  const cached = spellCache.get(word);
  if (cached !== undefined) return cached;
  const result = checker.correct(word)
    ? null
    : checker.suggest(word).slice(0, 3);
  if (spellCache.size >= SPELL_CACHE_MAX) spellCache.clear();
  spellCache.set(word, result);
  return result;
}

// ── Các hàm hỗ trợ phát hiện trùng lặp ────────────────────────────────
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /[^\w\sàáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỷỹỵ]/gu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
  ) {}

  // Danh sách field cán bộ được phép ghi từ client — chặn các field hệ thống
  // (id, createdAt, updatedAt) và các quan hệ (department, assignments) lọt vào Prisma
  private static readonly CAN_BO_WRITABLE_FIELDS = [
    'cbCode',
    'fullName',
    'email',
    'phoneNumber',
    'userAD',
    'dangNhapBangAD',
    'userIPCAS',
    'maCbtd',
    'cccd',
    'ngayCapCmt',
    'noiCapCmt',
    'ngaySinh',
    'gioiTinh',
    'departmentId',
    'position',
    'isPartyMember',
    'isUnionMember',
    'isYouthUnionMember',
    'isItStaff',
    'isActive',
  ] as const;

  // Lọc payload cán bộ, chỉ giữ lại các field hợp lệ có mặt trong request
  private pickCanBoFields<T extends Record<string, any>>(data: T): Partial<T> {
    const picked: Partial<T> = {};
    for (const key of AdminService.CAN_BO_WRITABLE_FIELDS) {
      const field = key as keyof T;
      if (data?.[field] !== undefined) picked[field] = data[field];
    }
    return picked;
  }

  // Ánh xạ mã chi nhánh trong file GAHR26 (BRCD) → mã chi nhánh chuẩn trong hệ thống.
  private static readonly BRCD_TO_UNIT_CODE: Record<string, string> = {
    '3800': '01-HS',
    '3802': '02-LT',
    '3803': '03-QN',
    '3807': '04-QT',
    '3808': '05-LTK',
    '3809': '06-THD',
    '3810': '07-LTT',
  };

  // Phòng giao dịch đặt theo tên địa danh (không đánh số) — dùng để nhận diện
  // trong file GAHR26 khi tên cột DEPTNM không chứa số thứ tự.
  private static readonly NAMED_PGD: {
    keyword: string;
    suffix: string;
    name: string;
  }[] = [
    {
      keyword: 'kiến giang',
      suffix: 'PGDKG',
      name: 'Phòng Giao dịch Kiến Giang',
    },
    { keyword: 'chợ tràm', suffix: 'PGDCT', name: 'Phòng Giao dịch Chợ Tràm' },
    { keyword: 'mỹ đức', suffix: 'PGDMD', name: 'Phòng Giao dịch Mỹ Đức' },
    { keyword: 'nam long', suffix: 'PGDNL', name: 'Phòng Giao dịch Nam Long' },
    {
      keyword: 'dinh mười',
      suffix: 'PGDDM',
      name: 'Phòng Giao dịch Dinh Mười',
    },
    { keyword: 'chợ ga', suffix: 'PGDCG', name: 'Phòng Giao dịch Chợ Ga' },
  ];

  // Nhận diện loại phòng ban từ tên trong file GAHR26 (DEPTNM) → hậu tố mã + tên
  // chuẩn, để mọi biến thể chính tả ("Phòng giao dịch số 5" / "PGD Số 5") cùng
  // rơi vào một phòng ban duy nhất thay vì tạo bản trùng mỗi lần import.
  private classifyDepartment(
    deptName: string,
  ): { suffix: string; name: string } | null {
    const n = deptName.toLowerCase();
    const pgdSo = n.match(/(?:pgd|phòng giao dịch)\s*(?:số)?\s*(\d+)/);
    if (pgdSo)
      return {
        suffix: `PGD${pgdSo[1]}`,
        name: `Phòng Giao dịch số ${pgdSo[1]}`,
      };
    // PGD đặt theo tên địa danh (không đánh số) — khớp theo danh sách phòng giao dịch hiện có
    if (n.includes('pgd') || n.includes('phòng giao dịch')) {
      const namedPgd = AdminService.NAMED_PGD.find(({ keyword }) =>
        n.includes(keyword),
      );
      if (namedPgd) return { suffix: namedPgd.suffix, name: namedPgd.name };
    }
    if (n.includes('giám đốc')) return { suffix: 'BGD', name: 'Ban Giám đốc' };
    if (n.includes('doanh nghiệp') || n.includes('khdn'))
      return { suffix: 'KHDN', name: 'Phòng Khách hàng Doanh nghiệp' };
    if (n.includes('cá nhân') || n.includes('khcn'))
      return { suffix: 'KHCN', name: 'Phòng Khách hàng Cá nhân' };
    if (n.includes('rủi ro') || n.includes('khrr') || n.includes('qlrr'))
      return { suffix: 'KHRR', name: 'Phòng Kế hoạch và Quản lý rủi ro' };
    if (
      n.includes('kiểm tra') ||
      n.includes('giám sát') ||
      n.includes('ktgsnb')
    )
      return { suffix: 'KTGSNB', name: 'Phòng Kiểm tra, Giám sát nội bộ' };
    if (n.includes('kế toán') || n.includes('ngân quỹ') || n.includes('ktnq'))
      return { suffix: 'KTNQ', name: 'Phòng Kế toán và Ngân quỹ' };
    if (n.includes('công nghệ') || n.includes('tin học'))
      return { suffix: 'IT', name: 'Phòng Công nghệ Thông tin' };
    if (n.includes('tổng hợp')) return { suffix: 'TH', name: 'Phòng Tổng hợp' };
    if (n.includes('khách hàng'))
      return { suffix: 'KH', name: 'Phòng Khách hàng' };
    return null;
  }

  private normalizeUserAD(userAD?: string | null): string | null {
    const normalized = userAD?.trim();
    return normalized || null;
  }

  private getLoginUsername(cbCode: string, userAD?: string | null): string {
    return this.normalizeUserAD(userAD) ?? cbCode;
  }

  private async ensureUserADIsAvailable(
    userAD: string | null,
    canBoId?: string,
  ) {
    if (!userAD) return;
    const existing = await this.prisma.canBo.findFirst({
      where: {
        userAD: { equals: userAD, mode: 'insensitive' },
        ...(canBoId ? { id: { not: canBoId } } : {}),
      },
      select: { cbCode: true },
    });
    if (existing)
      throw new ConflictException(
        `User AD "${userAD}" đã thuộc về cán bộ ${existing.cbCode}`,
      );
  }

  /**
   * Đếm hoạt động thật của một tài khoản (bài nộp, lượt làm bài, phân công,
   * nhật ký). Tài khoản 0 hoạt động được coi là "trống" — gộp/xoá không mất
   * dữ liệu. Các quan hệ còn lại (lớp học, tiến độ, đội Arena) đã cấu hình
   * cascade/set-null trong schema nên không cần đếm.
   */
  private async demHoatDongUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    const [submissions, attempts, assignments, auditLogs] = await Promise.all([
      tx.submission.count({ where: { userId } }),
      tx.quizAttempt.count({ where: { userId } }),
      tx.assignment.count({ where: { userId } }),
      tx.auditLog.count({ where: { userId } }),
    ]);
    return submissions + attempts + assignments + auditLogs;
  }

  private async syncCanBoUser(
    tx: Prisma.TransactionClient,
    canBo: {
      cbCode: string;
      fullName: string;
      email: string | null;
      departmentId: string | null;
      isActive: boolean;
      userAD: string | null;
      dangNhapBangAD: boolean;
    },
    previousCbCode?: string,
    previousUserAD?: string | null,
  ) {
    const username = this.getLoginUsername(canBo.cbCode, canBo.userAD);
    const previousUsername = this.getLoginUsername(
      previousCbCode ?? canBo.cbCode,
      previousUserAD,
    );
    const userWithUsername = await tx.user.findUnique({ where: { username } });
    const previousUser =
      previousUsername === username
        ? userWithUsername
        : await tx.user.findUnique({ where: { username: previousUsername } });

    // Cán bộ có thể đang gắn với 2 tài khoản: tài khoản cũ (theo mã CB) và tài
    // khoản mang đúng User AD vừa gán. Gộp lại nếu một bên chưa phát sinh hoạt
    // động; chỉ từ chối khi cả hai đều đã có dữ liệu (phải do người quyết định).
    let user = userWithUsername ?? previousUser;
    if (
      userWithUsername &&
      previousUser &&
      userWithUsername.id !== previousUser.id
    ) {
      const [hoatDongMoi, hoatDongCu] = await Promise.all([
        this.demHoatDongUser(tx, userWithUsername.id),
        this.demHoatDongUser(tx, previousUser.id),
      ]);

      if (hoatDongCu > 0 && hoatDongMoi > 0) {
        throw new ConflictException(
          `Không thể gán User AD "${username}": tài khoản này và tài khoản cũ "${previousUsername}" đều đã có dữ liệu làm bài. Vui lòng xử lý thủ công trước khi gán.`,
        );
      }

      if (hoatDongCu > 0) {
        // Giữ tài khoản cũ (đang có dữ liệu), thu hồi tên đăng nhập từ tài khoản trống
        await tx.user.delete({ where: { id: userWithUsername.id } });
        user = previousUser;
      } else {
        // Tài khoản cũ trống — bỏ nó, dùng tài khoản mang đúng User AD
        await tx.user.delete({ where: { id: previousUser.id } });
        user = userWithUsername;
      }
    }

    if (!user) {
      // Bật "Đăng nhập bằng AD" thì không dùng mật khẩu mặc định nữa — đăng
      // nhập ngay bằng đúng mật khẩu AD. passwordHash vẫn phải có giá trị
      // (cột NOT NULL) nhưng là chuỗi ngẫu nhiên không ai biết, không bao giờ
      // được so khớp (xem authSource AD ở auth.service.ts).
      const dungAD = canBo.dangNhapBangAD;
      await tx.user.create({
        data: {
          username,
          fullName: canBo.fullName,
          email: canBo.email ?? undefined,
          passwordHash: await bcrypt.hash(
            dungAD ? sinhMatKhauNgauNhienChoTaiKhoanAD() : 'Abcd@1234',
            10,
          ),
          role: 'STAFF',
          isActive: canBo.isActive,
          authSource: dungAD ? 'AD' : 'LOCAL',
          mustChangePassword: !dungAD,
          departmentId: canBo.departmentId ?? undefined,
        },
      });
      return;
    }

    const authSourceMoi: AuthSource = canBo.dangNhapBangAD ? 'AD' : 'LOCAL';
    // Chuyển từ AD về nội bộ: passwordHash cũ (nếu có) là chuỗi ngẫu nhiên
    // không ai biết (tài khoản trước giờ chỉ đăng nhập qua AD) — cấp lại về
    // đúng mật khẩu mặc định như khi tạo tài khoản mới, bắt đổi ở lần đăng
    // nhập kế tiếp (giống hệt luồng resetCanBoPasswords).
    const chuyenVeNoiBo =
      user.authSource === 'AD' && authSourceMoi === 'LOCAL';

    await tx.user.update({
      where: { id: user.id },
      data: {
        username,
        fullName: canBo.fullName,
        email: canBo.email ?? undefined,
        isActive: canBo.isActive,
        departmentId: canBo.departmentId ?? undefined,
        authSource: authSourceMoi,
        // Tài khoản AD KHÔNG BAO GIỜ được bắt đổi mật khẩu nội bộ — màn hình
        // đó đòi nhập đúng "mật khẩu cũ" khớp passwordHash, mà với tài khoản
        // AD giá trị đó là chuỗi ngẫu nhiên không ai biết → kẹt cứng, không
        // ai vào được nữa. Phải tắt cờ này ngay khi bật AD, không chỉ lúc tạo
        // mới (nhánh !user ở trên).
        ...(authSourceMoi === 'AD'
          ? { mustChangePassword: false }
          : chuyenVeNoiBo
            ? {
                passwordHash: await bcrypt.hash('Abcd@1234', 10),
                mustChangePassword: true,
              }
            : {}),
      },
    });
  }

  // ── Lĩnh vực ──────────────────────────────────────────────────────────
  getSubjects() {
    // Chỉ đếm câu hỏi thuộc ngân hàng (isBank=true) — không tính các bản sao
    // đã được "Lấy câu ngẫu nhiên" copy vào từng bộ đề (isBank=false), nếu
    // không con số sẽ phình to sai lệch mỗi lần ai đó dùng tính năng đó.
    return this.prisma.subject.findMany({
      include: {
        _count: { select: { questions: { where: { isBank: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createSubject(data: { name: string; description?: string }) {
    const existing = await this.prisma.subject.findUnique({
      where: { name: data.name },
    });
    if (existing)
      throw new ConflictException(`Lĩnh vực "${data.name}" đã tồn tại`);
    return this.prisma.subject.create({ data });
  }

  updateSubject(id: string, data: { name?: string; description?: string }) {
    return this.prisma.subject.update({ where: { id }, data });
  }

  deleteSubject(id: string) {
    return this.prisma.subject.delete({ where: { id } });
  }

  // ── Ngân hàng câu hỏi ─────────────────────────────────────────────────
  getBankQuestions(subjectId?: string) {
    return this.prisma.question.findMany({
      where: { isBank: true, ...(subjectId ? { subjectId } : {}) },
      include: {
        options: { orderBy: { orderIndex: 'asc' } },
        subject: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  createBankQuestion(
    data: {
      content: string;
      imageUrl?: string;
      explanation?: string;
      subjectId?: string;
      points?: number;
      questionType?: string;
      options: { content: string; isCorrect: boolean; orderIndex: number }[];
    },
    submittedBy?: { id: string; role: string },
  ) {
    const { options, questionType, ...rest } = data;
    // Việc 9 — quy trình duyệt câu hỏi mới: TRAINER tự tạo phải chờ ADMIN duyệt,
    // ADMIN tự tạo thì coi như đã duyệt luôn (khỏi tự duyệt bài của chính mình).
    const needsApproval = submittedBy?.role === 'TRAINER';
    return this.prisma.question.create({
      data: {
        ...rest,
        isBank: true,
        questionType: (questionType as any) ?? 'SINGLE',
        orderIndex: 0,
        approvalStatus: needsApproval ? 'PENDING' : 'APPROVED',
        submittedById: submittedBy?.id,
        options: { create: options },
      },
      include: { options: true },
    });
  }

  updateBankQuestion(
    id: string,
    data: {
      content?: string;
      imageUrl?: string;
      explanation?: string;
      subjectId?: string;
      points?: number;
      questionType?: string;
      options?: { content: string; isCorrect: boolean; orderIndex: number }[];
    },
  ) {
    const { options, questionType, ...rest } = data;
    return this.prisma.question.update({
      where: { id },
      data: {
        ...rest,
        ...(questionType ? { questionType: questionType as any } : {}),
        ...(options ? { options: { deleteMany: {}, create: options } } : {}),
      },
      include: { options: true },
    });
  }

  deleteBankQuestion(id: string) {
    return this.prisma.question.delete({ where: { id } });
  }

  async deleteAllBankQuestions(subjectId?: string) {
    const result = await this.prisma.question.deleteMany({
      where: { isBank: true, ...(subjectId ? { subjectId } : {}) },
    });

    return { deleted: result.count };
  }

  // ── Phát hiện trùng lặp ──────────────────────────────────────────────
  async checkDuplicates(texts: string[]): Promise<
    {
      index: number;
      text: string;
      matches: {
        id: string;
        content: string;
        score: number;
        level: 'exact' | 'high' | 'medium';
      }[];
    }[]
  > {
    const existingRaw = await this.prisma.question.findMany({
      where: { isBank: true },
      select: { id: true, content: true },
    });
    // Tiền xử lý normalize/tokenize cho từng câu hỏi có sẵn ĐÚNG 1 LẦN — import
    // cả trăm dòng cùng lúc mà tính lại cho existing ở mỗi dòng (texts.length
    // lần) từng khiến bước kiểm tra trùng lặp rất chậm với ngân hàng câu hỏi lớn.
    const existing = existingRaw.map((q) => ({
      ...q,
      norm: normalizeText(q.content),
      tokens: tokenize(q.content),
    }));

    return texts.map((text, index) => {
      const queryTokens = tokenize(text);
      const queryNorm = normalizeText(text);
      const matches: {
        id: string;
        content: string;
        score: number;
        level: 'exact' | 'high' | 'medium';
      }[] = [];

      for (const q of existing) {
        if (queryNorm === q.norm) {
          matches.push({
            id: q.id,
            content: q.content,
            score: 1,
            level: 'exact',
          });
          continue;
        }
        const score = jaccardSimilarity(queryTokens, q.tokens);
        if (score >= 0.85)
          matches.push({ id: q.id, content: q.content, score, level: 'high' });
        else if (score >= 0.65)
          matches.push({
            id: q.id,
            content: q.content,
            score,
            level: 'medium',
          });
      }

      // Sắp xếp theo điểm giảm dần, lấy 3 kết quả cao nhất
      matches.sort((a, b) => b.score - a.score);
      return { index, text, matches: matches.slice(0, 3) };
    });
  }

  // ── Kiểm tra chính tả (tiếng Việt) ─────────────────────────────────────
  async checkSpelling(texts: string[]): Promise<
    {
      rowIndex: number;
      warnings: { word: string; suggestions: string[] }[];
    }[]
  > {
    const checker = await getSpellChecker();
    return texts.map((text, rowIndex) => {
      const words = normalizeText(text)
        .split(' ')
        .filter((w) => w.length > 1);
      const warnings: { word: string; suggestions: string[] }[] = [];
      const seen = new Set<string>();
      for (const word of words) {
        // Bỏ qua token có chữ số (số hiệu văn bản, năm, mã...) — không bao giờ
        // có trong từ điển, chỉ sinh cảnh báo vô nghĩa và tốn suggest() rất chậm.
        if (seen.has(word) || /\d/.test(word)) continue;
        seen.add(word);
        const suggestions = lookupSpelling(checker, word);
        if (suggestions) warnings.push({ word, suggestions });
      }
      return { rowIndex, warnings };
    });
  }
  // ── Nhập câu hỏi từ Excel ────────────────────────────────────────────
  /** Đọc danh sách tên sheet của file Excel — dùng để hỏi người dùng chọn sheet khi file có nhiều hơn 1 sheet. */
  getExcelSheetNames(buffer: Buffer): string[] {
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
    return wb.SheetNames;
  }

  async importQuestionsFromExcel(
    buffer: Buffer,
    subjectId: string,
    dryRun = false,
    sheetName?: string,
    submittedBy?: { id: string; role: string },
    importDuplicates = false,
  ): Promise<{
    preview?: {
      rowNumber: number;
      content: string;
      optionTexts: (string | null)[];
      correctIndex: number;
      explanation: string | null;
      duplicateLevel: 'exact' | 'high' | 'medium' | null;
      duplicateMatch: { id: string; content: string; score: number } | null;
      spellingWarnings: { word: string; suggestions: string[] }[];
    }[];
    imported: number;
    skipped: number;
    errors: string[];
  }> {
    if (!subjectId)
      throw new BadRequestException('Phải chọn lĩnh vực trước khi import');

    const wb = XLSX.read(buffer, { type: 'buffer' });
    const resolvedSheetName =
      sheetName && wb.SheetNames.includes(sheetName)
        ? sheetName
        : wb.SheetNames[0];
    const ws = wb.Sheets[resolvedSheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
    });

    // Phân tích (parse) tất cả các dòng hợp lệ trước
    type ParsedRow = {
      rowNumber: number;
      content: string;
      optionTexts: (string | null)[];
      correctIndex: number;
      explanation: string | null;
    };
    const parsed: ParsedRow[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const content = row[0]?.toString().trim();
      if (!content) continue;

      const optionTexts = [row[1], row[2], row[3], row[4]].map(
        (v) => v?.toString().trim() ?? null,
      );
      const validOptions = optionTexts.filter(Boolean);
      if (validOptions.length < 2) {
        errors.push(`Dòng ${i + 1}: Không đủ đáp án`);
        continue;
      }

      const correctRaw = Number(row[5]);
      if (!correctRaw || correctRaw < 1 || correctRaw > 4) {
        errors.push(`Dòng ${i + 1}: Đáp án đúng không hợp lệ (${row[5]})`);
        continue;
      }
      const correctIndex = correctRaw - 1;
      // correctIndex trỏ theo VỊ TRÍ CỘT CỐ ĐỊNH (0=B,1=C,2=D,3=E), không phải theo
      // thứ tự trong validOptions đã nén — nếu so với validOptions.length sẽ từ chối
      // nhầm khi có đáp án bỏ trống ở giữa (vd B,D có nội dung nhưng C trống).
      if (!optionTexts[correctIndex]) {
        errors.push(
          `Dòng ${i + 1}: Đáp án đúng trỏ tới cột ${String.fromCharCode(66 + correctIndex)} đang để trống`,
        );
        continue;
      }

      parsed.push({
        rowNumber: i + 1,
        content,
        optionTexts,
        correctIndex,
        explanation: row[6]?.toString().trim() || null,
      });
    }

    if (dryRun) {
      // Duplicate + spell check chỉ cần tính cho bước xem trước — admin có thể sửa
      // nội dung ngay trên modal, lúc đó mới cần tính lại (xem createBankQuestions).
      const contents = parsed.map((r) => r.content);
      const [dupResults, spellResults] = await Promise.all([
        this.checkDuplicates(contents),
        this.checkSpelling(contents),
      ]);
      const preview = parsed.map((row, idx) => {
        const dup = dupResults[idx];
        const topMatch = dup.matches[0] ?? null;
        return {
          rowNumber: row.rowNumber,
          content: row.content,
          optionTexts: row.optionTexts,
          correctIndex: row.correctIndex,
          explanation: row.explanation,
          duplicateLevel: topMatch?.level ?? null,
          duplicateMatch: topMatch
            ? {
                id: topMatch.id,
                content: topMatch.content,
                score: topMatch.score,
              }
            : null,
          spellingWarnings: spellResults[idx]?.warnings ?? [],
        };
      });
      return { preview, imported: 0, skipped: 0, errors };
    }

    const created = await this.createBankQuestions(
      subjectId,
      parsed,
      submittedBy,
      importDuplicates,
    );
    return {
      imported: created.imported,
      skipped: created.skipped,
      errors: [...errors, ...created.errors],
    };
  }

  // Tạo câu hỏi ngân hàng từ danh sách dòng đã hợp lệ (content/optionTexts/
  // correctIndex/explanation) — dùng chung cho import từ file Excel và import từ
  // dữ liệu admin đã sửa trên modal xem trước (xem importBankQuestionRows bên dưới).
  // Luôn tự chấm lại trùng lặp ngay tại đây thay vì tin dữ liệu duplicateLevel do
  // client gửi lên, để câu vừa sửa nội dung cũng được đánh giá đúng bằng dữ liệu
  // DB mới nhất, không dùng kết quả trùng lặp đã cũ từ bước xem trước.
  //
  // importDuplicates=false (mặc định): câu trùng hoàn toàn/gần trùng (exact/high)
  // bị tự động bỏ qua như trước giờ. true: admin đã xác nhận vẫn muốn import cả
  // những câu đó (VD chủ đích thêm câu hỏi gần giống để đa dạng đề thi).
  private async createBankQuestions(
    subjectId: string,
    rows: {
      rowNumber: number;
      content: string;
      optionTexts: (string | null)[];
      correctIndex: number;
      explanation: string | null;
    }[],
    submittedBy?: { id: string; role: string },
    importDuplicates = false,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    if (rows.length === 0) return { imported: 0, skipped: 0, errors: [] };

    const dupResults = await this.checkDuplicates(rows.map((r) => r.content));
    // Việc 9 — quy trình duyệt câu hỏi mới: xem createBankQuestion() ở trên.
    const needsApproval = submittedBy?.role === 'TRAINER';
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const topDup = dupResults[idx].matches[0];
      if (
        !importDuplicates &&
        topDup &&
        (topDup.level === 'exact' || topDup.level === 'high')
      ) {
        skipped++;
        continue;
      }
      try {
        await this.prisma.question.create({
          data: {
            content: row.content,
            explanation: row.explanation,
            subjectId,
            isBank: true,
            questionType: 'SINGLE',
            orderIndex: 0,
            approvalStatus: needsApproval ? 'PENDING' : 'APPROVED',
            submittedById: submittedBy?.id,
            options: {
              create: row.optionTexts
                .map((text, i) =>
                  text
                    ? {
                        content: text,
                        isCorrect: i === row.correctIndex,
                        orderIndex: i + 1,
                      }
                    : null,
                )
                .filter(Boolean) as any,
            },
          },
        });
        imported++;
      } catch {
        errors.push(`Dòng ${row.rowNumber}: Lỗi khi lưu`);
      }
    }
    return { imported, skipped, errors };
  }

  // Import trực tiếp từ các dòng admin đã xem/sửa trên modal xem trước — dùng khi
  // admin đã chỉnh nội dung/đáp án để khắc phục cảnh báo chính tả hoặc trùng lặp,
  // không cần upload lại file Excel gốc (vốn không còn khớp với nội dung đã sửa).
  async importBankQuestionRows(
    subjectId: string,
    rows: ImportBankQuestionRowDto[],
    submittedBy?: { id: string; role: string },
    importDuplicates = false,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    if (!subjectId)
      throw new BadRequestException('Phải chọn lĩnh vực trước khi import');
    if (!rows?.length)
      throw new BadRequestException('Không có câu hỏi để import');

    const errors: string[] = [];
    const valid: {
      rowNumber: number;
      content: string;
      optionTexts: (string | null)[];
      correctIndex: number;
      explanation: string | null;
    }[] = [];

    for (const row of rows) {
      const content = row.content?.trim();
      if (!content) {
        errors.push(`Dòng ${row.rowNumber}: Thiếu nội dung câu hỏi`);
        continue;
      }
      const optionTexts: (string | null)[] = [0, 1, 2, 3].map((i) => {
        const v = row.optionTexts?.[i];
        return typeof v === 'string' && v.trim() ? v.trim() : null;
      });
      if (optionTexts.filter(Boolean).length < 2) {
        errors.push(`Dòng ${row.rowNumber}: Không đủ đáp án`);
        continue;
      }
      if (
        !Number.isInteger(row.correctIndex) ||
        row.correctIndex < 0 ||
        row.correctIndex > 3 ||
        !optionTexts[row.correctIndex]
      ) {
        errors.push(`Dòng ${row.rowNumber}: Đáp án đúng không hợp lệ`);
        continue;
      }
      valid.push({
        rowNumber: row.rowNumber,
        content,
        optionTexts,
        correctIndex: row.correctIndex,
        explanation: row.explanation?.trim() || null,
      });
    }

    const created = await this.createBankQuestions(
      subjectId,
      valid,
      submittedBy,
      importDuplicates,
    );
    return {
      imported: created.imported,
      skipped: created.skipped,
      errors: [...errors, ...created.errors],
    };
  }

  // ── Câu hỏi (thuộc bộ đề) ────────────────────────────────────────────
  getQuestions() {
    return this.prisma.question.findMany({
      where: { isBank: false },
      include: {
        options: { orderBy: { orderIndex: 'asc' } },
        subject: { select: { id: true, name: true } },
      },
      orderBy: { orderIndex: 'asc' },
    });
  }

  deleteQuestion(id: string) {
    return this.prisma.question.delete({ where: { id } });
  }

  // ── Bộ đề (CRUD đầy đủ) ──────────────────────────────────────────────
  getQuizzes() {
    return this.prisma.quiz.findMany({
      include: {
        _count: { select: { assignments: true, questions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getQuiz(id: string) {
    const quiz = await this.prisma.quiz.findUniqueOrThrow({ where: { id } });
    const questions = await this.prisma.question.findMany({
      where: { quizId: id },
      include: { options: { orderBy: { orderIndex: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    });
    return { ...quiz, questions };
  }

  createQuiz(data: {
    title: string;
    description?: string;
    topic?: string;
    durationMin: number;
    passScore?: number;
    instantFeedback?: boolean;
    maxAttempts?: number;
  }) {
    return this.prisma.quiz.create({ data });
  }

  updateQuiz(
    id: string,
    data: {
      title?: string;
      description?: string;
      topic?: string;
      durationMin?: number;
      passScore?: number;
      isActive?: boolean;
      instantFeedback?: boolean;
      maxAttempts?: number;
    },
  ) {
    return this.prisma.quiz.update({ where: { id }, data });
  }

  // Nhân bản toàn bộ bộ đề (câu hỏi + đáp án) thành bộ đề MỚI độc lập — sửa bản
  // sao không ảnh hưởng bản gốc. Mặc định TẮT hoạt động để admin tự kiểm tra/
  // chỉnh sửa trước khi giao cho học viên, tránh lộ đề trùng ngay khi vừa tạo.
  async duplicateQuiz(id: string) {
    const original = await this.prisma.quiz.findUniqueOrThrow({
      where: { id },
      include: {
        questions: {
          include: { options: { orderBy: { orderIndex: 'asc' } } },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    return this.prisma.quiz.create({
      data: {
        title: `${original.title} (Bản sao)`,
        description: original.description,
        topic: original.topic,
        durationMin: original.durationMin,
        passScore: original.passScore,
        instantFeedback: original.instantFeedback,
        maxAttempts: original.maxAttempts,
        isActive: false,
        questions: {
          create: original.questions.map((q) => ({
            subjectId: q.subjectId,
            content: q.content,
            imageUrl: q.imageUrl,
            explanation: q.explanation,
            questionType: q.questionType,
            orderIndex: q.orderIndex,
            points: q.points,
            isBank: false,
            options: {
              create: q.options.map((o) => ({
                content: o.content,
                isCorrect: o.isCorrect,
                orderIndex: o.orderIndex,
              })),
            },
          })),
        },
      },
      include: { _count: { select: { assignments: true, questions: true } } },
    });
  }

  async deleteQuiz(id: string) {
    const quiz = await this.prisma.quiz.findUniqueOrThrow({
      where: { id },
      include: {
        _count: {
          select: { assignments: true, examSessions: true, tournaments: true },
        },
      },
    });
    if (quiz._count.assignments > 0 || quiz._count.examSessions > 0)
      throw new BadRequestException(
        'Không thể xóa bộ đề đã được phân công hoặc có đợt thi. Hãy xóa phân công trước.',
      );
    // tournaments_quiz_id_fkey là RESTRICT (không cascade) — không kiểm tra trước
    // thì lệnh xóa bên dưới ném lỗi ràng buộc khóa ngoại (P2003) không được bắt,
    // NestJS trả 500 chung chung khiến giao diện tưởng như "không có phản hồi gì".
    if (quiz._count.tournaments > 0)
      throw new BadRequestException(
        'Không thể xóa bộ đề đang được dùng cho giải đấu loại trực tiếp. Hãy xóa giải đấu đó trước.',
      );

    // Xóa cascade các phiên Arena (ArenaTeam/ArenaRound/ArenaBuzz đã được DB tự động cascade)
    await this.prisma.arenaSession.deleteMany({ where: { quizId: id } });

    // Xóa cascade theo thứ tự: submission_answers → submissions → quiz_versions → quiz
    const versions = await this.prisma.quizVersion.findMany({
      where: { quizId: id },
      select: { id: true },
    });
    const versionIds = versions.map((v) => v.id);
    if (versionIds.length > 0) {
      const submissions = await this.prisma.submission.findMany({
        where: { quizVersionId: { in: versionIds } },
        select: { id: true },
      });
      const submissionIds = submissions.map((s) => s.id);
      if (submissionIds.length > 0) {
        await this.prisma.submissionAnswer.deleteMany({
          where: { submissionId: { in: submissionIds } },
        });
        await this.prisma.submission.deleteMany({
          where: { id: { in: submissionIds } },
        });
      }
      // quiz_attempts_quiz_version_id_fkey là RESTRICT — xóa trước khi xóa
      // quiz_versions, không thì vỡ ràng buộc khóa ngoại. Đồng bộ với cách xử
      // lý submissions ở trên: xóa bộ đề là xóa luôn lịch sử làm bài liên
      // quan (DB tự cascade quiz_attempt_answers/attempt_violations).
      await this.prisma.quizAttempt.deleteMany({
        where: { quizVersionId: { in: versionIds } },
      });
      await this.prisma.quizVersion.deleteMany({ where: { quizId: id } });
    }
    return this.prisma.quiz.delete({ where: { id } });
  }

  // ── Lấy câu hỏi ngẫu nhiên từ ngân hàng ─────────────────────────────
  async pickRandomToQuiz(
    quizId: string,
    params: {
      subjectId?: string;
      count?: number;
      subjectSlots?: { subjectId?: string; count: number }[];
      replaceAll?: boolean;
    },
  ) {
    const { replaceAll } = params;

    // Chuẩn hoá: chuyển định dạng cũ (subjectId + count) sang định dạng subjectSlots
    const slots: { subjectId?: string; count: number }[] = params.subjectSlots
      ?.length
      ? params.subjectSlots
      : [{ subjectId: params.subjectId, count: params.count ?? 0 }];

    const pickedAll: Array<{
      subjectId: string | null;
      content: string;
      explanation: string | null;
      questionType: any;
      points: number;
      options: { content: string; isCorrect: boolean; orderIndex: number }[];
    }> = [];

    for (const slot of slots) {
      const { subjectId, count } = slot;
      if (!count || count <= 0) continue;

      const bankQuestions = await this.prisma.question.findMany({
        where: {
          isBank: true,
          approvalStatus: 'APPROVED',
          ...(subjectId ? { subjectId } : {}),
        },
        include: { options: { orderBy: { orderIndex: 'asc' } } },
      });

      if (bankQuestions.length === 0)
        throw new BadRequestException(
          `Lĩnh vực không có câu hỏi trong ngân hàng`,
        );
      if (count > bankQuestions.length)
        throw new BadRequestException(
          `Chỉ có ${bankQuestions.length} câu trong ngân hàng cho lĩnh vực này`,
        );

      // Xáo trộn theo thuật toán Fisher-Yates
      const shuffled = [...bankQuestions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      pickedAll.push(...shuffled.slice(0, count));
    }

    if (pickedAll.length === 0)
      throw new BadRequestException('Không có câu hỏi nào được chọn');

    if (replaceAll) {
      await this.prisma.question.deleteMany({
        where: { quizId, isBank: false },
      });
    }

    const maxOrder = await this.prisma.question.aggregate({
      where: { quizId },
      _max: { orderIndex: true },
    });
    let orderIdx = (maxOrder._max.orderIndex ?? 0) + 1;

    for (const q of pickedAll) {
      await this.prisma.question.create({
        data: {
          quizId,
          subjectId: q.subjectId,
          content: q.content,
          explanation: q.explanation,
          questionType: q.questionType,
          points: q.points,
          orderIndex: orderIdx++,
          isBank: false,
          options: {
            create: q.options.map((o) => ({
              content: o.content,
              isCorrect: o.isCorrect,
              orderIndex: o.orderIndex,
            })),
          },
        },
      });
    }

    return { added: pickedAll.length, quizId };
  }

  // ── Phân công ────────────────────────────────────────────────────────
  private readonly assignmentInclude = {
    quiz: { select: { id: true, title: true } },
    user: {
      select: {
        id: true,
        fullName: true,
        department: { select: { id: true, name: true, parentId: true } },
      },
    },
    canBo: {
      select: {
        id: true,
        fullName: true,
        cbCode: true,
        department: {
          select: { id: true, name: true, code: true, parentId: true },
        },
      },
    },
    department: { select: { id: true, name: true, parentId: true } },
  } as const;

  getAssignments() {
    return this.prisma.assignment.findMany({
      include: this.assignmentInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  createAssignment(data: {
    quizId: string;
    userId?: string;
    canBoId?: string;
    departmentId?: string;
    startAt?: string;
    endAt?: string;
    status?: AssignmentStatus;
  }) {
    const { startAt, endAt, ...rest } = data;
    return this.prisma.assignment.create({
      data: {
        ...rest,
        startAt: startAt ? new Date(startAt) : undefined,
        endAt: endAt ? new Date(endAt) : undefined,
      },
      include: this.assignmentInclude,
    });
  }

  updateAssignment(
    id: string,
    data: {
      quizId?: string;
      canBoId?: string;
      departmentId?: string;
      userId?: string;
      startAt?: string | null;
      endAt?: string | null;
      status?: AssignmentStatus;
    },
  ) {
    const { startAt, endAt, ...rest } = data;
    // Khi đổi đối tượng, xoá liên kết cũ
    const clearFields: any = {};
    if ('canBoId' in data && data.canBoId) {
      clearFields.departmentId = null;
      clearFields.userId = null;
    }
    if ('departmentId' in data && data.departmentId) {
      clearFields.canBoId = null;
      clearFields.userId = null;
    }
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...rest,
        ...clearFields,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
      },
      include: this.assignmentInclude,
    });
  }

  async deleteAssignment(id: string) {
    // Chặn sớm thay vì để lỗi khóa ngoại (P2003) rớt xuống thành 500 khi cán bộ/user
    // đã làm bài (có QuizAttempt) — cùng nguyên tắc bảo vệ như xóa hàng loạt bên dưới.
    const attemptCount = await this.prisma.quizAttempt.count({
      where: { assignmentId: id },
    });
    if (attemptCount > 0)
      throw new BadRequestException(
        'Không thể xóa: cán bộ/user này đã làm bài. Không thể xóa phân công đã có người làm bài để tránh mất lịch sử chấm điểm.',
      );
    return this.prisma.assignment.delete({ where: { id } });
  }

  // Xóa hàng loạt theo bộ đề và/hoặc chi nhánh/phòng ban. Bỏ qua (không xóa) những phân
  // công đã có người làm bài (có QuizAttempt) để không vi phạm khóa ngoại và không mất
  // lịch sử chấm điểm.
  async deleteAssignmentsByFilter(quizId?: string, departmentId?: string) {
    if (!quizId && !departmentId)
      throw new BadRequestException(
        'Cần chọn ít nhất bộ đề hoặc chi nhánh/phòng ban để xóa',
      );

    let departmentIds: string[] | undefined;
    if (departmentId) {
      const children = await this.prisma.department.findMany({
        where: { parentId: departmentId },
        select: { id: true },
      });
      departmentIds = [departmentId, ...children.map((c) => c.id)];
    }

    const where: Prisma.AssignmentWhereInput = {
      ...(quizId ? { quizId } : {}),
      ...(departmentIds
        ? {
            OR: [
              { departmentId: { in: departmentIds } },
              { canBo: { departmentId: { in: departmentIds } } },
              { user: { departmentId: { in: departmentIds } } },
            ],
          }
        : {}),
    };

    const matched = await this.prisma.assignment.findMany({
      where,
      select: { id: true, _count: { select: { attempts: true } } },
    });

    const deletableIds = matched
      .filter((a) => a._count.attempts === 0)
      .map((a) => a.id);
    const skipped = matched.length - deletableIds.length;

    if (deletableIds.length === 0) return { deleted: 0, skipped };

    const result = await this.prisma.assignment.deleteMany({
      where: { id: { in: deletableIds } },
    });

    return { deleted: result.count, skipped };
  }

  // Gia hạn hàng loạt (đổi endAt) theo bộ đề và/hoặc chi nhánh/phòng ban đang lọc —
  // cùng cách xác định phạm vi như deleteAssignmentsByFilter ở trên, nhưng không có
  // khái niệm "bỏ qua" vì gia hạn không va chạm dữ liệu lịch sử (khác xóa).
  async extendAssignmentsByFilter(
    newEndAt: string,
    quizId?: string,
    departmentId?: string,
  ) {
    if (!quizId && !departmentId)
      throw new BadRequestException(
        'Cần chọn ít nhất bộ đề hoặc chi nhánh/phòng ban để gia hạn',
      );

    let departmentIds: string[] | undefined;
    if (departmentId) {
      const children = await this.prisma.department.findMany({
        where: { parentId: departmentId },
        select: { id: true },
      });
      departmentIds = [departmentId, ...children.map((c) => c.id)];
    }

    const where: Prisma.AssignmentWhereInput = {
      ...(quizId ? { quizId } : {}),
      ...(departmentIds
        ? {
            OR: [
              { departmentId: { in: departmentIds } },
              { canBo: { departmentId: { in: departmentIds } } },
              { user: { departmentId: { in: departmentIds } } },
            ],
          }
        : {}),
    };

    const result = await this.prisma.assignment.updateMany({
      where,
      data: { endAt: new Date(newEndAt) },
    });

    return { extended: result.count };
  }

  // Import danh sách phân công qua Excel — file chỉ cần 1 cột (mã cán bộ, User AD
  // hoặc username, ở CỘT ĐẦU TIÊN mỗi dòng), bộ đề + thời gian chọn sẵn trên form,
  // không cần khai báo lại trong file. Tái dùng createAssignmentsBulk() ở trên để
  // không lặp lại logic tạo Assignment.
  async importAssignmentsFromExcel(
    buffer: Buffer,
    quizId: string,
    startAt?: string,
    endAt?: string,
  ) {
    const wb = this.readWorkbook(buffer);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
    });
    const codes = [
      ...new Set(
        rows
          .map((r) => (r[0] ?? '').toString().trim())
          .filter((c) => c.length > 0),
      ),
    ];
    if (codes.length === 0)
      throw new BadRequestException('File không có dòng dữ liệu nào');

    const canBoList = await this.prisma.canBo.findMany({
      where: {
        OR: [
          { cbCode: { in: codes } },
          { userAD: { in: codes } },
          { username: { in: codes } },
        ],
      },
      select: { id: true, cbCode: true, userAD: true, username: true },
    });

    const matchedIds = new Set<string>();
    const notFound: string[] = [];
    for (const code of codes) {
      const found = canBoList.find(
        (cb) =>
          cb.cbCode === code || cb.userAD === code || cb.username === code,
      );
      if (found) matchedIds.add(found.id);
      else notFound.push(code);
    }

    if (matchedIds.size === 0) return { created: 0, notFound };

    const result = await this.createAssignmentsBulk({
      quizId,
      canBoIds: [...matchedIds],
      startAt,
      endAt,
    });

    return { created: result.count, notFound };
  }

  // ── Báo cáo ──────────────────────────────────────────────────────────
  async getReports() {
    const rows = await this.prisma.submission.findMany({
      include: {
        user: {
          select: {
            fullName: true,
            department: {
              select: {
                id: true,
                name: true,
                parentId: true,
                parent: { select: { id: true, name: true } },
              },
            },
          },
        },
        quizVersion: {
          include: { quiz: { select: { id: true, title: true } } },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    // Bộ đề cho phép thi lại nhiều lần nên 1 người có thể có nhiều Submission
    // cho cùng 1 quiz — đánh dấu bản điểm cao nhất mỗi (user, quiz) là kết quả
    // "chính thức" để trang Báo cáo tính đúng điểm trung bình/tỷ lệ đạt, đồng
    // thời vẫn giữ đủ mọi lần thi trong danh sách trả về (không ẩn dữ liệu).
    const bestScoreByKey = new Map<string, number>();
    for (const s of rows) {
      if (s.score === null) continue;
      const key = `${s.userId}::${s.quizVersion?.quiz?.id ?? ''}`;
      const current = bestScoreByKey.get(key);
      if (current === undefined || s.score > current) {
        bestScoreByKey.set(key, s.score);
      }
    }

    return rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      fullName: s.user?.fullName ?? '',
      departmentId: s.user?.department?.id ?? null,
      department: s.user?.department?.name ?? '',
      parentDepartmentId: s.user?.department?.parentId ?? null,
      parentDepartment: s.user?.department?.parent?.name ?? null,
      quizTitle: s.quizVersion?.quiz?.title ?? '',
      score: s.score,
      status: s.status,
      submittedAt: s.submittedAt,
      isBestForUser:
        s.score !== null &&
        bestScoreByKey.get(`${s.userId}::${s.quizVersion?.quiz?.id ?? ''}`) ===
          s.score,
    }));
  }

  // ── Xu hướng điểm & tỷ lệ đạt theo thời gian (Dashboard) ────────────────
  // Gộp trong bộ nhớ thay vì group-by SQL theo ngày cắt (Prisma không hỗ trợ
  // date-trunc sẵn, dùng $queryRaw sẽ phức tạp hơn không cần thiết cho quy mô
  // dữ liệu 1 tổ chức nội bộ).
  async getReportTrends(groupBy: 'week' | 'month' = 'week') {
    const rows = await this.prisma.submission.findMany({
      where: { status: 'GRADED', score: { not: null } },
      select: { score: true, isPassed: true, submittedAt: true },
    });

    const buckets = new Map<
      string,
      { total: number; passed: number; sumScore: number }
    >();
    for (const r of rows) {
      if (!r.submittedAt || r.score === null) continue;
      const key =
        groupBy === 'month'
          ? r.submittedAt.toISOString().slice(0, 7)
          : this.isoWeekKey(r.submittedAt);
      const b = buckets.get(key) ?? { total: 0, passed: 0, sumScore: 0 };
      b.total += 1;
      if (r.isPassed) b.passed += 1;
      b.sumScore += r.score;
      buckets.set(key, b);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, b]) => ({
        period,
        totalSubmissions: b.total,
        avgScore: Math.round(b.sumScore / b.total),
        passRate: Math.round((b.passed / b.total) * 100),
      }));
  }

  // Định danh tuần theo chuẩn ISO-8601 (VD "2026-W37") — dùng UTC để tránh lệch
  // theo múi giờ máy chủ chạy container.
  private isoWeekKey(date: Date): string {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  async deleteReport(id: string, actorUserId?: string) {
    const result = await this.deleteReportsBulk([id], actorUserId);
    return result;
  }

  async deleteReportsBulk(ids: string[], actorUserId?: string) {
    if (ids.length === 0) return { deleted: 0 };
    const submissions = await this.prisma.submission.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true },
    });
    if (submissions.length === 0) return { deleted: 0 };
    const submissionIds = submissions.map((s) => s.id);
    const affectedUserIds = [...new Set(submissions.map((s) => s.userId))];

    await this.prisma.quizAttempt.deleteMany({
      where: {
        OR: [
          { submissionId: { in: submissionIds } },
          { id: { in: submissionIds } },
        ],
      },
    });
    await this.prisma.xpTransaction.deleteMany({
      where: {
        referenceId: { in: submissionIds },
        source: {
          in: [XpSource.EXAM_PASS, XpSource.EXAM_FAIL, XpSource.EXAM_PERFECT],
        },
      },
    });
    await this.prisma.submissionAnswer.deleteMany({
      where: { submissionId: { in: submissionIds } },
    });
    // KHÔNG xóa AuditLog liên quan — nhật ký quản trị phải bất biến/append-only,
    // vẫn giữ lại bằng chứng "ai đã nộp/xóa bài gì" dù chính bài thi đó không
    // còn tồn tại nữa (trước đây có xóa nhầm, làm mất dấu vết audit).
    const { count } = await this.prisma.submission.deleteMany({
      where: { id: { in: submissionIds } },
    });

    for (const userId of affectedUserIds) {
      await this.gamification.recomputeUserProgress(userId);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'DELETE_REPORTS_BULK',
        meta: { submissionIds, count },
      },
    });

    return { deleted: count };
  }

  // ── Nhật ký quản trị (Audit Log) ───────────────────────────────────────
  async getAuditLogs(
    filters: {
      action?: string;
      userId?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {},
  ) {
    const { action, userId, from, to, limit = 200 } = filters;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user?.fullName ?? null,
      username: r.user?.username ?? null,
      action: r.action,
      entityId: r.entityId,
      meta: r.meta,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
    }));
  }

  // ── Giám sát vi phạm khi làm bài (Attempt Violations) ───────────────────
  async getAttemptViolations(
    filters: {
      type?: AttemptViolationType;
      userId?: string;
      quizId?: string;
      limit?: number;
    } = {},
  ) {
    const { type, userId, quizId, limit = 200 } = filters;
    const rows = await this.prisma.attemptViolation.findMany({
      where: {
        ...(type ? { type } : {}),
        attempt: {
          ...(userId ? { userId } : {}),
          ...(quizId ? { quizId } : {}),
        },
      },
      include: {
        attempt: {
          select: {
            id: true,
            userId: true,
            quizId: true,
            status: true,
            violationCount: true,
            user: { select: { fullName: true, username: true } },
            assignment: { select: { quiz: { select: { title: true } } } },
          },
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 500),
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      occurredAt: r.occurredAt,
      attemptId: r.attemptId,
      userId: r.attempt.userId,
      userName: r.attempt.user.fullName,
      username: r.attempt.user.username,
      quizId: r.attempt.quizId,
      quizTitle: r.attempt.assignment.quiz.title,
      attemptStatus: r.attempt.status,
      totalViolationsInAttempt: r.attempt.violationCount,
    }));
  }

  // ── Phân tích câu hỏi toàn hệ thống (Question Analytics) ────────────────
  // Khác với getQuestionStats() (chỉ soi 1 đợt thi/1 lớp) — hàm này gộp MỌI
  // Submission đã chấm trên toàn hệ thống cho từng câu hỏi đã copy vào bộ đề
  // (isBank=false). Không gộp xuyên nhiều bộ đề dù nội dung trùng nhau (mỗi
  // bộ đề có bản copy riêng, id khác nhau) — giữ đơn giản, tránh phải dùng lại
  // thuật toán so khớp trùng lặp (Jaccard) vốn chỉ để phục vụ lúc import.
  async getQuestionAnalytics(
    filters: { quizId?: string; subjectId?: string } = {},
  ) {
    const { quizId, subjectId } = filters;
    const questions = await this.prisma.question.findMany({
      where: {
        isBank: false,
        ...(quizId ? { quizId } : {}),
        ...(subjectId ? { subjectId } : {}),
      },
      include: {
        options: { select: { id: true, isCorrect: true, orderIndex: true } },
        quiz: { select: { id: true, title: true } },
        subject: { select: { name: true } },
      },
    });
    if (questions.length === 0) return [];

    const questionById = new Map(questions.map((q) => [q.id, q]));
    const answers = await this.prisma.submissionAnswer.findMany({
      where: { questionId: { in: [...questionById.keys()] } },
      select: {
        questionId: true,
        selectedOptionIds: true,
        submission: { select: { score: true } },
      },
    });

    const byQuestion = new Map<
      string,
      { score: number; isCorrect: boolean }[]
    >();
    for (const a of answers) {
      const q = questionById.get(a.questionId);
      if (!q || a.submission.score === null) continue;
      const selected = Array.isArray(a.selectedOptionIds)
        ? (a.selectedOptionIds as string[])
        : [];
      const isCorrect = this.isAnswerCorrectForAnalytics(
        q.questionType,
        q.options,
        selected,
      );
      const list = byQuestion.get(a.questionId) ?? [];
      list.push({ score: a.submission.score, isCorrect });
      byQuestion.set(a.questionId, list);
    }

    return questions
      .map((q) => {
        const rows = byQuestion.get(q.id) ?? [];
        const total = rows.length;
        const correct = rows.filter((r) => r.isCorrect).length;

        // Độ phân biệt (discrimination index): so tỷ lệ đúng của nửa điểm cao
        // nhất với nửa điểm thấp nhất TRONG SỐ người đã làm câu này — cần tối
        // thiểu 4 người mới đủ ý nghĩa để tính, ít hơn thì để null.
        let discrimination: number | null = null;
        if (total >= 4) {
          const sorted = [...rows].sort((a, b) => b.score - a.score);
          const half = Math.floor(sorted.length / 2);
          const top = sorted.slice(0, half);
          const bottom = sorted.slice(sorted.length - half);
          const topRate = top.filter((r) => r.isCorrect).length / top.length;
          const bottomRate =
            bottom.filter((r) => r.isCorrect).length / bottom.length;
          discrimination = Math.round((topRate - bottomRate) * 100);
        }

        return {
          id: q.id,
          content: q.content,
          questionType: q.questionType,
          quizId: q.quizId,
          quizTitle: q.quiz?.title ?? null,
          subjectName: q.subject?.name ?? null,
          totalAttempts: total,
          correctCount: correct,
          correctRate: total > 0 ? Math.round((correct / total) * 100) : null,
          discrimination,
        };
      })
      .filter((r) => r.totalAttempts > 0)
      .sort((a, b) => (a.correctRate ?? 100) - (b.correctRate ?? 100));
  }

  // Chấm đúng/sai tôn trọng thứ tự cho câu ORDERING — cố tình viết riêng (không
  // tái dùng gradeQuestion của attempts.service.ts) để tránh phụ thuộc chéo vào
  // file đang được sửa song song; xem PerformanceService.isAnswerCorrect cho
  // bản tương tự.
  private isAnswerCorrectForAnalytics(
    questionType: QuestionType,
    options: { id: string; isCorrect: boolean; orderIndex: number }[],
    selectedOptionIds: string[],
  ): boolean {
    if (questionType === QuestionType.ORDERING) {
      const correctOrder = options
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((o) => o.id);
      return JSON.stringify(correctOrder) === JSON.stringify(selectedOptionIds);
    }
    const correctOptionIds = options
      .filter((o) => o.isCorrect)
      .map((o) => o.id)
      .sort();
    return (
      JSON.stringify(correctOptionIds) ===
      JSON.stringify([...selectedOptionIds].sort())
    );
  }

  // ── So sánh hiệu suất theo chi nhánh/phòng ban (Department Performance) ──
  // Gộp theo Department của USER làm bài (không phải department trên Assignment —
  // 1 assignment có thể giao cho cả phòng ban, còn ở đây cần biết TỪNG người thuộc
  // phòng ban nào để cộng dồn đúng điểm của họ).
  async getDepartmentPerformance() {
    const [departments, submissions] = await Promise.all([
      this.prisma.department.findMany({
        select: { id: true, name: true, parentId: true },
      }),
      this.prisma.submission.findMany({
        where: { status: 'GRADED', score: { not: null } },
        select: {
          score: true,
          isPassed: true,
          user: { select: { departmentId: true } },
        },
      }),
    ]);

    const stats = new Map<
      string,
      { total: number; passed: number; sumScore: number }
    >();
    for (const s of submissions) {
      const deptId = s.user?.departmentId;
      if (!deptId || s.score === null) continue;
      const entry = stats.get(deptId) ?? { total: 0, passed: 0, sumScore: 0 };
      entry.total += 1;
      if (s.isPassed) entry.passed += 1;
      entry.sumScore += s.score;
      stats.set(deptId, entry);
    }

    return departments
      .map((d) => {
        const s = stats.get(d.id);
        return {
          id: d.id,
          name: d.name,
          parentId: d.parentId,
          totalSubmissions: s?.total ?? 0,
          avgScore: s && s.total > 0 ? Math.round(s.sumScore / s.total) : null,
          passRate:
            s && s.total > 0 ? Math.round((s.passed / s.total) * 100) : null,
        };
      })
      .filter((d) => d.totalSubmissions > 0)
      .sort((a, b) => (a.avgScore ?? 100) - (b.avgScore ?? 100));
  }

  // ── Cảnh báo sớm cán bộ có nguy cơ trượt/bỏ thi (At-Risk Staff) ──────────
  // 3 nhóm quy tắc độc lập, không cộng dồn thành 1 "điểm rủi ro" duy nhất — mỗi
  // nhóm phản ánh 1 kiểu rủi ro khác nhau, admin tự đọc và quyết định can thiệp.
  async getAtRiskStaff() {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [nearDeadlineNoSubmission, recentFails, highViolations] =
      await Promise.all([
        // Được giao trực tiếp (không phải giao theo phòng ban) và sắp hết hạn
        // trong 3 ngày tới nhưng chưa có bài nào được chấm.
        this.prisma.assignment.findMany({
          where: {
            status: 'ACTIVE',
            userId: { not: null },
            endAt: { gte: now, lte: soon },
            attempts: { none: { status: 'GRADED' } },
          },
          select: {
            id: true,
            userId: true,
            endAt: true,
            user: { select: { fullName: true } },
            quiz: { select: { title: true } },
          },
        }),
        // Trượt bài trong 30 ngày gần nhất
        this.prisma.submission.findMany({
          where: {
            status: 'GRADED',
            isPassed: false,
            submittedAt: { gte: last30Days },
          },
          select: {
            userId: true,
            score: true,
            submittedAt: true,
            user: { select: { fullName: true } },
            quizVersion: { select: { quiz: { select: { title: true } } } },
          },
          orderBy: { submittedAt: 'desc' },
        }),
        // Bị ghi nhận từ 3 vi phạm trở lên trong 1 lần làm bài
        this.prisma.quizAttempt.findMany({
          where: { violationCount: { gte: 3 } },
          select: {
            userId: true,
            violationCount: true,
            user: { select: { fullName: true } },
            assignment: { select: { quiz: { select: { title: true } } } },
          },
          orderBy: { violationCount: 'desc' },
        }),
      ]);

    return {
      nearDeadlineNoSubmission: nearDeadlineNoSubmission.map((a) => ({
        userId: a.userId,
        userName: a.user?.fullName ?? null,
        quizTitle: a.quiz.title,
        endAt: a.endAt,
      })),
      recentFails: recentFails.map((s) => ({
        userId: s.userId,
        userName: s.user?.fullName ?? null,
        quizTitle: s.quizVersion?.quiz?.title ?? null,
        score: s.score,
        submittedAt: s.submittedAt,
      })),
      highViolations: highViolations.map((a) => ({
        userId: a.userId,
        userName: a.user?.fullName ?? null,
        quizTitle: a.assignment?.quiz?.title ?? null,
        violationCount: a.violationCount,
      })),
    };
  }

  // ── Người dùng ───────────────────────────────────────────────────────
  getUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        departmentId: true,
        department: {
          select: {
            id: true,
            name: true,
            code: true,
            parentId: true,
            parent: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async createAssignmentsBulk(data: {
    quizId: string;
    canBoIds?: string[] | 'all';
    departmentIds?: string[];
    userIds?: string[] | 'all'; // tương thích ngược
    status?: AssignmentStatus;
    startAt?: string;
    endAt?: string;
  }) {
    const base = {
      quizId: data.quizId,
      status: data.status ?? AssignmentStatus.ACTIVE,
      startAt: data.startAt ? new Date(data.startAt) : undefined,
      endAt: data.endAt ? new Date(data.endAt) : undefined,
    };

    // Nhánh xử lý departmentIds (giao theo nhiều phòng ban cùng lúc)
    if (data.departmentIds !== undefined) {
      const result = await this.prisma.assignment.createMany({
        data: data.departmentIds.map((departmentId) => ({
          ...base,
          departmentId,
        })),
        skipDuplicates: true,
      });
      return { count: result.count };
    }

    // Nhánh xử lý canBoIds (chính)
    if (data.canBoIds !== undefined) {
      const ids =
        data.canBoIds === 'all'
          ? (
              await this.prisma.canBo.findMany({
                where: { isActive: true },
                select: { id: true },
              })
            ).map((c) => c.id)
          : data.canBoIds;
      const result = await this.prisma.assignment.createMany({
        data: ids.map((canBoId) => ({ ...base, canBoId })),
        skipDuplicates: true,
      });
      return { count: result.count };
    }

    // Nhánh xử lý userIds (tương thích ngược)
    const ids =
      data.userIds === 'all'
        ? (
            await this.prisma.user.findMany({
              where: { isActive: true },
              select: { id: true },
            })
          ).map((u) => u.id)
        : (data.userIds ?? []);
    const result = await this.prisma.assignment.createMany({
      data: ids.map((userId) => ({ ...base, userId })),
      skipDuplicates: true,
    });
    return { count: result.count };
  }

  // ── Năm học ──────────────────────────────────────────────────────────
  getAcademicYears() {
    return this.prisma.academicYear.findMany({
      include: { _count: { select: { classes: true } } },
      orderBy: { startYear: 'desc' },
    });
  }

  createAcademicYear(data: {
    name: string;
    startYear: number;
    endYear: number;
    isActive?: boolean;
  }) {
    return this.prisma.academicYear.create({ data });
  }

  async updateAcademicYear(
    id: string,
    data: {
      name?: string;
      startYear?: number;
      endYear?: number;
      isActive?: boolean;
    },
  ) {
    // Nếu đặt năm học này thành đang hoạt động thì tắt trạng thái hoạt động của các năm còn lại
    if (data.isActive) {
      await this.prisma.academicYear.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }
    return this.prisma.academicYear.update({ where: { id }, data });
  }

  deleteAcademicYear(id: string) {
    return this.prisma.academicYear.delete({ where: { id } });
  }

  // ── Lớp học ──────────────────────────────────────────────────────────
  getClasses(academicYearId?: string) {
    return this.prisma.class.findMany({
      where: academicYearId ? { academicYearId } : undefined,
      include: {
        academicYear: { select: { name: true } },
        _count: { select: { members: true, examSessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClass(id: string) {
    const cls = await this.prisma.class.findUniqueOrThrow({
      where: { id },
      include: {
        academicYear: { select: { name: true } },
        members: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                department: { select: { name: true } },
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        examSessions: {
          include: { quiz: { select: { title: true } } },
          orderBy: { startAt: 'desc' },
        },
      },
    });
    return cls;
  }

  async createClass(data: {
    name: string;
    code: string;
    description?: string;
    academicYearId?: string;
    departmentId?: string;
  }) {
    const existing = await this.prisma.class.findUnique({
      where: { code: data.code },
    });
    if (existing)
      throw new ConflictException(`Mã lớp "${data.code}" đã tồn tại`);
    return this.prisma.class.create({ data });
  }

  updateClass(
    id: string,
    data: {
      name?: string;
      code?: string;
      description?: string;
      academicYearId?: string;
    },
  ) {
    return this.prisma.class.update({ where: { id }, data });
  }

  deleteClass(id: string) {
    return this.prisma.class.delete({ where: { id } });
  }

  // ── Thành viên lớp ──────────────────────────────────────────────────
  async addClassMember(classId: string, userId: string) {
    const existing = await this.prisma.classMember.findUnique({
      where: { classId_userId: { classId, userId } },
    });
    if (existing) throw new ConflictException('Học viên đã có trong lớp');
    return this.prisma.classMember.create({ data: { classId, userId } });
  }

  removeClassMember(classId: string, userId: string) {
    return this.prisma.classMember.delete({
      where: { classId_userId: { classId, userId } },
    });
  }

  async addClassMembersbulk(classId: string, userIds: string[]) {
    const existing = await this.prisma.classMember.findMany({
      where: { classId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((m) => m.userId));
    const newIds = userIds.filter((id) => !existingIds.has(id));
    if (newIds.length === 0) return { added: 0 };
    await this.prisma.classMember.createMany({
      data: newIds.map((userId) => ({ classId, userId })),
    });
    return { added: newIds.length, skipped: existingIds.size };
  }

  // ── Đợt thi ──────────────────────────────────────────────────────────
  getExamSessions(classId?: string) {
    return this.prisma.examSession.findMany({
      where: classId ? { classId } : undefined,
      include: {
        quiz: { select: { id: true, title: true, durationMin: true } },
        class: { select: { id: true, name: true, code: true } },
      },
      orderBy: { startAt: 'desc' },
    });
  }

  async getExamSession(id: string) {
    return this.prisma.examSession.findUniqueOrThrow({
      where: { id },
      include: {
        quiz: {
          select: { id: true, title: true, durationMin: true, passScore: true },
        },
        class: {
          include: {
            members: {
              include: {
                user: { select: { id: true, fullName: true, username: true } },
              },
            },
          },
        },
      },
    });
  }

  createExamSession(data: {
    name: string;
    quizId: string;
    classId: string;
    startAt: string;
    endAt: string;
    maxAttempts?: number;
    scoringPolicy?: string;
    durationMin?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    showResultAfter?: string;
    allowReview?: boolean;
  }) {
    return this.prisma.examSession.create({ data: data as any });
  }

  async updateExamSession(
    id: string,
    data: Partial<{
      name: string;
      startAt: string;
      endAt: string;
      maxAttempts: number;
      scoringPolicy: string;
      durationMin: number;
      shuffleQuestions: boolean;
      shuffleOptions: boolean;
      showResultAfter: string;
      allowReview: boolean;
      status: string;
    }>,
  ) {
    const session = await this.prisma.examSession.update({
      where: { id },
      data: data as any,
      include: {
        quiz: { select: { title: true } },
        class: { select: { members: { select: { userId: true } } } },
      },
    });
    return session;
  }

  deleteExamSession(id: string) {
    return this.prisma.examSession.delete({ where: { id } });
  }

  // ── Phòng ban ────────────────────────────────────────────────────────
  getDepartments() {
    return this.prisma.department.findMany({
      include: {
        parent: { select: { id: true, name: true, code: true } },
        _count: { select: { children: true, canBo: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  /** Chặn parentId trỏ tới chính nó hoặc tới một đơn vị không phải chi nhánh gốc — hệ thống chỉ hỗ trợ 2 cấp */
  private async assertValidParent(parentId: string, selfId?: string) {
    if (parentId === selfId) {
      throw new BadRequestException(
        'Không thể chọn chính đơn vị này làm đơn vị cha',
      );
    }
    const parent = await this.prisma.department.findUnique({
      where: { id: parentId },
    });
    if (!parent) throw new NotFoundException('Không tìm thấy chi nhánh cha');
    if (parent.parentId) {
      throw new BadRequestException(
        'Chỉ được chọn chi nhánh gốc làm đơn vị cha — hệ thống chỉ hỗ trợ 2 cấp',
      );
    }
  }

  async createDepartment(data: {
    name: string;
    code: string;
    parentId?: string | null;
  }) {
    const existing = await this.prisma.department.findUnique({
      where: { code: data.code },
    });
    if (existing) throw new ConflictException(`Mã "${data.code}" đã tồn tại`);

    if (data.parentId) await this.assertValidParent(data.parentId);

    return this.prisma.department.create({
      data: {
        name: data.name,
        code: data.code,
        parentId: data.parentId ?? null,
      },
    });
  }

  async updateDepartment(
    id: string,
    data: { name?: string; code?: string; parentId?: string | null },
  ) {
    if (data.code) {
      const existing = await this.prisma.department.findUnique({
        where: { code: data.code },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Mã "${data.code}" đã tồn tại`);
      }
    }

    if (data.parentId) {
      const current = await this.prisma.department.findUnique({
        where: { id },
        include: { _count: { select: { children: true } } },
      });
      if (current && current._count.children > 0) {
        throw new BadRequestException(
          'Đơn vị này đang có phòng ban trực thuộc — không thể chuyển thành phòng ban con',
        );
      }
      await this.assertValidParent(data.parentId, id);
    }

    return this.prisma.department.update({ where: { id }, data });
  }

  deleteDepartment(id: string) {
    return this.prisma.department.delete({ where: { id } });
  }

  // ── Cán bộ (Quản lý nhân sự) ─────────────────────────────────────────
  async getCanBo(search?: string, departmentId?: string, unitId?: string) {
    let deptIds: string[] | undefined;
    if (unitId) {
      const children = await this.prisma.department.findMany({
        where: { parentId: unitId },
        select: { id: true },
      });
      deptIds = [unitId, ...children.map((c) => c.id)];
    } else if (departmentId) {
      deptIds = [departmentId];
    }

    return this.prisma.canBo.findMany({
      where: {
        ...(deptIds ? { departmentId: { in: deptIds } } : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { cbCode: { contains: search, mode: 'insensitive' } },
                { userAD: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        department: {
          select: {
            id: true,
            name: true,
            code: true,
            parent: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: { cbCode: 'asc' },
    });
  }

  async createCanBo(data: {
    cbCode: string;
    fullName: string;
    username?: string;
    email?: string;
    phoneNumber?: string;
    userAD?: string;
    dangNhapBangAD?: boolean;
    userIPCAS?: string;
    maCbtd?: string;
    cccd?: string;
    ngayCapCmt?: string;
    noiCapCmt?: string;
    ngaySinh?: string;
    gioiTinh?: string;
    departmentId?: string;
    position?: string;
    isPartyMember?: boolean;
    isUnionMember?: boolean;
    isYouthUnionMember?: boolean;
    isItStaff?: boolean;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.canBo.findUnique({
      where: { cbCode: data.cbCode },
    });
    if (existing)
      throw new ConflictException(`Mã CB "${data.cbCode}" đã tồn tại`);
    const { ngaySinh, userAD: rawUserAD, ...rest } = this.pickCanBoFields(data);
    const userAD = this.normalizeUserAD(rawUserAD);
    await this.ensureUserADIsAvailable(userAD);
    return this.prisma.$transaction(async (tx) => {
      const canBo = await tx.canBo.create({
        data: {
          ...rest,
          cbCode: data.cbCode,
          fullName: data.fullName,
          userAD,
          username: this.getLoginUsername(data.cbCode, userAD),
          ngaySinh: ngaySinh ? new Date(ngaySinh) : undefined,
        },
      });
      await this.syncCanBoUser(tx, canBo);
      return tx.canBo.findUniqueOrThrow({
        where: { id: canBo.id },
        include: {
          department: { select: { id: true, name: true, code: true } },
        },
      });
    });
  }

  async updateCanBo(id: string, data: any) {
    const existing = await this.prisma.canBo.findUniqueOrThrow({
      where: { id },
    });
    const { ngaySinh, userAD: rawUserAD, ...rest } = this.pickCanBoFields(data);
    const userAD =
      rawUserAD === undefined
        ? existing.userAD
        : this.normalizeUserAD(rawUserAD);
    await this.ensureUserADIsAvailable(userAD, id);
    return this.prisma.$transaction(async (tx) => {
      const canBo = await tx.canBo.update({
        where: { id },
        data: {
          ...rest,
          userAD,
          username: this.getLoginUsername(
            rest.cbCode ?? existing.cbCode,
            userAD,
          ),
          ngaySinh: ngaySinh ? new Date(ngaySinh) : undefined,
        },
      });
      await this.syncCanBoUser(tx, canBo, existing.cbCode, existing.userAD);
      return tx.canBo.findUniqueOrThrow({
        where: { id },
        include: {
          department: { select: { id: true, name: true, code: true } },
        },
      });
    });
  }

  async deleteCanBo(id: string, actorUserId?: string) {
    const result = await this.prisma.canBo.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { userId: actorUserId, action: 'DELETE_CAN_BO', entityId: id },
    });
    return result;
  }

  async bulkDeleteCanBo(
    ids: string[],
    actorUserId?: string,
  ): Promise<{ deleted: number }> {
    const result = await this.prisma.canBo.deleteMany({
      where: { id: { in: ids } },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'DELETE_CAN_BO_BULK',
        meta: { canBoIds: ids, deleted: result.count },
      },
    });
    return { deleted: result.count };
  }

  async resetCanBoPasswords(
    ids: string[],
    actorUserId?: string,
    tuyChon: {
      mode?: 'random' | 'custom';
      customPassword?: string;
      forceChangeOnLogin?: boolean;
    } = {},
  ) {
    const mode = tuyChon.mode ?? 'random';
    const forceChangeOnLogin = tuyChon.forceChangeOnLogin ?? true;
    if (mode === 'custom') {
      if (!tuyChon.customPassword || tuyChon.customPassword.length < 6) {
        throw new BadRequestException(
          'Mật khẩu tự chọn phải tối thiểu 6 ký tự',
        );
      }
    }

    const canBoList = await this.prisma.canBo.findMany({
      where: { id: { in: ids } },
      select: { id: true, cbCode: true, fullName: true, userAD: true },
    });

    let reset = 0;
    const noAccount: string[] = [];
    let skippedAD = 0;
    const details: {
      fullName: string;
      cbCode: string;
      ok: boolean;
      skippedAD?: boolean;
      newPassword?: string;
    }[] = [];

    for (const cb of canBoList) {
      const user = await this.prisma.user.findUnique({
        where: { username: this.getLoginUsername(cb.cbCode, cb.userAD) },
      });
      if (!user) {
        noAccount.push(cb.fullName);
        details.push({ fullName: cb.fullName, cbCode: cb.cbCode, ok: false });
        continue;
      }
      // Tài khoản AD: mật khẩu nội bộ vô nghĩa (không dùng để đăng nhập) và
      // nguy hiểm — bật mustChangePassword sẽ bắt đổi 1 mật khẩu mà chính
      // người dùng không biết, khoá luôn không vào được nữa. Bỏ qua.
      if (user.authSource === 'AD') {
        skippedAD++;
        details.push({
          fullName: cb.fullName,
          cbCode: cb.cbCode,
          ok: false,
          skippedAD: true,
        });
        continue;
      }

      // 'custom' → cùng 1 mật khẩu admin gõ cho mọi người được chọn; 'random'
      // → MỖI người 1 mật khẩu ngẫu nhiên riêng (không ai đoán được của ai).
      const matKhauMoi =
        mode === 'custom'
          ? tuyChon.customPassword!
          : sinhMatKhauNgauNhienDeDoc();
      const hash = await bcrypt.hash(matKhauMoi, 10);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, mustChangePassword: forceChangeOnLogin },
      });
      reset++;
      details.push({
        fullName: cb.fullName,
        cbCode: cb.cbCode,
        ok: true,
        newPassword: matKhauMoi,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'RESET_CAN_BO_PASSWORDS',
        // KHÔNG log mật khẩu thật vào audit log dù chỉ để tham chiếu — chỉ
        // log chế độ đã dùng, không log giá trị mật khẩu.
        meta: {
          canBoIds: ids,
          reset,
          noAccount: noAccount.length,
          skippedAD,
          mode,
          forceChangeOnLogin,
        },
      },
    });

    return {
      reset,
      noAccount: noAccount.length,
      skippedAD,
      forceChangeOnLogin,
      details,
    };
  }

  // Đọc workbook từ buffer upload.
  // .xlsx (chữ ký ZIP "PK") và .xls (chữ ký OLE) tự mang thông tin encoding nên
  // đọc thẳng từ buffer. Riêng CSV/TXT là văn bản thuần — nếu để thư viện tự
  // đoán, nó rơi về cp1252 và làm hỏng toàn bộ dấu tiếng Việt trong tên cán bộ,
  // nên phải tự giải mã UTF-8 (bỏ BOM nếu có) rồi mới đưa vào XLSX.
  private readWorkbook(buffer: Buffer): XLSX.WorkBook {
    const laXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b;
    const laXls = buffer[0] === 0xd0 && buffer[1] === 0xcf;
    if (laXlsx || laXls) {
      return XLSX.read(buffer, { type: 'buffer', raw: false });
    }
    const noiDung = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return XLSX.read(noiDung, { type: 'string', raw: false });
  }

  // ── Import cán bộ từ file gahr26 (CSV / XLS / XLSX) ──────────────────
  async importCanBoFromGahr26(buffer: Buffer): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
    rows: {
      empno: string;
      fullName: string;
      branchCode?: string;
      branchName?: string;
      deptName?: string;
      position?: string;
      userAD?: string;
      action: 'created' | 'updated' | 'skipped' | 'error';
      note?: string;
    }[];
  }> {
    // Đọc workbook (xlsx lib hỗ trợ cả csv, xls, xlsx)
    const wb = this.readWorkbook(buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRowsOrig: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, {
      defval: null,
      raw: false,
    });

    if (rawRowsOrig.length === 0)
      throw new BadRequestException('File không có dữ liệu');

    // Chuẩn hoá header: trim + uppercase để tránh lỗi khoảng trắng / chữ thường
    const rawRows: Record<string, any>[] = rawRowsOrig.map((r) => {
      const norm: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        norm[k.trim().toUpperCase()] = v;
      }
      return norm;
    });

    // Kiểm tra header bắt buộc
    const required = ['BRCD', 'BRNM', 'EMPNO'];
    const firstRow = rawRows[0];
    for (const col of required) {
      if (!(col in firstRow)) {
        throw new BadRequestException(
          `File thiếu cột bắt buộc: ${col}. File phải có các cột BRCD, BRNM, EMPNO`,
        );
      }
    }

    // Cache phòng ban để giảm DB queries
    const deptCache = new Map<string, string>(); // key = "BRCD::DEPTNM" → departmentId

    const getOrCreateDepartment = async (
      brcd: string,
      brnm: string,
      deptnm?: string | null,
    ): Promise<string> => {
      const branchKey = `branch::${brcd}`;
      // 1. Lấy chi nhánh cấp 1 — luôn quy về 1 trong 7 chi nhánh chuẩn.
      //    BRCD trong file HR (3800, 3802, 3803, 3807…3810) được ánh xạ sang mã
      //    chuẩn (01-HS…07-LTT) để không đẻ thêm chi nhánh cấp 1 trùng lặp sau mỗi lần import.
      const unitCode = AdminService.BRCD_TO_UNIT_CODE[brcd];
      let branchId = deptCache.get(branchKey);
      if (!branchId) {
        // Ưu tiên mã chuẩn → mã trong file → tên chi nhánh, cuối cùng mới tạo mới
        let branch = unitCode
          ? await this.prisma.department.findUnique({
              where: { code: unitCode },
            })
          : null;
        if (!branch) {
          branch = await this.prisma.department.findUnique({
            where: { code: brcd },
          });
        }
        if (!branch) {
          branch = await this.prisma.department.findFirst({
            where: {
              name: { equals: brnm, mode: 'insensitive' },
              parentId: null,
            },
          });
        }
        if (!branch) {
          branch = await this.prisma.department.create({
            data: { code: unitCode ?? brcd, name: brnm },
          });
        } else if (branch.code !== brcd) {
          // Đã tìm thấy theo mã chuẩn / theo tên — cache thêm để tái sử dụng
          deptCache.set(`branch::${branch.code}`, branch.id);
        }
        branchId = branch.id;
        deptCache.set(branchKey, branchId);
      }

      if (!deptnm) return branchId;

      // 2. Lấy phòng ban cấp 2. Tên trong file được phân loại về mã chuẩn
      //    (VD "PGD Kiến Giang" → 02-LT-PGDKG) nên các biến thể chính tả
      //    khác nhau vẫn trỏ về cùng một phòng ban.
      const branchCodeForDept =
        unitCode ??
        (await this.prisma.department.findUnique({
          where: { id: branchId },
          select: { code: true },
        }))!.code;
      const classified = this.classifyDepartment(deptnm);
      const deptCode = classified
        ? `${branchCodeForDept}-${classified.suffix}`
        : `${branchCodeForDept}::${deptnm}`;
      const deptName = classified?.name ?? deptnm;

      let deptId = deptCache.get(deptCode);
      if (!deptId) {
        let dept = await this.prisma.department.findUnique({
          where: { code: deptCode },
        });
        if (!dept) {
          dept = await this.prisma.department.findFirst({
            where: {
              name: { equals: deptnm, mode: 'insensitive' },
              parentId: branchId,
            },
          });
        }
        if (!dept) {
          dept = await this.prisma.department.create({
            data: { code: deptCode, name: deptName, parentId: branchId },
          });
        }
        deptId = dept.id;
        deptCache.set(deptCode, deptId);
      }
      return deptId;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const rows: {
      empno: string;
      fullName: string;
      branchCode?: string;
      branchName?: string;
      deptName?: string;
      position?: string;
      userAD?: string;
      action: 'created' | 'updated' | 'skipped' | 'error';
      note?: string;
    }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const lineNo = i + 2; // +2 vì row 1 là header

      const empno = row['EMPNO']?.toString().trim();
      const brcd = row['BRCD']?.toString().trim();
      const brnm = row['BRNM']?.toString().trim();
      const deptnm = row['DEPTNM']?.toString().trim() || null;
      const position = row['POSITION']?.toString().trim() || null;
      const sex = row['SEX']?.toString().trim() || null;
      const birthdt = row['BIRTHDT']?.toString().trim() || null;
      // Tên nhân viên: thử cột EMPNM, FULLNAME, NAME
      const fullName = (row['EMPNM'] ?? row['FULLNAME'] ?? row['NAME'] ?? '')
        ?.toString()
        .trim();
      // Lưu ý: cột "AD" trong file GAHR26 là hệ số phụ cấp (giá trị 0/1, giống
      // PO/AR/HO/HA/RE/OT/RD/MT), KHÔNG PHẢI username Active Directory. File
      // GAHR26 không bao giờ chứa username AD — AD chỉ nhập tay qua form quản
      // lý cán bộ. Vì vậy import không được đọc cột này, cũng không được ghi đè
      // userAD đã lưu; username lấy theo userAD hiện có, không có thì dùng EMPNO.

      if (!empno) {
        errors.push(`Dòng ${lineNo}: EMPNO trống`);
        skipped++;
        continue;
      }
      if (!brcd || !brnm) {
        errors.push(`Dòng ${lineNo}: BRCD hoặc BRNM trống`);
        skipped++;
        continue;
      }

      // Chuẩn hoá giới tính
      let gioiTinh: string | null = null;
      if (sex) {
        const s = sex.toUpperCase();
        if (s === 'M' || s === 'MALE' || s === 'NAM' || s === '1')
          gioiTinh = 'Nam';
        else if (
          s === 'F' ||
          s === 'FEMALE' ||
          s === 'NU' ||
          s === 'NỮ' ||
          s === '2'
        )
          gioiTinh = 'Nữ';
        else gioiTinh = sex;
      }

      // Parse ngày sinh (format YYYYMMDD hoặc YYYY-MM-DD hoặc DD/MM/YYYY)
      let ngaySinh: Date | null = null;
      if (birthdt) {
        // YYYYMMDD (8 chữ số)
        if (/^\d{8}$/.test(birthdt)) {
          ngaySinh = new Date(
            `${birthdt.slice(0, 4)}-${birthdt.slice(4, 6)}-${birthdt.slice(6, 8)}`,
          );
        } else if (/^\d{4}-\d{2}-\d{2}/.test(birthdt)) {
          ngaySinh = new Date(birthdt);
        } else if (/^\d{2}\/\d{2}\/\d{4}/.test(birthdt)) {
          const [d, m, y] = birthdt.split('/');
          ngaySinh = new Date(`${y}-${m}-${d}`);
        } else {
          ngaySinh = new Date(birthdt);
        }
        if (isNaN(ngaySinh.getTime())) ngaySinh = null;
      }

      try {
        const departmentId = await getOrCreateDepartment(brcd, brnm, deptnm);

        const existing = await this.prisma.canBo.findUnique({
          where: { cbCode: empno },
        });

        const loginUsername = this.getLoginUsername(empno, existing?.userAD);
        const resolvedFullName = fullName || existing?.fullName || empno;
        const data: any = {
          fullName: resolvedFullName,
          departmentId,
          username: loginUsername,
          ...(position !== null ? { position } : {}),
          ...(gioiTinh !== null ? { gioiTinh } : {}),
          ...(ngaySinh !== null ? { ngaySinh } : {}),
        };

        if (existing) {
          await this.prisma.canBo.update({ where: { cbCode: empno }, data });
          updated++;
          rows.push({
            empno,
            fullName: data.fullName,
            branchCode: brcd,
            branchName: brnm,
            deptName: deptnm ?? undefined,
            position: position ?? undefined,
            action: 'updated',
          });
        } else {
          await this.prisma.canBo.create({ data: { cbCode: empno, ...data } });
          created++;
          rows.push({
            empno,
            fullName: data.fullName,
            branchCode: brcd,
            branchName: brnm,
            deptName: deptnm ?? undefined,
            position: position ?? undefined,
            action: 'created',
          });
        }

        // Tạo / cập nhật User tương ứng (username = EMPNO, mk mặc định Abcd@1234)
        const existingUser = await this.prisma.user.findFirst({
          where: { username: loginUsername },
        });
        if (!existingUser) {
          const passwordHash = await bcrypt.hash('Abcd@1234', 10);
          await this.prisma.user.create({
            data: {
              username: loginUsername,
              fullName: resolvedFullName,
              passwordHash,
              role: 'STAFF',
              isActive: true,
              mustChangePassword: true,
              departmentId,
            },
          });
        } else {
          // Cập nhật fullName và department nếu thay đổi
          await this.prisma.user.update({
            where: { id: existingUser.id },
            data: { fullName: resolvedFullName, departmentId },
          });
        }
      } catch (err: any) {
        errors.push(`Dòng ${lineNo} (${empno}): ${err.message}`);
        rows.push({
          empno: empno ?? `dòng ${lineNo}`,
          fullName: '',
          action: 'error',
          note: err.message,
        });
      }
    }

    return { created, updated, skipped, errors, rows };
  }

  async getExamSessionGradebook(sessionId: string) {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        class: {
          include: {
            members: {
              include: {
                user: { select: { id: true, fullName: true, username: true } },
              },
            },
          },
        },
        quiz: { select: { id: true, passScore: true } },
      },
    });

    const submissions = await this.prisma.submission.findMany({
      where: {
        quizId: session.quizId,
        user: { classMembers: { some: { classId: session.classId } } },
      },
      select: {
        userId: true,
        score: true,
        isPassed: true,
        submittedAt: true,
        status: true,
      },
      orderBy: { submittedAt: 'asc' },
    });

    // Gom nhóm theo userId
    const byUser: Record<string, typeof submissions> = {};
    for (const s of submissions) {
      if (!byUser[s.userId]) byUser[s.userId] = [];
      byUser[s.userId].push(s);
    }

    return session.class.members.map(({ user }) => {
      const attempts = byUser[user.id] ?? [];
      const scores = attempts.map((a) => a.score ?? 0);
      let finalScore: number | null = null;
      if (scores.length > 0) {
        switch (session.scoringPolicy) {
          case 'FIRST':
            finalScore = scores[0];
            break;
          case 'LAST':
            finalScore = scores[scores.length - 1];
            break;
          case 'HIGHEST':
            finalScore = Math.max(...scores);
            break;
          case 'AVERAGE':
            finalScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            break;
          default:
            finalScore = Math.max(...scores);
        }
      }
      return {
        user,
        attempts: attempts.length,
        finalScore,
        isPassed:
          finalScore !== null
            ? finalScore >= (session.quiz.passScore ?? 0)
            : null,
        lastSubmittedAt: attempts[attempts.length - 1]?.submittedAt ?? null,
      };
    });
  }

  // ── Bảng xếp hạng ────────────────────────────────────────────────────
  async getExamSessionLeaderboard(sessionId: string) {
    const gradebook = await this.getExamSessionGradebook(sessionId);
    return gradebook
      .filter((g) => g.finalScore !== null)
      .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
      .map((g, idx) => ({ rank: idx + 1, ...g }));
  }

  // ── Lịch sử làm bài ──────────────────────────────────────────────────
  async getAttemptHistory(sessionId: string, userId: string) {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { quizId: true, scoringPolicy: true },
    });

    const submissions = await this.prisma.submission.findMany({
      where: { quizId: session.quizId, userId },
      select: {
        id: true,
        score: true,
        isPassed: true,
        submittedAt: true,
        status: true,
        answers: {
          select: {
            id: true,
            questionId: true,
            selectedOptionIds: true,
            answeredAt: true,
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });

    return submissions.map((s, idx) => ({ attempt: idx + 1, ...s }));
  }

  // ── Xuất bảng điểm ra Excel ─────────────────────────────────────────
  async exportGradebook(
    sessionId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { name: true },
    });

    const gradebook = await this.getExamSessionGradebook(sessionId);
    const sorted = [...gradebook].sort(
      (a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1),
    );

    const wb = XLSX.utils.book_new();

    // Sheet 1 — Bảng điểm đầy đủ
    const rows = sorted.map((g, idx) => ({
      STT: idx + 1,
      'Họ tên': g.user.fullName,
      Username: g.user.username,
      'Số lần thi': g.attempts,
      Điểm: g.finalScore !== null ? +g.finalScore.toFixed(2) : '',
      'Kết quả':
        g.isPassed === null ? 'Chưa thi' : g.isPassed ? 'Đạt' : 'Chưa đạt',
      'Lần cuối nộp': g.lastSubmittedAt
        ? new Date(g.lastSubmittedAt).toLocaleString('vi-VN')
        : '',
    }));
    const ws1 = XLSX.utils.json_to_sheet(rows);
    ws1['!cols'] = [
      { wch: 5 },
      { wch: 30 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Bảng điểm');

    // Sheet 2 — Chưa làm
    const notDone = sorted
      .filter((g) => g.attempts === 0)
      .map((g, idx) => ({
        STT: idx + 1,
        'Họ tên': g.user.fullName,
        Username: g.user.username,
      }));
    if (notDone.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(notDone);
      ws2['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Chưa làm');
    }

    const excelBuffer = XLSX.write(wb, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;
    const safeName = session.name
      .replace(/[^a-zA-Z0-9À-ỹ\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    return { buffer: excelBuffer, filename: `BangDiem_${safeName}.xlsx` };
  }

  // ── Phân tích câu hỏi ───────────────────────────────────────────────
  async getQuestionStats(sessionId: string) {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { quizId: true, classId: true },
    });

    const [questions, members] = await Promise.all([
      this.prisma.question.findMany({
        where: { quizId: session.quizId },
        include: { options: { orderBy: { orderIndex: 'asc' } } },
        orderBy: { orderIndex: 'asc' },
      }),
      this.prisma.classMember.findMany({
        where: { classId: session.classId },
        select: { userId: true },
      }),
    ]);

    const memberIds = members.map((m) => m.userId);
    const submissions = await this.prisma.submission.findMany({
      where: { quizId: session.quizId, userId: { in: memberIds } },
      select: {
        answers: { select: { questionId: true, selectedOptionIds: true } },
      },
    });

    const questionOpts = new Map(questions.map((q) => [q.id, q.options]));
    const stats = new Map(
      questions.map((q) => [q.id, { correct: 0, total: 0 }]),
    );

    for (const sub of submissions) {
      for (const ans of sub.answers) {
        const s = stats.get(ans.questionId);
        if (!s) continue;
        s.total++;
        const selected = ans.selectedOptionIds as string[];
        const correctIds = (questionOpts.get(ans.questionId) ?? [])
          .filter((o) => o.isCorrect)
          .map((o) => o.id);
        const isCorrect =
          selected.length === correctIds.length &&
          correctIds.every((id) => selected.includes(id));
        if (isCorrect) s.correct++;
      }
    }

    return questions.map((q, idx) => {
      const s = stats.get(q.id)!;
      return {
        index: idx + 1,
        id: q.id,
        content: q.content,
        questionType: q.questionType,
        options: questionOpts.get(q.id) ?? [],
        totalAttempts: s.total,
        correctCount: s.correct,
        wrongCount: s.total - s.correct,
        correctRate:
          s.total > 0 ? Math.round((s.correct / s.total) * 100) : null,
      };
    });
  }

  // ── Chưa làm ─────────────────────────────────────────────────────────
  async getNotAttempted(sessionId: string) {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { quizId: true, classId: true },
    });

    const members = await this.prisma.classMember.findMany({
      where: { classId: session.classId },
      include: {
        user: {
          select: { id: true, fullName: true, username: true, email: true },
        },
      },
    });

    const attempted = await this.prisma.submission.findMany({
      where: {
        quizId: session.quizId,
        userId: { in: members.map((m) => m.userId) },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    const attemptedIds = new Set(attempted.map((s) => s.userId));
    return members
      .filter((m) => !attemptedIds.has(m.userId))
      .map((m) => m.user);
  }

  // ── Dữ liệu chứng nhận ──────────────────────────────────────────────
  async getCertificateData(sessionId: string, userId: string) {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        quiz: { select: { title: true, passScore: true } },
        class: { select: { name: true } },
      },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, username: true },
    });

    const best = await this.prisma.submission.findFirst({
      where: { quizId: session.quizId, userId, isPassed: true },
      orderBy: { score: 'desc' },
    });

    if (!best) {
      throw new NotFoundException(
        'Học viên chưa đạt kết quả để cấp chứng nhận',
      );
    }

    return {
      studentName: user.fullName,
      username: user.username,
      quizTitle: session.quiz?.title ?? '',
      sessionName: session.name,
      className: session.class?.name ?? '',
      score: best.score,
      passScore: session.quiz?.passScore ?? 70,
      submittedAt: best.submittedAt,
      issuedAt: new Date().toISOString(),
    };
  }
}
