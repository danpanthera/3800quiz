import { IsEnum } from 'class-validator';
import { AttemptViolationType } from '@prisma/client';

export class ReportViolationDto {
  @IsEnum(AttemptViolationType)
  type: AttemptViolationType;
}
