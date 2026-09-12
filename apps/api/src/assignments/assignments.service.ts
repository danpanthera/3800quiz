import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true, username: true },
    });

    if (!user) throw new NotFoundException('Người dùng không tồn tại');

    // Tìm canBoId của user: ưu tiên userAD, fallback cbCode và username
    const canBo = user.username
      ? await this.prisma.canBo.findFirst({
          where: {
            isActive: true,
            OR: [
              { userAD: user.username },
              { cbCode: user.username },
              { username: user.username },
            ],
          },
          select: { id: true },
        })
      : null;

    const now = new Date();
    const assignments = await this.prisma.assignment.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { userId },
          { canBoId: canBo?.id ?? undefined },
          { departmentId: user.departmentId ?? undefined },
        ],
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            description: true,
            topic: true,
            durationMin: true,
            instantFeedback: true,
            maxAttempts: true,
          },
        },
        // Toàn bộ lần làm bài của chính user (chặn take:1 cũ) — để trang chủ vừa
        // biết trạng thái gần nhất (chưa làm / đang làm dở / đã hết giờ / đã nộp)
        // vừa đếm được đã dùng bao nhiêu lượt và lần nào điểm cao nhất khi bộ đề
        // cho phép thi lại nhiều lần. Chặn take:50 để phòng dữ liệu bất thường,
        // thực tế maxAttempts hợp lý sẽ không bao giờ chạm mức này.
        attempts: {
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            status: true,
            deadlineAt: true,
            submissionId: true,
            submission: { select: { score: true, isPassed: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Giữ nguyên toàn bộ field cũ, chỉ thêm myAttempt/attemptsUsed/bestAttempt
    // để không phá client đang dùng.
    return assignments.map(({ attempts, ...rest }) => {
      const gradedAttempts = attempts.filter((a) => a.status === 'GRADED');
      const bestAttempt = gradedAttempts.reduce<
        (typeof gradedAttempts)[number] | null
      >(
        (best, a) =>
          !best || (a.submission?.score ?? -1) > (best.submission?.score ?? -1)
            ? a
            : best,
        null,
      );
      return {
        ...rest,
        myAttempt: attempts[0] ?? null,
        attemptsUsed: gradedAttempts.length,
        bestAttempt: bestAttempt
          ? {
              submissionId: bestAttempt.submissionId,
              score: bestAttempt.submission?.score ?? null,
              isPassed: bestAttempt.submission?.isPassed ?? null,
            }
          : null,
      };
    });
  }
}
