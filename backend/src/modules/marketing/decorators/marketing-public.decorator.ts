import { SetMetadata } from '@nestjs/common';

export const IS_MARKETING_PUBLIC_KEY = 'isMarketingPublic';
export const MarketingPublic = () => SetMetadata(IS_MARKETING_PUBLIC_KEY, true);
