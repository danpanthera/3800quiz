import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { XpSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { isAnswerCorrect } from '../common/grading.util';

const DAILY_QUESTION_XP = 5;

// Múi giờ UTC+7, chỉ lấy phần ngày (yyyy-mm-dd) — cùng cách tính "ngày" với
// updateActivity() trong gamification.service.ts để nhất quán mốc reset streak.
function todayUtc7(): Date {
  const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(nowUtc7.toISOString().slice(0, 10));
}

// Băm chuỗi ngày thành số nguyên không âm (djb2 rút gọn) — chỉ cần ổn định và
// dàn đều, không cần chống va chạm mật mã.
function hashDateKey(dateKey: string): number {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return hash;
}

@Injectable()
export class DailyQuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  // Không lưu bảng "câu hỏi hôm nay" — chọn LẠI mỗi lần gọi bằng hàm băm ngày,
  // nên mọi người dùng trong cùng 1 ngày luôn ra cùng 1 câu (miễn ngân hàng
  // câu hỏi APPROVED không đổi kích thước trong ngày đó).
  private async pickTodayQuestion() {
    const bankQuestionIds = await this.prisma.question.findMany({
      where: { isBank: true, approvalStatus: 'APPROVED' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (bankQuestionIds.length === 0) return null;

    const dateKey = todayUtc7().toISOString().slice(0, 10);
    const index = hashDateKey(dateKey) % bankQuestionIds.length;

    return this.prisma.question.findUnique({
      where: { id: bankQuestionIds[index].id },
      include: {
        options: { orderBy: { orderIndex: 'asc' } },
        subject: { select: { name: true } },
      },
    });
  }

  async getToday(userId: string) {
    const question = await this.pickTodayQuestion();
    if (!question) return { available: false as const };

    const date = todayUtc7();
    const existing = await this.prisma.dailyQuestionAttempt.findUnique({
      where: { userId_date: { userId, date } },
    });

    const baseQuestion = {
      id: question.id,
      content: question.content,
      imageUrl: question.imageUrl,
      questionType: question.questionType,
      subjectName: question.subject?.name ?? null,
    };

    if (existing) {
      return {
        available: true as const,
        answered: true as const,
        isCorrect: existing.isCorrect,
        selectedOptionIds: existing.selectedOptionIds,
        question: {
          ...baseQuestion,
          explanation: question.explanation,
          options: question.options.map((o) => ({
            id: o.id,
            content: o.content,
            isCorrect: o.isCorrect,
            orderIndex: o.orderIndex,
          })),
        },
      };
    }

    return {
      available: true as const,
      answered: false as const,
      question: {
        ...baseQuestion,
        explanation: null,
        options: question.options.map((o) => ({
          id: o.id,
          content: o.content,
          orderIndex: o.orderIndex,
        })),
      },
    };
  }

  async answer(
    userId: string,
    questionId: string,
    selectedOptionIds: string[],
  ) {
    const question = await this.pickTodayQuestion();
    if (!question)
      throw new BadRequestException('Chưa có câu hỏi khởi động hôm nay');
    if (question.id !== questionId) {
      throw new BadRequestException(
        'Câu hỏi khởi động đã thay đổi, vui lòng tải lại trang',
      );
    }

    const date = todayUtc7();
    const existing = await this.prisma.dailyQuestionAttempt.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (existing)
      throw new ConflictException(
        'Bạn đã trả lời câu hỏi khởi động hôm nay rồi',
      );

    const correct = isAnswerCorrect(
      question.questionType,
      question.options,
      selectedOptionIds,
    );

    await this.prisma.dailyQuestionAttempt.create({
      data: { userId, date, questionId, selectedOptionIds, isCorrect: correct },
    });

    if (correct) {
      await this.gamification.awardXp(
        userId,
        DAILY_QUESTION_XP,
        XpSource.DAILY_QUESTION,
        questionId,
        'Câu hỏi khởi động mỗi ngày',
      );
    }

    return {
      isCorrect: correct,
      explanation: question.explanation,
      correctOptionIds: question.options
        .filter((o) => o.isCorrect)
        .map((o) => o.id),
    };
  }
}
