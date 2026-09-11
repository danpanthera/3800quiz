import { IsArray, IsString } from 'class-validator';

// Chốt đáp án 1 câu ở chế độ phản hồi tức thì (kiểu Quizizz): gửi lựa chọn lên,
// server chấm riêng câu đó rồi trả kết quả về. Chốt xong không sửa lại được.
export class LockAttemptAnswerDto {
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds: string[];
}
