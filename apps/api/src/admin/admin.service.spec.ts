import * as XLSX from 'xlsx';
import { AdminService } from './admin.service';

function buildExcelBuffer(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('AdminService.duplicateQuiz', () => {
  it('nhân bản đúng câu hỏi/đáp án, đặt bản sao ở trạng thái Tắt', async () => {
    const original = {
      id: 'quiz-1',
      title: 'Nghiệp vụ tín dụng',
      description: 'Mô tả gốc',
      topic: 'Tín dụng',
      durationMin: 30,
      passScore: 70,
      instantFeedback: false,
      maxAttempts: 2,
      isActive: true,
      questions: [
        {
          id: 'question-1',
          subjectId: 'subject-1',
          content: 'Câu 1',
          imageUrl: null,
          explanation: 'Giải thích',
          questionType: 'SINGLE',
          orderIndex: 1,
          points: 10,
          options: [
            { id: 'opt-1', content: 'Đúng', isCorrect: true, orderIndex: 1 },
            { id: 'opt-2', content: 'Sai', isCorrect: false, orderIndex: 2 },
          ],
        },
      ],
    };
    const prisma = {
      quiz: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(original),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'quiz-2', ...data }),
          ),
      },
    };
    const service = new AdminService(prisma as never, {} as never);

    await service.duplicateQuiz('quiz-1');

    expect(prisma.quiz.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Nghiệp vụ tín dụng (Bản sao)',
        durationMin: 30,
        passScore: 70,
        maxAttempts: 2,
        isActive: false,
        questions: {
          create: [
            expect.objectContaining({
              subjectId: 'subject-1',
              content: 'Câu 1',
              questionType: 'SINGLE',
              isBank: false,
              options: {
                create: [
                  { content: 'Đúng', isCorrect: true, orderIndex: 1 },
                  { content: 'Sai', isCorrect: false, orderIndex: 2 },
                ],
              },
            }),
          ],
        },
      }),
      include: { _count: { select: { assignments: true, questions: true } } },
    });
  });
});

describe('AdminService.deleteReportsBulk', () => {
  it('KHÔNG xóa AuditLog liên quan (nhật ký phải bất biến) và tự ghi log cho chính thao tác xóa', async () => {
    const prisma = {
      submission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'sub-1', userId: 'user-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      quizAttempt: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      xpTransaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      submissionAnswer: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const gamification = {
      recomputeUserProgress: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AdminService(prisma as never, gamification as never);

    const result = await service.deleteReportsBulk(['sub-1'], 'admin-1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        action: 'DELETE_REPORTS_BULK',
        meta: { submissionIds: ['sub-1'], count: 1 },
      },
    });
    expect(gamification.recomputeUserProgress).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ deleted: 1 });
  });
});

describe('AdminService.getAuditLogs', () => {
  it('lọc theo action/userId/khoảng ngày, ánh xạ đúng tên người dùng', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'log-1',
        userId: 'user-1',
        user: { fullName: 'Nguyễn Văn A', username: 'nguyenvana' },
        action: 'DELETE_CAN_BO',
        entityId: 'canbo-1',
        meta: null,
        ipAddress: null,
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    ]);
    const prisma = { auditLog: { findMany } };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getAuditLogs({
      action: 'DELETE_CAN_BO',
      userId: 'user-1',
      from: '2026-09-01',
      to: '2026-09-09',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        action: 'DELETE_CAN_BO',
        userId: 'user-1',
        createdAt: { gte: new Date('2026-09-01'), lte: new Date('2026-09-09') },
      },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    expect(result).toEqual([
      {
        id: 'log-1',
        userId: 'user-1',
        userName: 'Nguyễn Văn A',
        username: 'nguyenvana',
        action: 'DELETE_CAN_BO',
        entityId: 'canbo-1',
        meta: null,
        ipAddress: null,
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    ]);
  });

  it('không lọc gì → where rỗng, take mặc định 200', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { auditLog: { findMany } };
    const service = new AdminService(prisma as never, {} as never);

    await service.getAuditLogs();

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });
});

describe('AdminService — ghi nhật ký cho thao tác nhạy cảm với Cán bộ', () => {
  it('deleteCanBo ghi AuditLog action DELETE_CAN_BO kèm actorUserId', async () => {
    const prisma = {
      canBo: { delete: jest.fn().mockResolvedValue({ id: 'canbo-1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new AdminService(prisma as never, {} as never);

    await service.deleteCanBo('canbo-1', 'admin-1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { userId: 'admin-1', action: 'DELETE_CAN_BO', entityId: 'canbo-1' },
    });
  });

  it('bulkDeleteCanBo ghi AuditLog action DELETE_CAN_BO_BULK kèm danh sách id', async () => {
    const prisma = {
      canBo: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.bulkDeleteCanBo(['c1', 'c2'], 'admin-1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        action: 'DELETE_CAN_BO_BULK',
        meta: { canBoIds: ['c1', 'c2'], deleted: 2 },
      },
    });
    expect(result).toEqual({ deleted: 2 });
  });

  it('resetCanBoPasswords ghi AuditLog action RESET_CAN_BO_PASSWORDS kèm thống kê', async () => {
    const prisma = {
      canBo: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            cbCode: 'CB001',
            fullName: 'Nguyễn Văn A',
            userAD: null,
          },
        ]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new AdminService(prisma as never, {} as never);

    await service.resetCanBoPasswords(['c1'], 'admin-1');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        action: 'RESET_CAN_BO_PASSWORDS',
        meta: { canBoIds: ['c1'], reset: 1, noAccount: 0 },
      },
    });
  });
});

describe('AdminService.getAttemptViolations', () => {
  it('ánh xạ đúng tên người dùng/tên bộ đề, lọc theo type/userId/quizId', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'violation-1',
        type: 'TAB_HIDDEN',
        occurredAt: new Date('2026-09-08T00:00:00.000Z'),
        attemptId: 'attempt-1',
        attempt: {
          id: 'attempt-1',
          userId: 'user-1',
          quizId: 'quiz-1',
          status: 'IN_PROGRESS',
          violationCount: 2,
          user: { fullName: 'Nguyễn Văn A', username: 'nguyenvana' },
          assignment: { quiz: { title: 'Nghiệp vụ tín dụng' } },
        },
      },
    ]);
    const prisma = { attemptViolation: { findMany } };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getAttemptViolations({
      type: 'TAB_HIDDEN' as never,
      userId: 'user-1',
      quizId: 'quiz-1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'TAB_HIDDEN',
        attempt: { userId: 'user-1', quizId: 'quiz-1' },
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
      take: 200,
    });
    expect(result).toEqual([
      {
        id: 'violation-1',
        type: 'TAB_HIDDEN',
        occurredAt: new Date('2026-09-08T00:00:00.000Z'),
        attemptId: 'attempt-1',
        userId: 'user-1',
        userName: 'Nguyễn Văn A',
        username: 'nguyenvana',
        quizId: 'quiz-1',
        quizTitle: 'Nghiệp vụ tín dụng',
        attemptStatus: 'IN_PROGRESS',
        totalViolationsInAttempt: 2,
      },
    ]);
  });

  it('không lọc gì → where rỗng ngoài phần attempt, take mặc định 200', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { attemptViolation: { findMany } };
    const service = new AdminService(prisma as never, {} as never);

    await service.getAttemptViolations();

    expect(findMany).toHaveBeenCalledWith({
      where: { attempt: {} },
      include: expect.any(Object),
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  });
});

describe('AdminService.getReportTrends', () => {
  it('gộp theo tuần (mặc định), tính đúng điểm TB và tỷ lệ đạt, sắp theo thời gian tăng dần', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        score: 80,
        isPassed: true,
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      }, // tuần 1 (thứ Ba)
      {
        score: 40,
        isPassed: false,
        submittedAt: new Date('2026-09-02T00:00:00.000Z'),
      }, // cùng tuần
      {
        score: 100,
        isPassed: true,
        submittedAt: new Date('2026-09-10T00:00:00.000Z'),
      }, // tuần khác
      {
        score: null,
        isPassed: null,
        submittedAt: new Date('2026-09-10T00:00:00.000Z'),
      }, // score null → bỏ qua
    ]);
    const prisma = { submission: { findMany } };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getReportTrends();

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'GRADED', score: { not: null } },
      select: { score: true, isPassed: true, submittedAt: true },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      totalSubmissions: 2,
      avgScore: 60,
      passRate: 50,
    });
    expect(result[1]).toMatchObject({
      totalSubmissions: 1,
      avgScore: 100,
      passRate: 100,
    });
    expect(result[0].period < result[1].period).toBe(true);
  });

  it('gộp theo tháng khi groupBy="month"', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        score: 50,
        isPassed: false,
        submittedAt: new Date('2026-08-15T00:00:00.000Z'),
      },
      {
        score: 90,
        isPassed: true,
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);
    const prisma = { submission: { findMany } };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getReportTrends('month');

    expect(result).toEqual([
      { period: '2026-08', totalSubmissions: 1, avgScore: 50, passRate: 0 },
      { period: '2026-09', totalSubmissions: 1, avgScore: 90, passRate: 100 },
    ]);
  });

  it('không có submission nào → mảng rỗng', async () => {
    const prisma = {
      submission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminService(prisma as never, {} as never);

    expect(await service.getReportTrends()).toEqual([]);
  });
});

describe('AdminService.getQuestionAnalytics', () => {
  const baseQuestion = {
    id: 'q1',
    content: 'Câu hỏi 1',
    questionType: 'SINGLE',
    quizId: 'quiz-1',
    quiz: { id: 'quiz-1', title: 'Nghiệp vụ tín dụng' },
    subject: { name: 'Tín dụng' },
    options: [
      { id: 'opt-1', isCorrect: true, orderIndex: 1 },
      { id: 'opt-2', isCorrect: false, orderIndex: 2 },
    ],
  };

  it('tính đúng correctRate, bỏ qua câu không ai làm và bài chưa có điểm', async () => {
    const prisma = {
      question: { findMany: jest.fn().mockResolvedValue([baseQuestion]) },
      submissionAnswer: {
        findMany: jest.fn().mockResolvedValue([
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-1'],
            submission: { score: 90 },
          },
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-2'],
            submission: { score: 40 },
          },
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-1'],
            submission: { score: null },
          }, // chưa chấm → bỏ qua
        ]),
      },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getQuestionAnalytics();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'q1',
      quizTitle: 'Nghiệp vụ tín dụng',
      subjectName: 'Tín dụng',
      totalAttempts: 2,
      correctCount: 1,
      correctRate: 50,
      discrimination: null, // < 4 người làm → không đủ tính độ phân biệt
    });
  });

  it('câu không ai từng làm bị lọc bỏ khỏi kết quả', async () => {
    const prisma = {
      question: { findMany: jest.fn().mockResolvedValue([baseQuestion]) },
      submissionAnswer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminService(prisma as never, {} as never);

    expect(await service.getQuestionAnalytics()).toEqual([]);
  });

  it('tính đúng độ phân biệt khi đủ 4 người trở lên (nửa điểm cao vs nửa điểm thấp)', async () => {
    const prisma = {
      question: { findMany: jest.fn().mockResolvedValue([baseQuestion]) },
      submissionAnswer: {
        findMany: jest.fn().mockResolvedValue([
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-1'],
            submission: { score: 100 },
          }, // cao, đúng
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-1'],
            submission: { score: 90 },
          }, // cao, đúng
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-2'],
            submission: { score: 20 },
          }, // thấp, sai
          {
            questionId: 'q1',
            selectedOptionIds: ['opt-2'],
            submission: { score: 10 },
          }, // thấp, sai
        ]),
      },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getQuestionAnalytics();

    // Nhóm cao 2/2 đúng (100%), nhóm thấp 0/2 đúng (0%) → phân biệt = 100
    expect(result[0]).toMatchObject({ totalAttempts: 4, discrimination: 100 });
  });

  it('lọc theo quizId/subjectId truyền xuống query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      question: { findMany },
      submissionAnswer: { findMany: jest.fn() },
    };
    const service = new AdminService(prisma as never, {} as never);

    await service.getQuestionAnalytics({
      quizId: 'quiz-1',
      subjectId: 'subj-1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { isBank: false, quizId: 'quiz-1', subjectId: 'subj-1' },
      include: {
        options: { select: { id: true, isCorrect: true, orderIndex: true } },
        quiz: { select: { id: true, title: true } },
        subject: { select: { name: true } },
      },
    });
  });
});

describe('AdminService.extendAssignmentsByFilter', () => {
  it('không truyền quizId lẫn departmentId → báo lỗi, không gọi updateMany', async () => {
    const prisma = { assignment: { updateMany: jest.fn() } };
    const service = new AdminService(prisma as never, {} as never);

    await expect(
      service.extendAssignmentsByFilter('2026-12-31'),
    ).rejects.toThrow(
      'Cần chọn ít nhất bộ đề hoặc chi nhánh/phòng ban để gia hạn',
    );
    expect(prisma.assignment.updateMany).not.toHaveBeenCalled();
  });

  it('lọc theo quizId → cập nhật đúng endAt cho các phân công khớp', async () => {
    const prisma = {
      assignment: { updateMany: jest.fn().mockResolvedValue({ count: 5 }) },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.extendAssignmentsByFilter(
      '2026-12-31',
      'quiz-1',
    );

    expect(prisma.assignment.updateMany).toHaveBeenCalledWith({
      where: { quizId: 'quiz-1' },
      data: { endAt: new Date('2026-12-31') },
    });
    expect(result).toEqual({ extended: 5 });
  });

  it('lọc theo departmentId → mở rộng cả phòng ban con, và cả canBo/user trực thuộc', async () => {
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([{ id: 'dept-child' }]),
      },
      assignment: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const service = new AdminService(prisma as never, {} as never);

    await service.extendAssignmentsByFilter('2026-12-31', undefined, 'dept-1');

    expect(prisma.assignment.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { departmentId: { in: ['dept-1', 'dept-child'] } },
          { canBo: { departmentId: { in: ['dept-1', 'dept-child'] } } },
          { user: { departmentId: { in: ['dept-1', 'dept-child'] } } },
        ],
      },
      data: { endAt: new Date('2026-12-31') },
    });
  });
});

describe('AdminService.importAssignmentsFromExcel', () => {
  it('khớp đúng theo cbCode, tạo assignment qua createAssignmentsBulk, báo notFound cho mã không khớp', async () => {
    const buffer = buildExcelBuffer([
      ['CB001'],
      ['CB002'],
      ['CB_KHONG_TON_TAI'],
    ]);
    const prisma = {
      canBo: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'canbo-1', cbCode: 'CB001', userAD: null, username: 'cb001' },
          { id: 'canbo-2', cbCode: 'CB002', userAD: null, username: 'cb002' },
        ]),
      },
      assignment: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.importAssignmentsFromExcel(buffer, 'quiz-1');

    expect(prisma.assignment.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ canBoId: 'canbo-1', quizId: 'quiz-1' }),
        expect.objectContaining({ canBoId: 'canbo-2', quizId: 'quiz-1' }),
      ]),
      skipDuplicates: true,
    });
    expect(result).toEqual({ created: 2, notFound: ['CB_KHONG_TON_TAI'] });
  });

  it('file không có dòng dữ liệu → báo lỗi, không truy vấn CanBo', async () => {
    const buffer = buildExcelBuffer([]);
    const prisma = { canBo: { findMany: jest.fn() } };
    const service = new AdminService(prisma as never, {} as never);

    await expect(
      service.importAssignmentsFromExcel(buffer, 'quiz-1'),
    ).rejects.toThrow('File không có dòng dữ liệu nào');
    expect(prisma.canBo.findMany).not.toHaveBeenCalled();
  });

  it('không ai khớp → created=0, notFound đủ danh sách, không gọi createMany', async () => {
    const buffer = buildExcelBuffer([['XYZ']]);
    const prisma = {
      canBo: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { createMany: jest.fn() },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.importAssignmentsFromExcel(buffer, 'quiz-1');

    expect(result).toEqual({ created: 0, notFound: ['XYZ'] });
    expect(prisma.assignment.createMany).not.toHaveBeenCalled();
  });
});

describe('AdminService.getDepartmentPerformance', () => {
  it('gộp đúng theo phòng ban của người làm bài, sắp điểm TB thấp nhất lên đầu', async () => {
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-a', name: 'Phòng A', parentId: null },
          { id: 'dept-b', name: 'Phòng B', parentId: null },
          { id: 'dept-c', name: 'Phòng C (chưa ai làm bài)', parentId: null },
        ]),
      },
      submission: {
        findMany: jest.fn().mockResolvedValue([
          { score: 90, isPassed: true, user: { departmentId: 'dept-a' } },
          { score: 40, isPassed: false, user: { departmentId: 'dept-b' } },
          { score: 60, isPassed: true, user: { departmentId: 'dept-b' } },
        ]),
      },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getDepartmentPerformance();

    expect(result).toEqual([
      {
        id: 'dept-b',
        name: 'Phòng B',
        parentId: null,
        totalSubmissions: 2,
        avgScore: 50,
        passRate: 50,
      },
      {
        id: 'dept-a',
        name: 'Phòng A',
        parentId: null,
        totalSubmissions: 1,
        avgScore: 90,
        passRate: 100,
      },
    ]);
  });
});

describe('AdminService.getAtRiskStaff', () => {
  it('trả về đủ 3 nhóm rủi ro, mỗi nhóm ánh xạ đúng field', async () => {
    const prisma = {
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            userId: 'user-1',
            endAt: new Date('2026-09-10T00:00:00.000Z'),
            user: { fullName: 'Nguyễn Văn A' },
            quiz: { title: 'Nghiệp vụ tín dụng' },
          },
        ]),
      },
      submission: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'user-2',
            score: 40,
            submittedAt: new Date('2026-09-01T00:00:00.000Z'),
            user: { fullName: 'Trần Thị B' },
            quizVersion: { quiz: { title: 'Kế toán' } },
          },
        ]),
      },
      quizAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'user-3',
            violationCount: 5,
            user: { fullName: 'Lê Văn C' },
            assignment: { quiz: { title: 'CNTT' } },
          },
        ]),
      },
    };
    const service = new AdminService(prisma as never, {} as never);

    const result = await service.getAtRiskStaff();

    expect(result).toEqual({
      nearDeadlineNoSubmission: [
        {
          userId: 'user-1',
          userName: 'Nguyễn Văn A',
          quizTitle: 'Nghiệp vụ tín dụng',
          endAt: new Date('2026-09-10T00:00:00.000Z'),
        },
      ],
      recentFails: [
        {
          userId: 'user-2',
          userName: 'Trần Thị B',
          quizTitle: 'Kế toán',
          score: 40,
          submittedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
      highViolations: [
        {
          userId: 'user-3',
          userName: 'Lê Văn C',
          quizTitle: 'CNTT',
          violationCount: 5,
        },
      ],
    });
  });
});
