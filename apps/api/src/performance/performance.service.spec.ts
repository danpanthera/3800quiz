import { PerformanceService } from './performance.service';

describe('PerformanceService', () => {
  it('không có bài đã nộp nào → trả mảng rỗng, không truy vấn thêm', async () => {
    const prisma = {
      submission: { findMany: jest.fn().mockResolvedValue([]) },
      submissionAnswer: { findMany: jest.fn() },
      question: { findMany: jest.fn() },
    };
    const service = new PerformanceService(prisma as never);

    const result = await service.getSubjectPerformance('user-1');

    expect(result).toEqual([]);
    expect(prisma.submissionAnswer.findMany).not.toHaveBeenCalled();
  });

  it('gộp đúng theo lĩnh vực, sắp yếu nhất lên đầu, bỏ qua câu đã xoá/chưa phân loại', async () => {
    const prisma = {
      submission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'sub-1' }, { id: 'sub-2' }]),
      },
      submissionAnswer: {
        findMany: jest.fn().mockResolvedValue([
          { questionId: 'q-tin-dung-dung', selectedOptionIds: ['opt-1'] },
          { questionId: 'q-tin-dung-sai', selectedOptionIds: ['opt-3'] },
          { questionId: 'q-ke-toan-dung', selectedOptionIds: ['opt-5'] },
          { questionId: 'q-da-bi-xoa', selectedOptionIds: ['opt-99'] },
          { questionId: 'q-chua-phan-loai', selectedOptionIds: ['opt-7'] },
        ]),
      },
      question: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q-tin-dung-dung',
            subjectId: 'subj-tin-dung',
            questionType: 'SINGLE',
            subject: { name: 'Tín dụng' },
            options: [
              { id: 'opt-1', isCorrect: true, orderIndex: 1 },
              { id: 'opt-2', isCorrect: false, orderIndex: 2 },
            ],
          },
          {
            id: 'q-tin-dung-sai',
            subjectId: 'subj-tin-dung',
            questionType: 'SINGLE',
            subject: { name: 'Tín dụng' },
            options: [
              { id: 'opt-3', isCorrect: false, orderIndex: 1 },
              { id: 'opt-4', isCorrect: true, orderIndex: 2 },
            ],
          },
          {
            id: 'q-ke-toan-dung',
            subjectId: 'subj-ke-toan',
            questionType: 'SINGLE',
            subject: { name: 'Kế toán' },
            options: [
              { id: 'opt-5', isCorrect: true, orderIndex: 1 },
              { id: 'opt-6', isCorrect: false, orderIndex: 2 },
            ],
          },
          {
            id: 'q-chua-phan-loai',
            subjectId: null,
            questionType: 'SINGLE',
            subject: null,
            options: [{ id: 'opt-7', isCorrect: true, orderIndex: 1 }],
          },
          // 'q-da-bi-xoa' cố tình KHÔNG có trong danh sách trả về — mô phỏng câu
          // đã bị xoá khỏi ngân hàng, chỉ còn vết tích trong submission_answers.
        ]),
      },
    };
    const service = new PerformanceService(prisma as never);

    const result = await service.getSubjectPerformance('user-1');

    expect(result).toEqual([
      {
        subjectId: 'subj-tin-dung',
        subjectName: 'Tín dụng',
        totalAnswered: 2,
        correctCount: 1,
        correctRate: 50,
      },
      {
        subjectId: 'subj-ke-toan',
        subjectName: 'Kế toán',
        totalAnswered: 1,
        correctCount: 1,
        correctRate: 100,
      },
    ]);
  });

  it('chấm đúng câu ORDERING theo thứ tự orderIndex, không phải theo tập hợp', async () => {
    const prisma = {
      submission: { findMany: jest.fn().mockResolvedValue([{ id: 'sub-1' }]) },
      submissionAnswer: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { questionId: 'q-sap-xep', selectedOptionIds: ['b', 'a'] },
          ]),
      },
      question: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q-sap-xep',
            subjectId: 'subj-quy-trinh',
            questionType: 'ORDERING',
            subject: { name: 'Quy trình' },
            options: [
              { id: 'a', isCorrect: false, orderIndex: 1 },
              { id: 'b', isCorrect: false, orderIndex: 2 },
            ],
          },
        ]),
      },
    };
    const service = new PerformanceService(prisma as never);

    const result = await service.getSubjectPerformance('user-1');

    // Đáp án đúng phải là ['a','b'] (theo orderIndex) — gửi ['b','a'] là SAI dù
    // cùng tập hợp 2 phần tử.
    expect(result).toEqual([
      {
        subjectId: 'subj-quy-trinh',
        subjectName: 'Quy trình',
        totalAnswered: 1,
        correctCount: 0,
        correctRate: 0,
      },
    ]);
  });
});
