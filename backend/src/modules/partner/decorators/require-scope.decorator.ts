import { SetMetadata } from "@nestjs/common";
import { PartnerScope } from "../partner.constants";

/** Declares the scope a /display endpoint requires; enforced by ScreenScopeGuard. */
export const REQUIRED_SCOPE_KEY = "requiredScope";
export const RequireScope = (scope: PartnerScope) =>
  SetMetadata(REQUIRED_SCOPE_KEY, scope);
