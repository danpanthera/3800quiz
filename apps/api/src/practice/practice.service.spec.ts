import { BadRequestException } from '@nestjs/common';
import { PracticeService } from './practice.service';

describe('PracticeService', () => {
  it('getSubjects: chỉ trả lĩnh vực có ít nhất 1 câu ngân hàng', async () => {
    const prisma = {
      subject: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's-1', name: 'Tín dụng', _count: { questions: 5 } },
          { id: 's-2', name: 'Rỗng', _count: { questions: 0 } },
        ]),
      },
    };
    const service = new PracticeService(prisma as never);

    const result = await service.getSubjects();

    expect(result).toEqual([{ id: 's-1', name: 'Tín dụng', questionCount: 5 }]);
  });

  it('start: không có câu hỏi nào → BadRequestException', async () => {
    const prisma = { question: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PracticeService(prisma as never);

    await expect(service.start('s-1', 10)).rejects.toThrow(BadRequestException);
  });

  it('start: giới hạn tối đa 50 câu, ẩn đáp án đúng', async () => {
    const bank = Array.from({ length: 60 }, (_, i) => ({
      id: `q-${i}`,
      content: `Câu ${i}`,
      imageUrl: null,
      questionType: 'SINGLE',
      subject: { name: 'Tín dụng' },
      options: [
        { id: `opt-${i}`, content: 'A', isCorrect: true, orderIndex: 1 },
      ],
    }));
    const prisma = {
      question: { findMany: jest.fn().mockResolvedValue(bank) },
    };
    const service = new PracticeService(prisma as never);

    const result = await service.start(undefined, 999);

    expect(result).toHaveLength(50);
    expect((result[0].options[0] as any).isCorrect).toBeUndefined();
  });

  it('grade: chấm đúng/sai và tính % điểm, KHÔNG ghi gì vào DB', async () => {
    const prisma = {
      question: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q-1',
            questionType: 'SINGLE',
            explanation: 'Giải thích',
            options: [
              { id: 'opt-1', isCorrect: true, orderIndex: 1 },
              { id: 'opt-2', isCorrect: false, orderIndex: 2 },
            ],
          },
        ]),
      },
    };
    const service = new PracticeService(prisma as never);

    const result = await service.grade([
      { questionId: 'q-1', selectedOptionIds: ['opt-1'] },
    ]);

    expect(result).toEqual({
      results: [
        {
          questionId: 'q-1',
          isCorrect: true,
          correctOptionIds: ['opt-1'],
          explanation: 'Giải thích',
        },
      ],
      correctCount: 1,
      total: 1,
      scorePercent: 100,
    });
  });

  it('grade: mảng rỗng → BadRequestException', async () => {
    const service = new PracticeService({} as never);
    await expect(service.grade([])).rejects.toThrow(BadRequestException);
  });
});
