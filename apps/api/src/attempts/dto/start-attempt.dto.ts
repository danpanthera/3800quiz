import { IsUUID } from 'class-validator';

export class StartAttemptDto {
  @IsUUID()
  id: string;

  @IsUUID()
  assignmentId: string;
}
