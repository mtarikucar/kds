import { IsIn, IsOptional, IsString } from 'class-validator';
import { DISTRIBUTION_STRATEGIES } from '../services/lead-auto-assigner.service';

export class UpdateDistributionConfigDto {
  @IsOptional()
  @IsString()
  @IsIn(DISTRIBUTION_STRATEGIES as unknown as string[])
  strategy?: string;
}
