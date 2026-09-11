import { AttemptsService } from './attempts.service';
import { AttemptStatus } from '@prisma/client';

const attemptId = 'ad9d0b6e-482e-44f1-9c83-e24f9401855c';
const assignmentId = 'eb113a13-e77c-4a73-a693-3ae543492d20';

const snapshot = {
  quiz: {
    id: 'quiz-1',
    title: 'Bài kiểm tra nghiệp vụ',
    description: null,
    topic: 'Tín dụng',
    durationMin: 30,
    passScore: 70,
  },
  questions: [
    {
      id: 'question-1',
      content: 'Câu hỏi',
      questionType: 'SINGLE',
      orderIndex: 1,
      points: 10,
      explanation: 'Giải thích',
      subjectId: 'subject-1',
      subjectName: 'Tín dụng',
      options: [
        { id: 'option-1', content: 'Đúng', isCorrect: true, orderIndex: 1 },
        { id: 'option-2', content: 'Sai', isCorrect: false, orderIndex: 2 },
      ],
    },
  ],
};

// Snapshot "cũ" — tạo trước khi có tính năng hiển thị lĩnh vực, thiếu hẳn 2 key
// subjectId/subjectName (khác với câu đã phân loại nhưng subjectName: null).
const snapshotCuThieuLinhVuc = {
  ...snapshot,
  questions: [
    (() => {
      const { subjectId, subjectName, ...rest } = snapshot.questions[0];
      void subjectId;
      void subjectName;
      return rest;
    })(),
  ],
};

describe('AttemptsService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('tạo attempt với deadline do server quyết định và chỉ trả đề đã lọc đáp án', async () => {
    const prisma = {
      quizAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...data })),
      },
      quizVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          version: 1,
          snapshot,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const assignments = {
      getForUser: jest
        .fn()
        .mockResolvedValue([
          { id: assignmentId, quizId: 'quiz-1', quiz: snapshot.quiz },
        ]),
    };
    const service = new AttemptsService(
      prisma as never,
      assignments as never,
      {} as never,
    );

    const result = await service.start('user-1', {
      id: attemptId,
      assignmentId,
    });

    expect(prisma.quizAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: attemptId,
        userId: 'user-1',
        assignmentId,
        quizId: 'quiz-1',
        quizVersionId: 'version-1',
        startedAt: new Date('2026-09-03T08:00:00.000Z'),
        deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
      }),
    });
    expect(result.quiz.questions[0].options[0]).not.toHaveProperty('isCorrect');
    expect(result.quiz.questions[0]).not.toHaveProperty('explanation');
    expect(result.quiz.questions[0].subjectName).toBe('Tín dụng');
    expect(result.quiz.questions[0]).not.toHaveProperty('subjectId');
  });

  it('chặn bắt đầu attempt mới khi đã dùng hết số lần thi cho phép', async () => {
    const prisma = {
      quizAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null), // không có attempt IN_PROGRESS
        count: jest.fn().mockResolvedValue(2), // đã dùng đủ 2/2 lần GRADED
      },
    };
    const assignments = {
      getForUser: jest.fn().mockResolvedValue([
        {
          id: assignmentId,
          quizId: 'quiz-1',
          quiz: { ...snapshot.quiz, maxAttempts: 2 },
        },
      ]),
    };
    const service = new AttemptsService(
      prisma as never,
      assignments as never,
      {} as never,
    );

    await expect(
      service.start('user-1', { id: attemptId, assignmentId }),
    ).rejects.toThrow(/hết số lần làm bài/);
    expect(prisma.quizAttempt.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', assignmentId, status: AttemptStatus.GRADED },
    });
  });

  it('cho phép làm lại khi bộ đề đặt maxAttempts = 0 (không giới hạn)', async () => {
    const prisma = {
      quizAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(50), // đã làm rất nhiều lần vẫn không sao
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...data })),
      },
      quizVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          version: 1,
          snapshot,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const assignments = {
      getForUser: jest.fn().mockResolvedValue([
        {
          id: assignmentId,
          quizId: 'quiz-1',
          quiz: { ...snapshot.quiz, maxAttempts: 0 },
        },
      ]),
    };
    const service = new AttemptsService(
      prisma as never,
      assignments as never,
      {} as never,
    );

    const result = await service.start('user-1', {
      id: attemptId,
      assignmentId,
    });

    expect(prisma.quizAttempt.count).not.toHaveBeenCalled();
    expect(result.quiz.questions[0].subjectName).toBe('Tín dụng');
  });

  it('bổ sung lĩnh vực cho snapshot cũ thiếu key, không ghi đè QuizVersion', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'question-1',
        subjectId: 'subject-1',
        subject: { name: 'Kế toán' },
      },
    ]);
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: attemptId,
          status: AttemptStatus.IN_PROGRESS,
          deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
          answerRevision: 0,
          quizVersion: {
            snapshot: snapshotCuThieuLinhVuc,
            quiz: { instantFeedback: false },
          },
          answers: [],
        }),
      },
      question: { findMany },
      quizVersion: { create: jest.fn(), update: jest.fn() },
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.get('user-1', attemptId);

    expect(result.quiz.questions[0].subjectName).toBe('Kế toán');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['question-1'] } } }),
    );
    expect(prisma.quizVersion.create).not.toHaveBeenCalled();
    expect(prisma.quizVersion.update).not.toHaveBeenCalled();
  });

  it('không truy vấn lại khi snapshot mới có câu chưa phân loại lĩnh vực', async () => {
    const findMany = jest.fn();
    const snapshotChuaPhanLoai = {
      ...snapshot,
      questions: [
        { ...snapshot.questions[0], subjectId: null, subjectName: null },
      ],
    };
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: attemptId,
          status: AttemptStatus.IN_PROGRESS,
          deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
          answerRevision: 0,
          quizVersion: {
            snapshot: snapshotChuaPhanLoai,
            quiz: { instantFeedback: false },
          },
          answers: [],
        }),
      },
      question: { findMany },
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.get('user-1', attemptId);

    expect(result.quiz.questions[0].subjectName).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('chốt đáp án trả kết quả + đáp án đúng, và chốt lại không đổi được lựa chọn', async () => {
    const daChot = {
      questionId: 'question-1',
      selectedOptionIds: ['option-2'],
      lockedAt: new Date('2026-09-03T08:02:00.000Z'),
      isCorrect: false,
    };
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: attemptId,
          status: AttemptStatus.IN_PROGRESS,
          deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
          answerRevision: 3,
          quizVersion: { snapshot, quiz: { instantFeedback: true } },
          answers: [daChot],
        }),
      },
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    // Gửi lại chính đáp án ĐÚNG cho câu đã chốt sai — kết quả phải giữ nguyên
    const result = await service.lockAnswer('user-1', attemptId, 'question-1', {
      selectedOptionIds: ['option-1'],
    });

    expect(result.alreadyLocked).toBe(true);
    expect(result.isCorrect).toBe(false);
    expect(result.selectedOptionIds).toEqual(['option-2']);
    expect(result.correctOptionIds).toEqual(['option-1']);
  });

  it('không cho chốt đáp án khi bộ đề tắt phản hồi tức thì', async () => {
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: attemptId,
          status: AttemptStatus.IN_PROGRESS,
          deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
          answerRevision: 0,
          quizVersion: { snapshot, quiz: { instantFeedback: false } },
          answers: [],
        }),
      },
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.lockAnswer('user-1', attemptId, 'question-1', {
        selectedOptionIds: ['option-1'],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('autosave bỏ qua câu đã chốt, không cho sửa lại thành đáp án đúng', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: attemptId,
          status: AttemptStatus.IN_PROGRESS,
          startedAt: new Date('2026-09-03T08:00:00.000Z'),
          lastSavedAt: new Date('2026-09-03T08:02:00.000Z'),
          deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
          answerRevision: 1,
          quizVersion: { snapshot, quiz: { instantFeedback: true } },
          answers: [
            {
              questionId: 'question-1',
              selectedOptionIds: ['option-2'],
              lockedAt: new Date('2026-09-03T08:02:00.000Z'),
              isCorrect: false,
            },
          ],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      quizAttemptAnswer: { upsert },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) =>
          fn({
            quizAttempt: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                answerRevision: 2,
                lastSavedAt: new Date('2026-09-03T08:03:00.000Z'),
              }),
            },
            quizAttemptAnswer: { upsert },
          }),
        ),
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await service.saveAnswers('user-1', attemptId, {
      revision: 1,
      answers: [{ questionId: 'question-1', selectedOptionIds: ['option-1'] }],
    });

    expect(upsert).not.toHaveBeenCalled();
  });

  it('từ chối autosave từ tab có revision cũ', async () => {
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: attemptId,
          status: AttemptStatus.IN_PROGRESS,
          deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
          answerRevision: 2,
          quizVersion: { snapshot },
          answers: [],
        }),
      },
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.saveAnswers('user-1', attemptId, {
        revision: 1,
        answers: [
          { questionId: 'question-1', selectedOptionIds: ['option-1'] },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('chấm answers đã lưu trên server từ snapshot và tạo một Submission chính thức', async () => {
    const storedAttempt = {
      id: attemptId,
      assignmentId,
      quizId: 'quiz-1',
      quizVersionId: 'version-1',
      status: AttemptStatus.IN_PROGRESS,
      startedAt: new Date('2026-09-03T08:00:00.000Z'),
      deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
      timedOut: false,
      quizVersion: { snapshot },
      answers: [
        {
          questionId: 'question-1',
          selectedOptionIds: ['option-1'],
          updatedAt: new Date('2026-09-03T08:05:00.000Z'),
        },
      ],
    };
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue(storedAttempt),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0), // chưa có lần GRADED nào trước đó
      },
      submission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: attemptId,
          status: 'GRADED',
          score: 100,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const gamification = {
      updateActivity: jest.fn().mockResolvedValue(undefined),
      incrementSubmissionStats: jest.fn().mockResolvedValue(undefined),
      awardXp: jest
        .fn()
        .mockResolvedValue({ levelUp: false, newLevel: 1, newBadges: [] }),
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      gamification as never,
    );

    const result = await service.finalize('user-1', attemptId, false);

    expect(prisma.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: attemptId,
        userId: 'user-1',
        quizId: 'quiz-1',
        quizVersionId: 'version-1',
        score: 100,
        isPassed: true,
        startedAt: new Date('2026-09-03T08:00:00.000Z'),
      }),
    });
    expect(gamification.incrementSubmissionStats).toHaveBeenCalledWith(
      'user-1',
      true,
    );
    expect(gamification.awardXp).toHaveBeenCalled();
    expect(result).toMatchObject({ id: attemptId, score: 100, isPassed: true });
  });

  it('không cộng XP khi đây là lần nộp bài thứ 2 trở đi của cùng lượt giao bài', async () => {
    const storedAttempt = {
      id: attemptId,
      assignmentId,
      quizId: 'quiz-1',
      quizVersionId: 'version-1',
      status: AttemptStatus.IN_PROGRESS,
      startedAt: new Date('2026-09-03T08:00:00.000Z'),
      deadlineAt: new Date('2026-09-03T08:30:00.000Z'),
      timedOut: false,
      quizVersion: { snapshot },
      answers: [
        {
          questionId: 'question-1',
          selectedOptionIds: ['option-1'],
          updatedAt: new Date('2026-09-03T08:05:00.000Z'),
        },
      ],
    };
    const prisma = {
      quizAttempt: {
        findFirst: jest.fn().mockResolvedValue(storedAttempt),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1), // đã có 1 lần GRADED trước đó (làm lại)
      },
      submission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: attemptId,
          status: 'GRADED',
          score: 100,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const gamification = {
      updateActivity: jest.fn().mockResolvedValue(undefined),
      incrementSubmissionStats: jest.fn().mockResolvedValue(undefined),
      awardXp: jest.fn().mockResolvedValue({
        levelUp: false,
        newLevel: 1,
        newBadges: [],
      }),
    };
    const service = new AttemptsService(
      prisma as never,
      {} as never,
      gamification as never,
    );

    const result = await service.finalize('user-1', attemptId, false);

    expect(prisma.quizAttempt.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        assignmentId,
        status: AttemptStatus.GRADED,
        id: { not: attemptId },
      },
    });
    expect(gamification.awardXp).not.toHaveBeenCalled();
    expect(gamification.incrementSubmissionStats).not.toHaveBeenCalled();
    expect(gamification.updateActivity).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: attemptId, score: 100, isPassed: true });
  });
});
