import { NotFoundException } from '@nestjs/common';
import { ReviewService } from './review.service';

const BASE_CARD = {
  id: 'card-1',
  userId: 'user-1',
  questionId: 'q-1',
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  dueAt: new Date(),
  lastReviewedAt: null,
};

const SAMPLE_QUESTION = {
  id: 'q-1',
  content: 'Câu hỏi',
  imageUrl: null,
  explanation: 'Giải thích',
  questionType: 'SINGLE',
  options: [
    { id: 'opt-1', content: 'A', isCorrect: true, orderIndex: 1 },
    { id: 'opt-2', content: 'B', isCorrect: false, orderIndex: 2 },
  ],
};

function buildPrismaMock() {
  return {
    submission: { findMany: jest.fn().mockResolvedValue([]) },
    submissionAnswer: { findMany: jest.fn().mockResolvedValue([]) },
    reviewCard: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(BASE_CARD),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    question: {
      findUnique: jest.fn().mockResolvedValue(SAMPLE_QUESTION),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('ReviewService', () => {
  it('answer: trả lời đúng lần đầu → repetitions=1, hạn ôn 1 ngày sau', async () => {
    const prisma = buildPrismaMock();
    const service = new ReviewService(prisma as never);

    const result = await service.answer('user-1', 'card-1', ['opt-1']);

    expect(result.isCorrect).toBe(true);
    expect(result.intervalDays).toBe(1);
    expect(prisma.reviewCard.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: expect.objectContaining({ repetitions: 1, intervalDays: 1 }),
    });
  });

  it('answer: trả lời sai → reset repetitions về 0, ôn lại sau 1 ngày', async () => {
    const prisma = buildPrismaMock();
    prisma.reviewCard.findUnique.mockResolvedValue({
      ...BASE_CARD,
      repetitions: 3,
      intervalDays: 20,
    });
    const service = new ReviewService(prisma as never);

    const result = await service.answer('user-1', 'card-1', ['opt-2']);

    expect(result.isCorrect).toBe(false);
    expect(prisma.reviewCard.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: expect.objectContaining({ repetitions: 0, intervalDays: 1 }),
    });
  });

  it('answer: thẻ không thuộc về user → NotFoundException', async () => {
    const prisma = buildPrismaMock();
    const service = new ReviewService(prisma as never);

    await expect(
      service.answer('user-khac', 'card-1', ['opt-1']),
    ).rejects.toThrow(NotFoundException);
  });

  it('answer: câu hỏi đã bị xoá khỏi ngân hàng → xoá thẻ mồ côi, NotFoundException', async () => {
    const prisma = buildPrismaMock();
    prisma.question.findUnique.mockResolvedValue(null);
    const service = new ReviewService(prisma as never);

    await expect(service.answer('user-1', 'card-1', ['opt-1'])).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.reviewCard.delete).toHaveBeenCalledWith({
      where: { id: 'card-1' },
    });
  });

  it('getDueQueue: tự tạo thẻ mới từ câu trả lời SAI trong Submission chưa có thẻ', async () => {
    const prisma = buildPrismaMock();
    prisma.submission.findMany.mockResolvedValue([{ id: 'sub-1' }] as never);
    prisma.submissionAnswer.findMany.mockResolvedValue([
      { questionId: 'q-moi', selectedOptionIds: ['opt-2'] }, // sai (đáp án đúng là opt-1)
    ] as never);
    prisma.question.findMany.mockResolvedValue([
      {
        id: 'q-moi',
        questionType: 'SINGLE',
        options: [
          { id: 'opt-1', isCorrect: true, orderIndex: 1 },
          { id: 'opt-2', isCorrect: false, orderIndex: 2 },
        ],
      },
    ] as never);
    const service = new ReviewService(prisma as never);

    await service.getDueQueue('user-1');

    expect(prisma.reviewCard.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'user-1', questionId: 'q-moi' }),
      ],
      skipDuplicates: true,
    });
  });

  it('getDueQueue: câu trả lời ĐÚNG trong Submission không tạo thẻ ôn tập', async () => {
    const prisma = buildPrismaMock();
    prisma.submission.findMany.mockResolvedValue([{ id: 'sub-1' }] as never);
    prisma.submissionAnswer.findMany.mockResolvedValue([
      { questionId: 'q-dung', selectedOptionIds: ['opt-1'] },
    ] as never);
    prisma.question.findMany.mockResolvedValue([
      {
        id: 'q-dung',
        questionType: 'SINGLE',
        options: [
          { id: 'opt-1', isCorrect: true, orderIndex: 1 },
          { id: 'opt-2', isCorrect: false, orderIndex: 2 },
        ],
      },
    ] as never);
    const service = new ReviewService(prisma as never);

    await service.getDueQueue('user-1');

    expect(prisma.reviewCard.createMany).not.toHaveBeenCalled();
  });
});
