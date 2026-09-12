import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Một dòng câu hỏi admin đã xem/sửa trên modal xem trước khi import — gửi thẳng
// lên để tạo câu hỏi, không cần upload lại file Excel gốc. Validate chi tiết hơn
// (đủ đáp án, correctIndex trỏ đúng ô) thực hiện trong AdminService vì còn phụ
// thuộc lẫn nhau giữa các field, class-validator không diễn đạt gọn được.
export class ImportBankQuestionRowDto {
  @IsInt()
  rowNumber: number;

  @IsString()
  content: string;

  // Đúng 4 phần tử ứng với cột B-E trong file gốc (Đáp án A-D) — phần tử có thể
  // là null/chuỗi rỗng nếu đáp án đó không dùng.
  @IsArray()
  @ArrayMaxSize(4)
  optionTexts: (string | null)[];

  @IsInt()
  correctIndex: number;

  @IsOptional()
  @IsString()
  explanation?: string | null;
}

export class ImportBankQuestionsDto {
  @IsString()
  subjectId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportBankQuestionRowDto)
  rows: ImportBankQuestionRowDto[];

  // Mặc định (false/không gửi) giữ hành vi cũ: câu trùng hoàn toàn/gần trùng
  // (duplicateLevel 'exact'/'high') bị tự động bỏ qua. Admin bật cờ này ở modal
  // xem trước để vẫn import cả những câu đó thay vì bị âm thầm bỏ qua.
  @IsOptional()
  @IsBoolean()
  importDuplicates?: boolean;
}
