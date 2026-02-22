import { IsEnum, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { FileEntityType, FileVisibility } from '../../entities/file-record.entity';

export class PresignRequestDto {
  @IsEnum(FileEntityType)
  entityType: FileEntityType;

  @IsInt()
  entityId: number;

  @IsString()
  @Matches(/^image\/(jpeg|png|gif|webp)$/, {
    message: 'contentType must be one of: image/jpeg, image/png, image/gif, image/webp',
  })
  contentType: string;

  @IsOptional()
  @IsString()
  originalName?: string;

  @IsOptional()
  @IsEnum(FileVisibility)
  visibility?: FileVisibility;
}
