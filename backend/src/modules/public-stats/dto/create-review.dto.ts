import { IsString, IsEmail, IsInt, Min, Max, IsOptional, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({ description: 'Reviewer name', example: 'John Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Reviewer email', example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Restaurant name', example: 'My Restaurant' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  restaurant?: string;

  @ApiProperty({ description: 'Rating (1-5)', example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: 'Review comment', example: 'Great service!' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  comment: string;
}
