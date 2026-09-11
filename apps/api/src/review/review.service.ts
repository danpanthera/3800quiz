import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isAnswerCorrect } from '../common/grading.util';

const DUE_QUEUE_LIMIT = 20;

interface Sm2Input {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  // Thuật toán SM-2 rút gọn (chỉ 2 mức chất lượng: đúng/sai — không bắt người
  // dùng tự chấm độ khó như Anki) — sai thì reset về ôn lại ngay hôm sau, đúng
  // thì dãn dần khoảng cách theo hệ số dễ nhớ (easeFactor).
  private applySm2(
    card: Sm2Input,
    isCorrect: boolean,
  ): Sm2Input & { dueAt: Date } {
    let { easeFactor, intervalDays, repetitions } = card;
    const quality = isCorrect ? 4 : 0;

    if (quality < 3) {
      repetitions = 0;
      intervalDays = 1;
    } else {
      repetitions += 1;
      if (repetitions === 1) intervalDays = 1;
      else if (repetitions === 2) intervalDays = 6;
      else intervalDays = Math.round(intervalDays * easeFactor);
      easeFactor = Math.max(
        1.3,
        easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
      );
    }

    const dueAt = new Date(Date.now() + intervalDays * 86_400_000);
    return { easeFactor, intervalDays, repetitions, dueAt };
  }

  // Tạo lười thẻ ôn tập mới từ các câu trả lời SAI trong lịch sử bài đã nộp
  // (Submission/SubmissionAnswer — LUÔN được ghi ở finalize() bất kể chế độ
  // thi, khác với QuizAttemptAnswer.isCorrect chỉ được set khi bật
  // instantFeedback). Cùng cách đọc dữ liệu với performance.service.ts, KHÔNG
  // hook vào attempts.service.ts (file đang có phiên khác chỉnh sửa).
  private async syncNewCardsFromWrongAnswers(userId: string): Promise<void> {
    const submissions = await this.prisma.submission.findMany({
      where: { userId, status: 'GRADED' },
      select: { id: true },
    });
    if (submissions.length === 0) return;

    const answers = await this.prisma.submissionAnswer.findMany({
      where: { submissionId: { in: submissions.map((s) => s.id) } },
      select: { questionId: true, selectedOptionIds: true },
    });
    if (answers.length === 0) return;

    const questionIds = [...new Set(answers.map((a) => a.questionId))];
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: {
        id: true,
        questionType: true,
        options: { select: { id: true, isCorrect: true, orderIndex: true } },
      },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const wrongQuestionIds = new Set<string>();
    for (const answer of answers) {
      const question = questionById.get(answer.questionId);
      if (!question) continue; // câu đã bị xoá khỏi ngân hàng — bỏ qua
      if (
        !isAnswerCorrect(
          question.questionType,
          question.options,
          answer.selectedOptionIds,
        )
      ) {
        wrongQuestionIds.add(question.id);
      }
    }
    if (wrongQuestionIds.size === 0) return;

    const existingCards = await this.prisma.reviewCard.findMany({
      where: { userId, questionId: { in: [...wrongQuestionIds] } },
      select: { questionId: true },
    });
    const existingIds = new Set(existingCards.map((c) => c.questionId));
    const newOnes = [...wrongQuestionIds].filter((id) => !existingIds.has(id));
    if (newOnes.length === 0) return;

    await this.prisma.reviewCard.createMany({
      data: newOnes.map((questionId) => ({
        userId,
        questionId,
        dueAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  async getStats(userId: string) {
    await this.syncNewCardsFromWrongAnswers(userId);
    const [dueCount, totalCount] = await Promise.all([
      this.prisma.reviewCard.count({
        where: { userId, dueAt: { lte: new Date() } },
      }),
      this.prisma.reviewCard.count({ where: { userId } }),
    ]);
    return { dueCount, totalCount };
  }

  async getDueQueue(userId: string) {
    await this.syncNewCardsFromWrongAnswers(userId);

    const dueCards = await this.prisma.reviewCard.findMany({
      where: { userId, dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: DUE_QUEUE_LIMIT,
    });
    if (dueCards.length === 0) return [];

    const questions = await this.prisma.question.findMany({
      where: { id: { in: dueCards.map((c) => c.questionId) } },
      include: {
        options: { orderBy: { orderIndex: 'asc' } },
        subject: { select: { name: true } },
      },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    // Câu đã bị xoá khỏi ngân hàng thì dọn luôn thẻ mồ côi, không đưa vào hàng chờ
    const orphanCardIds = dueCards
      .filter((c) => !questionById.has(c.questionId))
      .map((c) => c.id);
    if (orphanCardIds.length > 0) {
      await this.prisma.reviewCard.deleteMany({
        where: { id: { in: orphanCardIds } },
      });
    }

    return dueCards
      .filter((c) => questionById.has(c.questionId))
      .map((c) => {
        const q = questionById.get(c.questionId)!;
        return {
          cardId: c.id,
          questionId: q.id,
          content: q.content,
          imageUrl: q.imageUrl,
          questionType: q.questionType,
          subjectName: q.subject?.name ?? null,
          repetitions: c.repetitions,
          options: q.options.map((o) => ({
            id: o.id,
            content: o.content,
            orderIndex: o.orderIndex,
          })),
        };
      });
  }

  async answer(userId: string, cardId: string, selectedOptionIds: string[]) {
    const card = await this.prisma.reviewCard.findUnique({
      where: { id: cardId },
    });
    if (!card || card.userId !== userId)
      throw new NotFoundException('Không tìm thấy thẻ ôn tập');

    const question = await this.prisma.question.findUnique({
      where: { id: card.questionId },
      include: { options: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!question) {
      await this.prisma.reviewCard.delete({ where: { id: cardId } });
      throw new NotFoundException(
        'Câu hỏi không còn tồn tại, đã xoá khỏi danh sách ôn tập',
      );
    }

    const correct = isAnswerCorrect(
      question.questionType,
      question.options,
      selectedOptionIds,
    );
    const updated = this.applySm2(card, correct);

    await this.prisma.reviewCard.update({
      where: { id: cardId },
      data: {
        easeFactor: updated.easeFactor,
        intervalDays: updated.intervalDays,
        repetitions: updated.repetitions,
        dueAt: updated.dueAt,
        lastReviewedAt: new Date(),
      },
    });

    return {
      isCorrect: correct,
      correctOptionIds: question.options
        .filter((o) => o.isCorrect)
        .map((o) => o.id),
      explanation: question.explanation,
      nextDueAt: updated.dueAt,
      intervalDays: updated.intervalDays,
    };
  }
}
