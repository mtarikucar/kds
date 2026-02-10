import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, Min, Max, ValidateIf } from 'class-validator';

export enum AuthMethod {
  PASSWORD = 'password',
  PRIVATE_KEY = 'privateKey',
}

export class SshConnectDto {
  @IsString()
  @IsNotEmpty()
  host: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number = 22;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEnum(AuthMethod)
  authMethod: AuthMethod;

  @ValidateIf((o) => o.authMethod === AuthMethod.PASSWORD)
  @IsString()
  @IsNotEmpty()
  password?: string;

  @ValidateIf((o) => o.authMethod === AuthMethod.PRIVATE_KEY)
  @IsString()
  @IsNotEmpty()
  privateKey?: string;

  @IsString()
  @IsOptional()
  passphrase?: string;
}
