import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({ example: 'pay_1234567890_abc' })
  @IsString()
  @MinLength(1)
  payment_id: string;

  @ApiProperty({
    description: 'Amount in minor units (e.g. cents)',
    example: '500',
  })
  @IsString()
  @MinLength(1)
  amount: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotency_key?: string;
}
