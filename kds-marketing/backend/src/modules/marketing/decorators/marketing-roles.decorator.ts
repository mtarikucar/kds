import { SetMetadata } from '@nestjs/common';

export const MARKETING_ROLES_KEY = 'marketingRoles';
export const MarketingRoles = (...roles: string[]) =>
  SetMetadata(MARKETING_ROLES_KEY, roles);
