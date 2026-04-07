import { SetMetadata } from '@nestjs/common';

export const IS_MARKETING_ROUTE_KEY = 'isMarketingRoute';
export const MarketingRoute = () => SetMetadata(IS_MARKETING_ROUTE_KEY, true);
