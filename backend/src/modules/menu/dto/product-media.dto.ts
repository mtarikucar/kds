import { ApiProperty } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class GeneratePhotoDto {
  @ApiProperty({ required: false, description: "Operator steer prompt" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @ApiProperty({ required: false, description: "Number of variations (1-4)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  count?: number;
}

export class GenerateFrameDto extends GeneratePhotoDto {}

export class GenerateVideoDto {
  @ApiProperty({
    required: false,
    description: "How the transition should look",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;
}

export class SetPrimaryImageDto {
  @ApiProperty({
    description: "The library image URL to make the primary photo",
  })
  @IsString()
  @MaxLength(2048)
  imageUrl!: string;
}
