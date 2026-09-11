import { BadRequestException } from '@nestjs/common';
import { QuestionApprovalService } from './question-approval.service';

describe('QuestionApprovalService', () => {
  it('getPending: gộp tên người gửi từ bảng User', async () => {
    const prisma = {
      question: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q-1',
            approvalStatus: 'PENDING',
            submittedById: 'u-1',
            subject: { name: 'Tín dụng' },
          },
        ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u-1', fullName: 'Nguyễn Văn A' }]),
      },
    };
    const service = new QuestionApprovalService(prisma as never);

    const result = await service.getPending();

    expect(result[0].submittedByName).toBe('Nguyễn Văn A');
  });

  it('approve: chuyển PENDING → APPROVED, gắn reviewedById', async () => {
    const prisma = {
      question: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'q-1', approvalStatus: 'PENDING' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new QuestionApprovalService(prisma as never);

    await service.approve('q-1', 'admin-1');

    expect(prisma.question.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: expect.objectContaining({
        approvalStatus: 'APPROVED',
        reviewedById: 'admin-1',
      }),
    });
  });

  it('approve: câu không PENDING → BadRequestException', async () => {
    const prisma = {
      question: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'q-1', approvalStatus: 'APPROVED' }),
        update: jest.fn(),
      },
    };
    const service = new QuestionApprovalService(prisma as never);

    await expect(service.approve('q-1', 'admin-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.question.update).not.toHaveBeenCalled();
  });

  it('reject: chuyển PENDING → REJECTED, lưu lý do', async () => {
    const prisma = {
      question: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'q-1', approvalStatus: 'PENDING' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new QuestionApprovalService(prisma as never);

    await service.reject('q-1', 'admin-1', 'Nội dung chưa rõ ràng');

    expect(prisma.question.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: expect.objectContaining({
        approvalStatus: 'REJECTED',
        rejectionReason: 'Nội dung chưa rõ ràng',
      }),
    });
  });
});
