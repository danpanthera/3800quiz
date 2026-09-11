import { ScheduleRecurrence } from '@prisma/client';
import { AssignmentScheduleService } from './assignment-schedule.service';

function buildPrismaMock(schedules: any[]) {
  return {
    assignmentSchedule: {
      findMany: jest.fn().mockResolvedValue(schedules),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      delete: jest.fn(),
    },
    assignment: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]),
    },
  };
}

// 2026-09-09 là Thứ Tư (weekday=3 theo UTC+7); 12h trưa UTC+7 = 05:00 UTC
const NOW_UTC7_WED = new Date('2026-09-09T05:00:00.000Z');

describe('AssignmentScheduleService', () => {
  afterEach(() => jest.useRealTimers());

  it('DAILY chưa từng chạy → tới hạn, tạo assignment và cập nhật lastRunAt', async () => {
    jest.useFakeTimers().setSystemTime(NOW_UTC7_WED);
    const schedule = {
      id: 's-1',
      quizId: 'quiz-1',
      departmentId: null,
      recurrence: ScheduleRecurrence.DAILY,
      dayOfWeek: null,
      dayOfMonth: null,
      durationDays: 7,
      lastRunAt: null,
    };
    const prisma = buildPrismaMock([schedule]);
    const service = new AssignmentScheduleService(prisma as never);

    await service.runDueSchedules();

    expect(prisma.assignment.createMany).toHaveBeenCalled();
    expect(prisma.assignmentSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-1' } }),
    );
  });

  it('DAILY đã chạy TRONG HÔM NAY rồi → không chạy lại lần 2', async () => {
    jest.useFakeTimers().setSystemTime(NOW_UTC7_WED);
    const schedule = {
      id: 's-1',
      quizId: 'quiz-1',
      departmentId: null,
      recurrence: ScheduleRecurrence.DAILY,
      dayOfWeek: null,
      dayOfMonth: null,
      durationDays: 7,
      lastRunAt: NOW_UTC7_WED, // đã chạy sáng nay
    };
    const prisma = buildPrismaMock([schedule]);
    const service = new AssignmentScheduleService(prisma as never);

    await service.runDueSchedules();

    expect(prisma.assignment.createMany).not.toHaveBeenCalled();
  });

  it('WEEKLY sai ngày trong tuần → không chạy', async () => {
    jest.useFakeTimers().setSystemTime(NOW_UTC7_WED); // Thứ Tư = 3
    const schedule = {
      id: 's-1',
      quizId: 'quiz-1',
      departmentId: null,
      recurrence: ScheduleRecurrence.WEEKLY,
      dayOfWeek: 1, // Thứ Hai
      dayOfMonth: null,
      durationDays: 7,
      lastRunAt: null,
    };
    const prisma = buildPrismaMock([schedule]);
    const service = new AssignmentScheduleService(prisma as never);

    await service.runDueSchedules();

    expect(prisma.assignment.createMany).not.toHaveBeenCalled();
  });

  it('WEEKLY đúng ngày trong tuần → chạy', async () => {
    jest.useFakeTimers().setSystemTime(NOW_UTC7_WED); // Thứ Tư = 3
    const schedule = {
      id: 's-1',
      quizId: 'quiz-1',
      departmentId: null,
      recurrence: ScheduleRecurrence.WEEKLY,
      dayOfWeek: 3,
      dayOfMonth: null,
      durationDays: 7,
      lastRunAt: null,
    };
    const prisma = buildPrismaMock([schedule]);
    const service = new AssignmentScheduleService(prisma as never);

    await service.runDueSchedules();

    expect(prisma.assignment.createMany).toHaveBeenCalled();
  });

  it('có departmentId → giao theo phòng ban, không lấy toàn bộ user', async () => {
    jest.useFakeTimers().setSystemTime(NOW_UTC7_WED);
    const schedule = {
      id: 's-1',
      quizId: 'quiz-1',
      departmentId: 'dept-1',
      recurrence: ScheduleRecurrence.DAILY,
      dayOfWeek: null,
      dayOfMonth: null,
      durationDays: 7,
      lastRunAt: null,
    };
    const prisma = buildPrismaMock([schedule]);
    const service = new AssignmentScheduleService(prisma as never);

    await service.runDueSchedules();

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.assignment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ departmentId: 'dept-1' })],
      }),
    );
  });

  it('runNow: chạy ngay bất kể có tới hạn hay không', async () => {
    jest.useFakeTimers().setSystemTime(NOW_UTC7_WED);
    const schedule = {
      id: 's-1',
      quizId: 'quiz-1',
      departmentId: null,
      recurrence: ScheduleRecurrence.MONTHLY,
      dayOfWeek: null,
      dayOfMonth: 1, // hôm nay không phải ngày 1
      durationDays: 7,
      lastRunAt: null,
    };
    const prisma = buildPrismaMock([]);
    prisma.assignmentSchedule.findUniqueOrThrow.mockResolvedValue(schedule);
    const service = new AssignmentScheduleService(prisma as never);

    await service.runNow('s-1');

    expect(prisma.assignment.createMany).toHaveBeenCalled();
  });
});
