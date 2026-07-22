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
  AI_3D_MODELS = "maxMonthlyAi3dModels",

  // Device-mesh capacity add-ons (DEF-7 / Task 6). Values match the
  // marketplace grant keys EXACTLY (prisma/seeds/seed-marketplace.ts:
  // kds_extra_screen -> "limit.kdsScreens", extra_tablet -> "limit.tablets")
  // — deliberately NOT "maxKdsScreens"/"maxTablets" like the plan-backed
  // limits above. Unlike those, neither has a SubscriptionPlan column
  // (PlanConfig.limits / PlanProjectorService.LIMIT_COLUMNS): the cap is
  // 100% add-on-sourced. Because there is no plan baseline, a tenant with
  // no add-on grant and no admin override has NO ceiling to enforce yet —
  // enforcement is SKIPPED in that case (NOT capped at 0, which would brick
  // first-device registration for every tenant that never bought the
  // add-on). It activates with a real finite ceiling once >=1 add-on unit
  // or an admin override exists. A legitimately-set 0 is still honored as a
  // real cap (the skip only triggers on a genuinely-absent key). See
  // PlanFeatureGuard.checkLimit and DeviceService.enforceDeviceCapacity for
  // the production enforcement path — a single multi-kind endpoint,
  // POST /v1/devices, can't use this decorator directly since @CheckLimit
  // is fixed per route, not per request-body kind.
  KDS_SCREENS = "kdsScreens",
  TABLETS = "tablets",

  // NOTE: kds_extra_station ("limit.kdsStations") deliberately has NO
  // member here. KDS "stations" (bar/grill/dessert routing) are not a
  // persisted, countable entity anywhere in the system today —
  // KdsRoutingService fans every order event out to every kds_screen
  // device tenant/branch-wide (see its class docstring: "a single KDS
  // station per branch is the operational default"); there is no
  // station table, no station column on Device, no station DeviceKind.
  // Enforcing a limit here would mean inventing a counting query with
  // nothing real behind it. Add this member only once a real per-station
  // entity exists (see task-6-report.md for the full writeup).
}

/**
 * Decorator to check if a limit has been reached before performing an action
 * @param limitType - The type of limit to check
 */
export const CheckLimit = (limitType: LimitType) =>
  SetMetadata(CHECK_LIMIT_KEY, limitType);
