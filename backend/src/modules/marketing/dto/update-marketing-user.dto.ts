import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, IsIn, IsString, MinLength } from 'class-validator';
import { CreateMarketingUserDto } from './create-marketing-user.dto';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class UpdateMarketingUserDto extends PartialType(
  OmitType(CreateMarketingUserDto, ['password']),
) {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
