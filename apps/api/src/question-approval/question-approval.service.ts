import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async getPending() {
    const questions = await this.prisma.question.findMany({
      where: { isBank: true, approvalStatus: 'PENDING' },
      include: {
        options: { orderBy: { orderIndex: 'asc' } },
        subject: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const submitterIds = [
      ...new Set(
        questions
          .map((q) => q.submittedById)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const submitters = submitterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: submitterIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(submitters.map((u) => [u.id, u.fullName]));

    return questions.map((q) => ({
      ...q,
      submittedByName: q.submittedById
        ? (nameById.get(q.submittedById) ?? null)
        : null,
    }));
  }

  async approve(id: string, reviewerId: string) {
    const question = await this.prisma.question.findUniqueOrThrow({
      where: { id },
    });
    if (question.approvalStatus !== 'PENDING')
      throw new BadRequestException('Câu hỏi không ở trạng thái chờ duyệt');

    return this.prisma.question.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
    });
  }

  async reject(id: string, reviewerId: string, reason?: string) {
    const question = await this.prisma.question.findUniqueOrThrow({
      where: { id },
    });
    if (question.approvalStatus !== 'PENDING')
      throw new BadRequestException('Câu hỏi không ở trạng thái chờ duyệt');

    return this.prisma.question.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: reason?.trim() || null,
      },
    });
  }
}
