import { Injectable } from '@nestjs/common';
import { Prisma, QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SubjectStat {
  subjectId: string;
  subjectName: string;
  totalAnswered: number;
  correctCount: number;
  correctRate: number;
}

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tổng hợp tỷ lệ đúng theo từng Lĩnh vực (Subject) từ TOÀN BỘ bài đã nộp
   * (Submission GRADED) của user — dùng cho widget "Bản đồ điểm yếu". Chỉ đọc
   * dữ liệu lịch sử, không đụng tới bảng đang làm dở (QuizAttempt/attempts.service.ts).
   * Sắp theo correctRate tăng dần (yếu nhất lên đầu). Câu đã bị xoá khỏi ngân
   * hàng hoặc chưa phân loại lĩnh vực bị bỏ qua (không tính vào thống kê).
   */
  async getSubjectPerformance(userId: string): Promise<SubjectStat[]> {
    const submissions = await this.prisma.submission.findMany({
      where: { userId, status: 'GRADED' },
      select: { id: true },
    });
    if (submissions.length === 0) return [];

    const answers = await this.prisma.submissionAnswer.findMany({
      where: { submissionId: { in: submissions.map((s) => s.id) } },
      select: { questionId: true, selectedOptionIds: true },
    });
    if (answers.length === 0) return [];

    const questionIds = [...new Set(answers.map((a) => a.questionId))];
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: {
        id: true,
        subjectId: true,
        questionType: true,
        subject: { select: { name: true } },
        options: { select: { id: true, isCorrect: true, orderIndex: true } },
      },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const statsBySubject = new Map<
      string,
      { subjectName: string; total: number; correct: number }
    >();

    for (const answer of answers) {
      const question = questionById.get(answer.questionId);
      if (!question?.subjectId) continue;

      const entry = statsBySubject.get(question.subjectId) ?? {
        subjectName: question.subject?.name ?? '(?)',
        total: 0,
        correct: 0,
      };
      entry.total += 1;
      if (
        this.isAnswerCorrect(
          question.questionType,
          question.options,
          answer.selectedOptionIds,
        )
      ) {
        entry.correct += 1;
      }
      statsBySubject.set(question.subjectId, entry);
    }

    return [...statsBySubject.entries()]
      .map(([subjectId, s]) => ({
        subjectId,
        subjectName: s.subjectName,
        totalAnswered: s.total,
        correctCount: s.correct,
        correctRate: Math.round((s.correct / s.total) * 100),
      }))
      .sort((a, b) => a.correctRate - b.correctRate);
  }

  // Chấm đúng/sai theo đúng quy tắc của attempts.service.ts:gradeQuestion() — cố
  // tình để bản riêng ở đây (không import chéo module) vì đây chỉ là thống kê
  // tham khảo, không phải chấm điểm chính thức, và tránh phụ thuộc vòng giữa
  // các module đang được sửa song song.
  private isAnswerCorrect(
    questionType: QuestionType,
    options: { id: string; isCorrect: boolean; orderIndex: number }[],
    selectedOptionIdsJson: Prisma.JsonValue,
  ): boolean {
    const selectedOptionIds = Array.isArray(selectedOptionIdsJson)
      ? selectedOptionIdsJson.filter(
          (id): id is string => typeof id === 'string',
        )
      : [];

    if (questionType === QuestionType.ORDERING) {
      const correctOrder = options
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((o) => o.id);
      return JSON.stringify(correctOrder) === JSON.stringify(selectedOptionIds);
    }

    const correctOptionIds = options
      .filter((o) => o.isCorrect)
      .map((o) => o.id)
      .sort();
    return (
      JSON.stringify(correctOptionIds) ===
      JSON.stringify([...selectedOptionIds].sort())
    );
  }
}
