import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';

export class StripeWebhookDto {
  @IsString()
  @IsNotEmpty()
  signature: string;

  @IsObject()
  @IsNotEmpty()
  payload: any;
}

export class IyzicoWebhookDto {
  @IsObject()
  @IsNotEmpty()
  payload: any;

  @IsString()
  @IsOptional()
  signature?: string;
}
