import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { EmptyStringToNumber, StringToBoolean } from '../../../../common/dto/transforms';

export class CreateCrewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  dailyCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCrewDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @EmptyStringToNumber()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  dailyCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
