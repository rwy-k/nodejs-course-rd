import { IsInt, IsOptional } from 'class-validator';

export class CompleteUploadDto {
  @IsOptional()
  @IsInt()
  size?: number;
}
