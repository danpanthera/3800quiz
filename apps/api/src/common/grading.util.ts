import { Prisma, QuestionType } from '@prisma/client';

/**
 * Chấm đúng/sai 1 câu hỏi theo đúng quy tắc dùng trong toàn hệ thống (xem
 * attempts.service.ts:gradeQuestion() — bản gốc chính thức khi làm bài thi).
 * Dùng chung cho các luồng KHÔNG phải chấm điểm chính thức (câu hỏi khởi động,
 * luyện tập tự do, ôn tập ngắt quãng) để khỏi chép lại logic 3-4 lần.
 */
export function isAnswerCorrect(
  questionType: QuestionType,
  options: { id: string; isCorrect: boolean; orderIndex: number }[],
  selectedOptionIdsJson: Prisma.JsonValue,
): boolean {
  const selectedOptionIds = Array.isArray(selectedOptionIdsJson)
    ? selectedOptionIdsJson.filter((id): id is string => typeof id === 'string')
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
