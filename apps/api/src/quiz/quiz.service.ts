import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuizService {
  constructor(private readonly prisma: PrismaService) {}

  private async getQuizWithLatestVersion(id: string) {
    let quiz = await this.prisma.quiz.findUniqueOrThrow({
      where: { id },
      include: {
        versions: {
          orderBy: { version: 'desc' as const },
          take: 1,
          select: { id: true, version: true },
        },
      },
    });

    if (quiz.versions.length === 0) {
      const newVersion = await this.prisma.quizVersion.create({
        data: { quizId: id, version: 1, snapshot: {} },
        select: { id: true, version: true },
      });
      quiz = { ...quiz, versions: [newVersion] };
    }

    return quiz;
  }

  async findById(id: string) {
    return this.prisma.quiz.findUniqueOrThrow({
      where: { id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
  }

  async getQuizAttemptContent(id: string) {
    const quiz = await this.getQuizWithLatestVersion(id);
    const questions = await this.prisma.question.findMany({
      where: { quizId: id },
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

    return { quiz, questions };
  }
}
