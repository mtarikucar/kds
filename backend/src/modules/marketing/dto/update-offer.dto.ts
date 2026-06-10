import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateOfferDto } from './create-offer.dto';

export enum OfferStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export class UpdateOfferDto extends PartialType(CreateOfferDto) {
  @IsOptional()
  @IsEnum(OfferStatus)
  status?: OfferStatus;
}
