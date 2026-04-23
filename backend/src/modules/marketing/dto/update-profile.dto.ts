import { IsOptional, IsString } from 'class-validator';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class UpdateProfileDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  firstName?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  lastName?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  phone?: string;
}
