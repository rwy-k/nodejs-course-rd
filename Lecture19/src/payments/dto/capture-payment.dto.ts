import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CapturePaymentDto {
  @ApiProperty({ example: 'pay_1234567890_abc' })
  @IsString()
  @MinLength(1)
  payment_id: string;

  @ApiProperty({
    description: 'Amount in minor units (e.g. cents)',
    example: '1000',
  })
  @IsString()
  @MinLength(1)
  amount: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotency_key?: string;
}
