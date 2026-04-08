import { IsString, IsNotEmpty, IsObject } from 'class-validator';

export class PaytrWebhookDto {
  @IsString()
  @IsNotEmpty()
  merchant_oid: string;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsString()
  @IsNotEmpty()
  hash: string;

  @IsObject()
  payload: any;
}
