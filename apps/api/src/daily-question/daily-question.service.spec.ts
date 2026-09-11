import { BadRequestException, ConflictException } from '@nestjs/common';
import { DailyQuestionService } from './daily-question.service';

function buildPrismaMock(bankQuestionIds: { id: string }[], question: any) {
  return {
    question: {
      findMany: jest.fn().mockResolvedValue(bankQuestionIds),
      findUnique: jest.fn().mockResolvedValue(question),
    },
    dailyQuestionAttempt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

const SAMPLE_QUESTION = {
  id: 'q-1',
  content: 'Câu hỏi mẫu',
  imageUrl: null,
  explanation: 'Giải thích mẫu',
  questionType: 'SINGLE',
  subject: { name: 'Tín dụng' },
  options: [
    { id: 'opt-1', content: 'A', isCorrect: true, orderIndex: 1 },
    { id: 'opt-2', content: 'B', isCorrect: false, orderIndex: 2 },
  ],
};

describe('DailyQuestionService', () => {
  it('không có câu nào trong ngân hàng → available: false', async () => {
    const prisma = buildPrismaMock([], null);
    const gamification = { awardXp: jest.fn() };
    const service = new DailyQuestionService(
      prisma as never,
      gamification as never,
    );

    const result = await service.getToday('user-1');

    expect(result).toEqual({ available: false });
  });

  it('chưa trả lời → trả về câu hỏi, ẨN đáp án đúng và giải thích', async () => {
    const prisma = buildPrismaMock([{ id: 'q-1' }], SAMPLE_QUESTION);
    const gamification = { awardXp: jest.fn() };
    const service = new DailyQuestionService(
      prisma as never,
      gamification as never,
    );

    const result = await service.getToday('user-1');

    expect(result.available).toBe(true);
    expect((result as any).answered).toBe(false);
    expect((result as any).question.explanation).toBeNull();
    expect((result as any).question.options[0].isCorrect).toBeUndefined();
  });

  it('trả lời đúng → ghi nhận isCorrect=true và cộng XP', async () => {
    const prisma = buildPrismaMock([{ id: 'q-1' }], SAMPLE_QUESTION);
    const gamification = { awardXp: jest.fn() };
    const service = new DailyQuestionService(
      prisma as never,
      gamification as never,
    );

    const result = await service.answer('user-1', 'q-1', ['opt-1']);

    expect(result.isCorrect).toBe(true);
    expect(prisma.dailyQuestionAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isCorrect: true, questionId: 'q-1' }),
      }),
    );
    expect(gamification.awardXp).toHaveBeenCalledWith(
      'user-1',
      5,
      'DAILY_QUESTION',
      'q-1',
      expect.any(String),
    );
  });

  it('trả lời sai → không cộng XP', async () => {
    const prisma = buildPrismaMock([{ id: 'q-1' }], SAMPLE_QUESTION);
    const gamification = { awardXp: jest.fn() };
    const service = new DailyQuestionService(
      prisma as never,
      gamification as never,
    );

    const result = await service.answer('user-1', 'q-1', ['opt-2']);

    expect(result.isCorrect).toBe(false);
    expect(gamification.awardXp).not.toHaveBeenCalled();
  });

  it('gửi sai questionId (câu đã đổi) → BadRequestException', async () => {
    const prisma = buildPrismaMock([{ id: 'q-1' }], SAMPLE_QUESTION);
    const gamification = { awardXp: jest.fn() };
    const service = new DailyQuestionService(
      prisma as never,
      gamification as never,
    );

    await expect(service.answer('user-1', 'q-khac', ['opt-1'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('đã trả lời hôm nay rồi → ConflictException', async () => {
    const prisma = buildPrismaMock([{ id: 'q-1' }], SAMPLE_QUESTION);
    prisma.dailyQuestionAttempt.findUnique.mockResolvedValue({
      id: 'a-1',
      isCorrect: true,
    });
    const gamification = { awardXp: jest.fn() };
    const service = new DailyQuestionService(
      prisma as never,
      gamification as never,
    );

    await expect(service.answer('user-1', 'q-1', ['opt-1'])).rejects.toThrow(
      ConflictException,
    );
  });
});
