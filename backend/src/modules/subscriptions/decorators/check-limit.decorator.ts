import { SetMetadata } from "@nestjs/common";

export const CHECK_LIMIT_KEY = "checkLimit";

export enum LimitType {
  USERS = "maxUsers",
  TABLES = "maxTables",
  BRANCHES = "maxBranches",
  PRODUCTS = "maxProducts",
  CATEGORIES = "maxCategories",
  MONTHLY_ORDERS = "maxMonthlyOrders",
  // AI menu-studio monthly caps. Real enforcement is the atomic claim inside
  // MenuAiQuotaService (a guard-level pre-check would race on parallel
  // submits); these members exist so limitOverrides keys, the FE PlanLimits
  // mirror and the guard's usage switch share the same column names.
  AI_PHOTOS = "maxMonthlyAiPhotos",
  AI_VIDEOS = "maxMonthlyAiVideos",
}

/**
 * Decorator to check if a limit has been reached before performing an action
 * @param limitType - The type of limit to check
 */
export const CheckLimit = (limitType: LimitType) =>
  SetMetadata(CHECK_LIMIT_KEY, limitType);
