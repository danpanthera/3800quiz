import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AttemptStatus,
  AttemptViolationType,
  Prisma,
  XpSource,
} from '@prisma/client';
import { AssignmentsService } from '../assignments/assignments.service';
import { GamificationService } from '../gamification/gamification.service';
import { PrismaService } from '../prisma/prisma.service';
import { LockAttemptAnswerDto } from './dto/lock-attempt-answer.dto';
import { SaveAttemptAnswersDto } from './dto/save-attempt-answers.dto';
import { StartAttemptDto } from './dto/start-attempt.dto';

interface SnapshotOption {
  id: string;
  content: string;
  isCorrect: boolean;
  orderIndex: number;
}

interface SnapshotQuestion {
  id: string;
  content: string;
  imageUrl?: string | null;
  explanation?: string | null;
  questionType: string;
  orderIndex: number;
  points: number;
  options: SnapshotOption[];
  // Optional vì snapshot cũ (tạo trước khi có tính năng hiển thị lĩnh vực) không
  // có 2 field này — dùng 'subjectName' in question để phân biệt "thiếu key" (cần
  // tra cứu bổ sung) với "có key nhưng null" (câu chưa phân loại lĩnh vực).
  subjectId?: string | null;
  subjectName?: string | null;
}

interface QuizSnapshot {
  quiz: {
    id: string;
    title: string;
    description: string | null;
    topic: string | null;
    durationMin: number;
    passScore: number | null;
  };
  questions: SnapshotQuestion[];
}

type StoredAttempt = {
  id: string;
  assignmentId: string;
  quizId: string;
  quizVersionId: string;
  status: AttemptStatus;
  startedAt: Date;
  deadlineAt: Date;
  lastSavedAt: Date | null;
  answerRevision: number;
  finalizedAt: Date | null;
  timedOut: boolean;
};

const EXPIRY_SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class AttemptsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttemptsService.name);
  private expiryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentsService: AssignmentsService,
    private readonly gamification: GamificationService,
  ) {}

  onModuleInit() {
    this.expiryTimer = setInterval(() => {
      void this.finalizeExpiredAttempts();
    }, EXPIRY_SWEEP_INTERVAL_MS);
    this.expiryTimer.unref();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  async start(userId: string, dto: StartAttemptDto) {
    const existingById = await this.prisma.quizAttempt.findUnique({
      where: { id: dto.id },
    });
    if (existingById) {
      if (existingById.userId !== userId) {
        throw new ForbiddenException('Attempt này không thuộc về bạn');
      }
      return this.get(userId, dto.id);
    }

    const assignments = await this.assignmentsService.getForUser(userId);
    const assignment = assignments.find((item) => item.id === dto.assignmentId);
    if (!assignment) {
      throw new ForbiddenException('Bạn không được phân công bài kiểm tra này');
    }

    const activeAttempt = await this.prisma.quizAttempt.findFirst({
      where: {
        userId,
        assignmentId: assignment.id,
        status: AttemptStatus.IN_PROGRESS,
      },
    });
    if (activeAttempt) return this.get(userId, activeAttempt.id);

    // 0 = không giới hạn (quy ước giống ExamSession.maxAttempts). Chỉ đếm attempt
    // đã GRADED — đang làm dở đã được xử lý ở nhánh activeAttempt phía trên.
    const maxAttempts = assignment.quiz?.maxAttempts ?? 1;
    if (maxAttempts !== 0) {
      const gradedCount = await this.prisma.quizAttempt.count({
        where: {
          userId,
          assignmentId: assignment.id,
          status: AttemptStatus.GRADED,
        },
      });
      if (gradedCount >= maxAttempts) {
        throw new ForbiddenException(
          `Bạn đã dùng hết số lần làm bài cho phép (tối đa ${maxAttempts} lần)`,
        );
      }
    }

    const { version, snapshot: rawSnapshot } = await this.ensureSnapshot(
      assignment.quizId,
    );
    const snapshot = await this.withSubjectNames(rawSnapshot);
    const startedAt = new Date();
    const durationDeadline = new Date(
      startedAt.getTime() + snapshot.quiz.durationMin * 60 * 1000,
    );
    const assignmentDeadline = assignment.endAt
      ? new Date(assignment.endAt)
      : undefined;
    const deadlineAt =
      assignmentDeadline && assignmentDeadline < durationDeadline
        ? assignmentDeadline
        : durationDeadline;

    if (deadlineAt <= startedAt) {
      throw new GoneException('Thời gian làm bài đã kết thúc');
    }

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        id: dto.id,
        userId,
        assignmentId: assignment.id,
        quizId: assignment.quizId,
        quizVersionId: version.id,
        startedAt,
        deadlineAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'START_ATTEMPT',
        entityId: attempt.id,
        meta: {
          assignmentId: assignment.id,
          deadlineAt: deadlineAt.toISOString(),
        },
      },
    });

    // Cờ instantFeedback phải kèm ngay từ payload lúc bắt đầu, không chỉ ở get() —
    // thiếu nó thì client luôn nhận false và rơi nhầm vào giao diện thi thường.
    return this.toAttemptPayload(
      attempt,
      snapshot,
      [],
      Boolean(assignment.quiz?.instantFeedback),
    );
  }

  async get(userId: string, id: string) {
    const attempt = await this.findAttempt(userId, id);
    if (
      attempt.status === AttemptStatus.IN_PROGRESS &&
      attempt.deadlineAt <= new Date()
    ) {
      await this.finalize(userId, id, true);
      return this.get(userId, id);
    }

    const snapshot = await this.withSubjectNames(
      this.readSnapshot(attempt.quizVersion.snapshot),
    );
    return this.toAttemptPayload(
      attempt,
      snapshot,
      attempt.answers,
      attempt.quizVersion.quiz.instantFeedback,
    );
  }

  // Chốt đáp án 1 câu ở chế độ phản hồi tức thì (kiểu Quizizz).
  // Chấm ngay câu đó, khoá lại không cho sửa, rồi trả kết quả + đáp án đúng về
  // cho client hiển thị hiệu ứng. Chỉ hoạt động khi bộ đề bật instantFeedback —
  // nếu không, đây sẽ là kẽ hở lộ đáp án của kỳ thi chính thức.
  async lockAnswer(
    userId: string,
    id: string,
    questionId: string,
    dto: LockAttemptAnswerDto,
  ) {
    const attempt = await this.findAttempt(userId, id);
    if (!attempt.quizVersion.quiz.instantFeedback) {
      throw new ForbiddenException(
        'Bộ đề này không bật chế độ phản hồi tức thì',
      );
    }
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Bài kiểm tra đã được chấm');
    }
    if (attempt.deadlineAt <= new Date()) {
      await this.finalize(userId, id, true);
      throw new GoneException(
        'Đã hết thời gian làm bài; hệ thống đã chấm bản lưu gần nhất',
      );
    }

    const snapshot = this.readSnapshot(attempt.quizVersion.snapshot);
    const question = snapshot.questions.find((item) => item.id === questionId);
    if (!question) {
      throw new BadRequestException('Câu hỏi không thuộc bộ đề này');
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (dto.selectedOptionIds.some((optionId) => !optionIds.has(optionId))) {
      throw new BadRequestException('Đáp án không thuộc câu hỏi này');
    }

    const existing = attempt.answers.find(
      (answer) => answer.questionId === questionId,
    );
    // Đã chốt rồi thì trả lại đúng kết quả cũ thay vì báo lỗi — để client bị mất
    // mạng giữa chừng gửi lại vẫn nhận được phản hồi (idempotent).
    if (existing?.lockedAt) {
      return {
        questionId,
        alreadyLocked: true,
        selectedOptionIds: this.toSelectedOptionIds(existing.selectedOptionIds),
        isCorrect: existing.isCorrect ?? false,
        correctOptionIds: this.gradeQuestion(question, []).correctOptionIds,
        explanation: question.explanation ?? null,
        points: question.points,
        answerRevision: attempt.answerRevision,
      };
    }

    const { isCorrect, correctOptionIds } = this.gradeQuestion(
      question,
      dto.selectedOptionIds,
    );
    const lockedAt = new Date();

    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.quizAttemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
        create: {
          attemptId: attempt.id,
          questionId,
          selectedOptionIds: dto.selectedOptionIds,
          lockedAt,
          isCorrect,
        },
        update: {
          selectedOptionIds: dto.selectedOptionIds,
          lockedAt,
          isCorrect,
        },
      });
      return transaction.quizAttempt.update({
        where: { id: attempt.id },
        data: { answerRevision: { increment: 1 }, lastSavedAt: lockedAt },
        select: { answerRevision: true },
      });
    });

    return {
      questionId,
      alreadyLocked: false,
      selectedOptionIds: dto.selectedOptionIds,
      isCorrect,
      correctOptionIds,
      explanation: question.explanation ?? null,
      points: question.points,
      answerRevision: updated.answerRevision,
    };
  }

  async saveAnswers(userId: string, id: string, dto: SaveAttemptAnswersDto) {
    const attempt = await this.findAttempt(userId, id);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Bài kiểm tra đã được chấm');
    }
    if (attempt.deadlineAt <= new Date()) {
      await this.finalize(userId, id, true);
      throw new GoneException(
        'Đã hết thời gian làm bài; hệ thống đã chấm bản lưu gần nhất',
      );
    }
    if (dto.revision !== attempt.answerRevision) {
      throw new ConflictException({
        message: 'Dữ liệu cục bộ đã cũ; vui lòng tải lại bài kiểm tra',
        answerRevision: attempt.answerRevision,
      });
    }

    const snapshot = this.readSnapshot(attempt.quizVersion.snapshot);
    this.validateAnswers(snapshot, dto);

    // Câu đã chốt ở chế độ phản hồi tức thì là bất biến — bỏ qua mọi yêu cầu ghi
    // đè, tránh việc client đã biết đáp án đúng rồi quay lại sửa cho thành đúng.
    const lockedQuestionIds = new Set(
      attempt.answers
        .filter((answer) => answer.lockedAt)
        .map((answer) => answer.questionId),
    );
    const answersToWrite = dto.answers.filter(
      (answer) => !lockedQuestionIds.has(answer.questionId),
    );

    // Mốc "checkpoint" để tính answeredMs — thời điểm lưu tự động GẦN NHẤT
    // trước lượt này, hoặc lúc bắt đầu làm bài nếu đây là lượt lưu đầu tiên.
    // Dùng đúng đồng hồ SERVER, không tin lastSavedAt/thời gian phía client.
    const previousCheckpoint = attempt.lastSavedAt ?? attempt.startedAt;
    const existingAnswerByQuestionId = new Map(
      attempt.answers.map((answer) => [answer.questionId, answer]),
    );

    const lastSavedAt = new Date();
    const elapsedSincePrevious = Math.max(
      0,
      lastSavedAt.getTime() - previousCheckpoint.getTime(),
    );
    const saveResult = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.quizAttempt.updateMany({
        where: {
          id: attempt.id,
          userId,
          status: AttemptStatus.IN_PROGRESS,
          answerRevision: dto.revision,
          deadlineAt: { gt: lastSavedAt },
        },
        data: {
          answerRevision: { increment: 1 },
          lastSavedAt,
        },
      });

      if (updated.count === 0) {
        const current = await transaction.quizAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
          select: { status: true, deadlineAt: true, answerRevision: true },
        });
        return { saved: false as const, current };
      }

      await Promise.all(
        answersToWrite.map((answer) => {
          const existing = existingAnswerByQuestionId.get(answer.questionId);
          const wasEmpty =
            !existing ||
            this.toSelectedOptionIds(existing.selectedOptionIds).length === 0;
          const isFirstAnswer = wasEmpty && answer.selectedOptionIds.length > 0;

          return transaction.quizAttemptAnswer.upsert({
            where: {
              attemptId_questionId: {
                attemptId: attempt.id,
                questionId: answer.questionId,
              },
            },
            create: {
              attemptId: attempt.id,
              questionId: answer.questionId,
              selectedOptionIds: answer.selectedOptionIds,
              ...(isFirstAnswer ? { answeredMs: elapsedSincePrevious } : {}),
            },
            update: {
              selectedOptionIds: answer.selectedOptionIds,
              ...(isFirstAnswer ? { answeredMs: elapsedSincePrevious } : {}),
            },
          });
        }),
      );

      const savedAttempt = await transaction.quizAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        select: { answerRevision: true, lastSavedAt: true },
      });
      return { saved: true as const, attempt: savedAttempt };
    });

    if (saveResult.saved) return saveResult.attempt;

    if (saveResult.current.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Bài kiểm tra đã được chấm');
    }
    if (saveResult.current.deadlineAt <= lastSavedAt) {
      await this.finalize(userId, id, true);
      throw new GoneException(
        'Đã hết thời gian làm bài; hệ thống đã chấm bản lưu gần nhất',
      );
    }
    throw new ConflictException({
      message: 'Dữ liệu cục bộ đã cũ; vui lòng tải lại bài kiểm tra',
      answerRevision: saveResult.current.answerRevision,
    });
  }

  // Ghi nhận hành vi nghi vấn (rời màn hình, thoát fullscreen, cố sao chép đề) khi
  // đang làm bài — chỉ ghi log + tăng bộ đếm, KHÔNG tự động chấm rớt (tránh oan nếu
  // người dùng vô tình alt-tab). Admin xem lại violationCount khi cần đối chiếu.
  async reportViolation(
    userId: string,
    id: string,
    type: AttemptViolationType,
  ) {
    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id, userId },
    });
    if (!attempt)
      throw new NotFoundException('Không tìm thấy bài kiểm tra đang làm');
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      return { violationCount: attempt.violationCount };
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.attemptViolation.create({ data: { attemptId: id, type } }),
      this.prisma.quizAttempt.update({
        where: { id },
        data: { violationCount: { increment: 1 } },
      }),
    ]);

    return { violationCount: updated.violationCount };
  }

  async finalize(userId: string, id: string, timedOut: boolean) {
    const attempt = await this.findAttempt(userId, id);
    if (attempt.status === AttemptStatus.GRADED) {
      return this.getFinalResult(userId, attempt.submissionId ?? attempt.id);
    }

    const snapshot = this.readSnapshot(attempt.quizVersion.snapshot);
    const { score, isPassed } = this.scoreAttempt(snapshot, attempt.answers);
    const submittedAt = new Date();

    const existingSubmission = await this.prisma.submission.findUnique({
      where: { id: attempt.id },
    });
    if (existingSubmission) {
      await this.prisma.quizAttempt.update({
        where: { id: attempt.id },
        data: {
          submissionId: existingSubmission.id,
          status: AttemptStatus.GRADED,
          finalizedAt: submittedAt,
          timedOut: timedOut || attempt.timedOut,
        },
      });
      return this.getFinalResult(userId, existingSubmission.id);
    }

    const submission = await this.prisma.submission.create({
      data: {
        id: attempt.id,
        userId,
        quizId: attempt.quizId,
        quizVersionId: attempt.quizVersionId,
        status: 'GRADED',
        score,
        isPassed,
        startedAt: attempt.startedAt,
        submittedAt,
        syncedAt: submittedAt,
        answers: {
          create: attempt.answers.map((answer) => ({
            questionId: answer.questionId,
            selectedOptionIds: this.toSelectedOptionIds(
              answer.selectedOptionIds,
            ),
            answeredAt: answer.updatedAt,
          })),
        },
      },
    });

    await this.prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        submissionId: submission.id,
        status: AttemptStatus.GRADED,
        finalizedAt: submittedAt,
        timedOut: timedOut || attempt.timedOut,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'FINALIZE_ATTEMPT',
        entityId: attempt.id,
        meta: { timedOut },
      },
    });

    // Chỉ cộng XP ở lần nộp bài ĐẦU TIÊN của lượt giao bài — làm lại (khi bộ đề
    // cho phép thi lại nhiều lần) vẫn được chấm điểm/lưu kết quả bình thường,
    // nhưng không cộng thêm XP để tránh cày điểm ảo bằng cách bấm làm lại.
    const priorGradedCount = await this.prisma.quizAttempt.count({
      where: {
        userId,
        assignmentId: attempt.assignmentId,
        status: AttemptStatus.GRADED,
        id: { not: attempt.id },
      },
    });
    const xpResult =
      priorGradedCount === 0
        ? await this.awardSubmissionXp(userId, isPassed, score, submission.id)
        : { levelUp: false, newLevel: 0, newBadges: [] };
    return {
      id: submission.id,
      status: submission.status,
      score: submission.score,
      isPassed,
      timedOut: timedOut || attempt.timedOut,
      levelUp: xpResult.levelUp,
      newLevel: xpResult.newLevel,
      newBadges: xpResult.newBadges,
    };
  }

  async finalizeExpiredAttempts() {
    try {
      const expiredAttempts = await this.prisma.quizAttempt.findMany({
        where: {
          status: AttemptStatus.IN_PROGRESS,
          deadlineAt: { lte: new Date() },
        },
        select: { id: true, userId: true },
      });
      for (const attempt of expiredAttempts) {
        await this.finalize(attempt.userId, attempt.id, true);
      }
    } catch (error) {
      this.logger.error('Không thể chấm attempt quá hạn', error);
    }
  }

  private async findAttempt(userId: string, id: string) {
    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id, userId },
      include: {
        answers: { orderBy: { updatedAt: 'asc' } },
        quizVersion: {
          select: {
            snapshot: true,
            quiz: { select: { instantFeedback: true } },
          },
        },
      },
    });
    if (!attempt)
      throw new NotFoundException('Không tìm thấy bài kiểm tra đang làm');
    return attempt;
  }

  private async ensureSnapshot(quizId: string) {
    const latestVersion = await this.prisma.quizVersion.findFirst({
      where: { quizId },
      orderBy: { version: 'desc' },
    });
    if (latestVersion && this.isSnapshot(latestVersion.snapshot)) {
      return { version: latestVersion, snapshot: latestVersion.snapshot };
    }

    const [quiz, questions] = await Promise.all([
      this.prisma.quiz.findUniqueOrThrow({ where: { id: quizId } }),
      this.prisma.question.findMany({
        where: { quizId },
        orderBy: { orderIndex: 'asc' },
        include: {
          options: { orderBy: { orderIndex: 'asc' } },
          subject: { select: { id: true, name: true } },
        },
      }),
    ]);
    const snapshot: QuizSnapshot = {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        topic: quiz.topic,
        durationMin: quiz.durationMin,
        passScore: quiz.passScore,
      },
      questions: questions.map((question) => ({
        id: question.id,
        content: question.content,
        imageUrl: question.imageUrl,
        explanation: question.explanation,
        questionType: question.questionType,
        orderIndex: question.orderIndex,
        points: question.points,
        subjectId: question.subjectId,
        subjectName: question.subject?.name ?? null,
        options: question.options.map((option) => ({
          id: option.id,
          content: option.content,
          isCorrect: option.isCorrect,
          orderIndex: option.orderIndex,
        })),
      })),
    };
    const version = await this.prisma.quizVersion.create({
      data: {
        quizId,
        version: (latestVersion?.version ?? 0) + 1,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    return { version, snapshot };
  }

  // Bổ sung lĩnh vực cho snapshot CŨ (tạo trước khi tính năng này ra đời) bằng
  // cách tra lại bảng Question theo id — KHÔNG ghi đè QuizVersion, vì version đã
  // chốt phải bất biến (tránh lệch đề với bài đã nộp). Snapshot mới luôn có sẵn
  // 2 field này (kể cả giá trị null khi câu chưa phân loại) nên không tốn query.
  private async withSubjectNames(
    snapshot: QuizSnapshot,
  ): Promise<QuizSnapshot> {
    const missing = snapshot.questions.filter(
      (question) => !('subjectName' in question),
    );
    if (missing.length === 0) return snapshot;

    const rows = await this.prisma.question.findMany({
      where: { id: { in: missing.map((question) => question.id) } },
      select: {
        id: true,
        subjectId: true,
        subject: { select: { name: true } },
      },
    });
    const bySubject = new Map(rows.map((row) => [row.id, row]));

    return {
      ...snapshot,
      questions: snapshot.questions.map((question) => {
        if ('subjectName' in question) return question;
        const found = bySubject.get(question.id);
        return {
          ...question,
          subjectId: found?.subjectId ?? null,
          subjectName: found?.subject?.name ?? null,
        };
      }),
    };
  }

  private readSnapshot(value: unknown): QuizSnapshot {
    if (!this.isSnapshot(value)) {
      throw new BadRequestException(
        'Bộ đề chưa có phiên bản hợp lệ để làm bài',
      );
    }
    return value;
  }

  private isSnapshot(value: unknown): value is QuizSnapshot {
    if (!value || typeof value !== 'object') return false;
    const snapshot = value as Partial<QuizSnapshot>;
    return Boolean(
      snapshot.quiz &&
      typeof snapshot.quiz.id === 'string' &&
      typeof snapshot.quiz.durationMin === 'number' &&
      Array.isArray(snapshot.questions),
    );
  }

  private toAttemptPayload(
    attempt: StoredAttempt,
    snapshot: QuizSnapshot,
    answers: Array<{
      questionId: string;
      selectedOptionIds: Prisma.JsonValue;
      lockedAt?: Date | null;
      isCorrect?: boolean | null;
    }>,
    instantFeedback = false,
  ) {
    const questionsById = new Map(
      snapshot.questions.map((question) => [question.id, question]),
    );
    return {
      attempt: {
        id: attempt.id,
        assignmentId: attempt.assignmentId,
        quizId: attempt.quizId,
        quizVersionId: attempt.quizVersionId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        lastSavedAt: attempt.lastSavedAt,
        answerRevision: attempt.answerRevision,
        finalizedAt: attempt.finalizedAt,
        timedOut: attempt.timedOut,
      },
      quiz: {
        ...snapshot.quiz,
        instantFeedback,
        questions: snapshot.questions.map((question) => ({
          id: question.id,
          content: question.content,
          imageUrl: question.imageUrl ?? null,
          questionType: question.questionType,
          orderIndex: question.orderIndex,
          points: question.points,
          subjectName: question.subjectName ?? null,
          // ORDERING: xáo vị trí hiển thị (ổn định theo attempt+câu hỏi, không lộ thứ tự đúng
          // vốn được mã hoá qua orderIndex của option). SINGLE/MULTIPLE: giữ nguyên thứ tự đã cấu hình.
          options: (question.questionType === 'ORDERING'
            ? this.stableShuffle(question.options, attempt.id + question.id)
            : question.options
          ).map((option) => ({
            id: option.id,
            content: option.content,
            orderIndex: option.orderIndex,
          })),
        })),
      },
      // Chỉ câu đã chốt mới kèm đáp án đúng + lời giải; câu chưa trả lời vẫn giữ
      // kín hoàn toàn để không lộ đề qua tab Network.
      answers: answers.map((answer) => {
        const locked = Boolean(answer.lockedAt);
        const question = questionsById.get(answer.questionId);
        return {
          questionId: answer.questionId,
          selectedOptionIds: answer.selectedOptionIds,
          lockedAt: answer.lockedAt ?? null,
          isCorrect: locked ? (answer.isCorrect ?? null) : null,
          correctOptionIds:
            locked && question
              ? this.gradeQuestion(question, []).correctOptionIds
              : null,
          explanation: locked ? (question?.explanation ?? null) : null,
        };
      }),
    };
  }

  private validateAnswers(snapshot: QuizSnapshot, dto: SaveAttemptAnswersDto) {
    const questions = new Map(
      snapshot.questions.map((question) => [question.id, question]),
    );
    for (const answer of dto.answers) {
      const question = questions.get(answer.questionId);
      if (!question)
        throw new BadRequestException('Câu trả lời không thuộc bộ đề này');
      const optionIds = new Set(question.options.map((option) => option.id));
      if (
        answer.selectedOptionIds.some((optionId) => !optionIds.has(optionId))
      ) {
        throw new BadRequestException('Phương án trả lời không hợp lệ');
      }
      if (
        question.questionType === 'SINGLE' &&
        answer.selectedOptionIds.length > 1
      ) {
        throw new BadRequestException(
          'Câu hỏi một đáp án chỉ được chọn một phương án',
        );
      }
      if (
        question.questionType === 'ORDERING' &&
        answer.selectedOptionIds.length > 0 &&
        answer.selectedOptionIds.length !== question.options.length
      ) {
        throw new BadRequestException(
          'Câu hỏi sắp xếp phải sắp xếp đủ tất cả các mục',
        );
      }
    }
  }

  // Sắp xếp ổn định theo hash(seed) — cùng seed luôn ra cùng thứ tự (không cần lưu
  // riêng vào DB), khác attempt/câu hỏi thì khác nhau nên không đoán trước được.
  private stableShuffle<T extends { id: string }>(
    items: T[],
    seed: string,
  ): T[] {
    return items
      .map((item) => ({ item, key: this.hashString(seed + item.id) }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.item);
  }

  private hashString(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) | 0;
    }
    return hash;
  }

  // Chấm riêng 1 câu. Trả kèm đáp án đúng để chế độ phản hồi tức thì hiển thị
  // được câu trả lời đúng khi người làm chọn sai.
  private gradeQuestion(
    question: SnapshotQuestion,
    selectedOptionIds: string[],
  ): { isCorrect: boolean; correctOptionIds: string[] } {
    if (question.questionType === 'ORDERING') {
      // Đúng thứ tự = orderIndex tăng dần chính là thứ tự đúng do người soạn đề định nghĩa.
      const correctOrder = question.options
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((option) => option.id);
      return {
        isCorrect:
          JSON.stringify(correctOrder) === JSON.stringify(selectedOptionIds),
        correctOptionIds: correctOrder,
      };
    }

    const correctOptionIds = question.options
      .filter((option) => option.isCorrect)
      .map((option) => option.id)
      .sort();
    return {
      isCorrect:
        JSON.stringify(correctOptionIds) ===
        JSON.stringify([...selectedOptionIds].sort()),
      correctOptionIds,
    };
  }

  private scoreAttempt(
    snapshot: QuizSnapshot,
    answers: Array<{ questionId: string; selectedOptionIds: Prisma.JsonValue }>,
  ) {
    // KHÔNG sort ở đây — câu ORDERING cần giữ nguyên thứ tự đã trả lời để so khớp.
    const answersByQuestion = new Map(
      answers.map((answer) => [
        answer.questionId,
        this.toSelectedOptionIds(answer.selectedOptionIds),
      ]),
    );
    let totalPoints = 0;
    let earnedPoints = 0;

    for (const question of snapshot.questions) {
      totalPoints += question.points;
      const selectedOptionIds = answersByQuestion.get(question.id) ?? [];
      if (this.gradeQuestion(question, selectedOptionIds).isCorrect) {
        earnedPoints += question.points;
      }
    }

    const score = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
    return {
      score,
      isPassed: score >= (snapshot.quiz.passScore ?? 60),
    };
  }

  private toSelectedOptionIds(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  }

  private async getFinalResult(userId: string, submissionId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, userId },
      select: {
        id: true,
        status: true,
        score: true,
        isPassed: true,
        submittedAt: true,
      },
    });
    if (!submission)
      throw new NotFoundException('Không tìm thấy kết quả bài kiểm tra');
    return submission;
  }

  private async awardSubmissionXp(
    userId: string,
    isPassed: boolean,
    score: number,
    submissionId: string,
  ) {
    await this.gamification.updateActivity(userId);
    await this.gamification.incrementSubmissionStats(userId, isPassed);
    if (score === 100) {
      const passResult = await this.gamification.awardXp(
        userId,
        50,
        XpSource.EXAM_PASS,
        submissionId,
      );
      const perfectResult = await this.gamification.awardXp(
        userId,
        50,
        XpSource.EXAM_PERFECT,
        submissionId,
        'Điểm tuyệt đối',
      );
      return {
        levelUp: passResult.levelUp || perfectResult.levelUp,
        newLevel: Math.max(passResult.newLevel, perfectResult.newLevel),
        newBadges: [...passResult.newBadges, ...perfectResult.newBadges],
      };
    }
    return this.gamification.awardXp(
      userId,
      isPassed ? 50 : 20,
      isPassed ? XpSource.EXAM_PASS : XpSource.EXAM_FAIL,
      submissionId,
    );
  }
}
