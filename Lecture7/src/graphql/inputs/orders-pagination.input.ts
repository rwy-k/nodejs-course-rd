import { InputType, Field, Int } from '@nestjs/graphql';
import { IsOptional, Min, Max, IsInt, IsString } from 'class-validator';

@InputType()
export class OrdersPaginationInput {
  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsOptional()
  @IsInt({ message: 'must be an integer' })
  @Min(1, { message: 'must be at least 1' })
  @Max(50, { message: 'cannot exceed 50' })
  first?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  after?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  before?: string;
}
