import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AssignmentStatus, ScheduleRecurrence } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Kiểm tra lịch tới hạn mỗi giờ — đủ nhanh để không lệch quá xa mốc mong muốn
// (vd lịch DAILY đặt chạy "mỗi ngày" chỉ cần trúng ngày, không cần trúng giờ),
// đồng thời không tạo tải DB liên tục. Cùng kiểu setInterval().unref() với
// EXPIRY_SWEEP_INTERVAL_MS trong attempts.service.ts.
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

function todayUtc7DateKey(): string {
  const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return nowUtc7.toISOString().slice(0, 10);
}

function daysInMonthUtc7(): number {
  const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(nowUtc7.getUTCFullYear(), nowUtc7.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function weekdayUtc7(): number {
  // 0 = Chủ nhật .. 6 = Thứ 7, tính theo UTC+7 (không dùng getDay() theo giờ máy chủ)
  const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return nowUtc7.getUTCDay();
}

interface ScheduleRow {
  id: string;
  quizId: string;
  departmentId: string | null;
  recurrence: ScheduleRecurrence;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  durationDays: number;
  lastRunAt: Date | null;
}

@Injectable()
export class AssignmentScheduleService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssignmentScheduleService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runDueSchedules();
    }, SCHEDULE_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  getAll() {
    return this.prisma.assignmentSchedule.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        quiz: { select: { title: true } },
        department: { select: { name: true } },
      },
    });
  }

  create(data: {
    quizId: string;
    departmentId?: string;
    recurrence: ScheduleRecurrence;
    dayOfWeek?: number;
    dayOfMonth?: number;
    durationDays?: number;
  }) {
    return this.prisma.assignmentSchedule.create({
      data: {
        quizId: data.quizId,
        departmentId: data.departmentId || null,
        recurrence: data.recurrence,
        dayOfWeek: data.dayOfWeek,
        dayOfMonth: data.dayOfMonth,
        durationDays: data.durationDays ?? 7,
      },
    });
  }

  setActive(id: string, isActive: boolean) {
    return this.prisma.assignmentSchedule.update({
      where: { id },
      data: { isActive },
    });
  }

  delete(id: string) {
    return this.prisma.assignmentSchedule.delete({ where: { id } });
  }

  // Chạy thủ công ngay lập tức (nút "Chạy ngay" trên UI) — không cần chờ tới hạn,
  // vẫn cập nhật lastRunAt như chạy tự động.
  async runNow(id: string) {
    const schedule = await this.prisma.assignmentSchedule.findUniqueOrThrow({
      where: { id },
    });
    return this.executeSchedule(schedule);
  }

  async runDueSchedules(): Promise<void> {
    const schedules = await this.prisma.assignmentSchedule.findMany({
      where: { isActive: true },
    });
    for (const schedule of schedules) {
      if (!this.isDue(schedule)) continue;
      try {
        await this.executeSchedule(schedule);
      } catch (err) {
        this.logger.error(
          `Lỗi khi tự động giao bài theo lịch ${schedule.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private isDue(schedule: ScheduleRow): boolean {
    const todayKey = todayUtc7DateKey();
    const lastRunKey = schedule.lastRunAt
      ? new Date(schedule.lastRunAt.getTime() + 7 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : null;
    if (lastRunKey === todayKey) return false; // đã chạy trong hôm nay rồi

    switch (schedule.recurrence) {
      case ScheduleRecurrence.DAILY:
        return true;
      case ScheduleRecurrence.WEEKLY:
        return weekdayUtc7() === (schedule.dayOfWeek ?? 1);
      case ScheduleRecurrence.MONTHLY: {
        const target = Math.min(schedule.dayOfMonth ?? 1, daysInMonthUtc7());
        const nowUtc7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
        return nowUtc7.getUTCDate() === target;
      }
      default:
        return false;
    }
  }

  private async executeSchedule(schedule: ScheduleRow) {
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + schedule.durationDays * DAY_MS);

    const result = schedule.departmentId
      ? await this.prisma.assignment.createMany({
          data: [
            {
              quizId: schedule.quizId,
              departmentId: schedule.departmentId,
              status: AssignmentStatus.ACTIVE,
              startAt,
              endAt,
            },
          ],
          skipDuplicates: true,
        })
      : await this.createForAllActiveStaff(schedule.quizId, startAt, endAt);

    await this.prisma.assignmentSchedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: startAt },
    });

    this.logger.log(
      `Đã tự động giao bài theo lịch ${schedule.id} — ${result.count} phân công mới`,
    );
    return { count: result.count };
  }

  private async createForAllActiveStaff(
    quizId: string,
    startAt: Date,
    endAt: Date,
  ) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return this.prisma.assignment.createMany({
      data: users.map((u) => ({
        quizId,
        userId: u.id,
        status: AssignmentStatus.ACTIVE,
        startAt,
        endAt,
      })),
      skipDuplicates: true,
    });
  }
}
