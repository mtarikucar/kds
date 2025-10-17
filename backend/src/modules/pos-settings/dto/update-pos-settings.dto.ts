import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePosSettingsDto {
  @ApiPropertyOptional({ description: 'Enable tableless mode (orders without table selection)' })
  @IsBoolean()
  @IsOptional()
  enableTablelessMode?: boolean;

  @ApiPropertyOptional({ description: 'Enable two-step checkout (separate order creation and payment)' })
  @IsBoolean()
  @IsOptional()
  enableTwoStepCheckout?: boolean;
}
