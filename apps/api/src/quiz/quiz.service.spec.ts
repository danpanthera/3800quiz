import { QuizService } from './quiz.service';

describe('QuizService', () => {
  it('không lấy đáp án đúng hoặc giải thích cho nội dung làm bài', async () => {
    const prisma = {
      quiz: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'quiz-1',
          title: 'Bài kiểm tra',
          versions: [{ id: 'version-1', version: 1 }],
        }),
      },
      quizVersion: { create: jest.fn() },
      question: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new QuizService(prisma as never);

    await service.getQuizAttemptContent('quiz-1');

    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: { quizId: 'quiz-1' },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        content: true,
        imageUrl: true,
        questionType: true,
        orderIndex: true,
        points: true,
        options: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            content: true,
            orderIndex: true,
          },
        },
      },
    });
  });
});
