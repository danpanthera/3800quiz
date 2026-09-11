import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isAnswerCorrect } from '../common/grading.util';

const MAX_PRACTICE_QUESTIONS = 50;

@Injectable()
export class PracticeService {
  constructor(private readonly prisma: PrismaService) {}

  // Danh sách lĩnh vực kèm số câu trong ngân hàng — để trang luyện tập cho
  // chọn lĩnh vực + biết tối đa lấy được bao nhiêu câu.
  async getSubjects() {
    const subjects = await this.prisma.subject.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            questions: { where: { isBank: true, approvalStatus: 'APPROVED' } },
          },
        },
      },
    });
    return subjects
      .filter((s) => s._count.questions > 0)
      .map((s) => ({
        id: s.id,
        name: s.name,
        questionCount: s._count.questions,
      }));
  }

  // Lấy ngẫu nhiên `count` câu — KHÔNG tạo bản ghi gì cả (stateless), không
  // tính vào điểm/XP/thống kê chính thức. Không trả isCorrect để khỏi lộ đáp
  // án qua Network tab trước khi người dùng bấm nộp.
  async start(subjectId: string | undefined, count: number) {
    const take = Math.min(Math.max(count, 1), MAX_PRACTICE_QUESTIONS);
    const bankQuestions = await this.prisma.question.findMany({
      where: {
        isBank: true,
        approvalStatus: 'APPROVED',
        ...(subjectId ? { subjectId } : {}),
      },
      include: {
        options: { orderBy: { orderIndex: 'asc' } },
        subject: { select: { name: true } },
      },
    });
    if (bankQuestions.length === 0)
      throw new BadRequestException(
        'Lĩnh vực này chưa có câu hỏi trong ngân hàng',
      );

    const shuffled = [...bankQuestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, take).map((q) => ({
      id: q.id,
      content: q.content,
      imageUrl: q.imageUrl,
      questionType: q.questionType,
      subjectName: q.subject?.name ?? null,
      options: q.options.map((o) => ({
        id: o.id,
        content: o.content,
        orderIndex: o.orderIndex,
      })),
    }));
  }

  // Chấm ngay tại chỗ, KHÔNG lưu gì — trả đúng/sai + đáp án đúng + giải thích
  // cho từng câu để hiển thị luôn (đúng tinh thần "luyện tập tự do", khác bài
  // thi thường ở chỗ không tạo Submission/QuizAttempt nào).
  async grade(answers: { questionId: string; selectedOptionIds: string[] }[]) {
    if (!answers?.length)
      throw new BadRequestException('Chưa có câu trả lời nào để chấm');

    const questionIds = answers.map((a) => a.questionId);
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      include: { options: { orderBy: { orderIndex: 'asc' } } },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    let correctCount = 0;
    const results = answers.map((a) => {
      const question = questionById.get(a.questionId);
      if (!question) {
        return {
          questionId: a.questionId,
          isCorrect: false,
          correctOptionIds: [],
          explanation: null,
        };
      }
      const correct = isAnswerCorrect(
        question.questionType,
        question.options,
        a.selectedOptionIds,
      );
      if (correct) correctCount += 1;
      return {
        questionId: a.questionId,
        isCorrect: correct,
        correctOptionIds: question.options
          .filter((o) => o.isCorrect)
          .map((o) => o.id),
        explanation: question.explanation,
      };
    });

    return {
      results,
      correctCount,
      total: answers.length,
      scorePercent: Math.round((correctCount / answers.length) * 100),
    };
  }
}
