import { SetMetadata } from '@nestjs/common';

/**
 * v3.0.0 — opt-out marker for `BranchGuard`. Routes that are
 * legitimately tenant-wide (billing, marketing leads, marketplace
 * checkout, user profile / `/me`, branches CRUD itself, etc.) carry
 * this decorator so the guard skips the branch-resolve + validation
 * step. Without this, every controller would have to either receive
 * a branchId (impossible for tenant-level endpoints) or be marked
 * `@Public()` (incorrect — they still need auth).
 *
 * The metadata key is consumed by:
 *   - BranchGuard (skips the canActivate body when set)
 *   - guard-bypass.helper.ts (NOT a global-auth bypass; auth still
 *     runs, just the branch slice is skipped)
 *
 * Apply at controller class level when the entire controller is
 * tenant-wide; apply per-method when only some endpoints are.
 */
export const IS_SKIP_BRANCH_SCOPE_KEY = 'isSkipBranchScope';
export const SkipBranchScope = () => SetMetadata(IS_SKIP_BRANCH_SCOPE_KEY, true);
