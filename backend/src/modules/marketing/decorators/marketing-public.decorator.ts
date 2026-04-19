import { SetMetadata } from '@nestjs/common';

export const IS_MARKETING_PUBLIC_KEY = 'isMarketingPublic';
export const MarketingPublic = () => SetMetadata(IS_MARKETING_PUBLIC_KEY, true);

export const IS_MARKETING_ROUTE_KEY = 'isMarketingRoute';
export const MarketingRoute = () => SetMetadata(IS_MARKETING_ROUTE_KEY, true);
