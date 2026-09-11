import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AnswerDto {
  @IsUUID()
  questionId: string;

  @IsArray()
  @IsUUID('all', { each: true })
  selectedOptionIds: string[];

  @IsDateString()
  answeredAt: string;
}

export class SubmitDto {
  @IsUUID()
  id: string; // UUID từ app — idempotent key

  @IsString()
  quizId: string; // có thể là UUID hoặc custom string (vd: quiz-demo-001)

  @IsString()
  quizVersionId: string;

  @IsDateString()
  startedAt: string;

  @IsDateString()
  submittedAt: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}
