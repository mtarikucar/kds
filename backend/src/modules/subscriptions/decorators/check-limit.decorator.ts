import { SetMetadata } from '@nestjs/common';

export const CHECK_LIMIT_KEY = 'checkLimit';

export enum LimitType {
  USERS = 'maxUsers',
  TABLES = 'maxTables',
  PRODUCTS = 'maxProducts',
  CATEGORIES = 'maxCategories',
  MONTHLY_ORDERS = 'maxMonthlyOrders',
}

/**
 * Decorator to check if a limit has been reached before performing an action
 * @param limitType - The type of limit to check
 */
export const CheckLimit = (limitType: LimitType) =>
  SetMetadata(CHECK_LIMIT_KEY, limitType);
