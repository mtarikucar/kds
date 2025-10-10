import { SetMetadata } from '@nestjs/common';
import { LimitCheck } from '../guards/subscription-limits.guard';

export const CheckLimit = (limitCheck: LimitCheck) =>
  SetMetadata('limitCheck', limitCheck);
