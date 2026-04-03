import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateMarketingUserDto } from './create-marketing-user.dto';

export class UpdateMarketingUserDto extends PartialType(
  OmitType(CreateMarketingUserDto, ['password']),
) {
  @IsOptional()
  @IsString()
  status?: string;
}
