import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, IsIn, IsString, MinLength } from 'class-validator';
import { CreateMarketingUserDto } from './create-marketing-user.dto';

export class UpdateMarketingUserDto extends PartialType(
  OmitType(CreateMarketingUserDto, ['password']),
) {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
