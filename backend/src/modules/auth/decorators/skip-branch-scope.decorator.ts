import { SetMetadata } from "@nestjs/common";

/**
 * Mark a controller or handler as tenant-wide — BranchGuard skips it.
 *
 * Use on endpoints that legitimately operate above the branch axis:
 * billing (`/v1/billing/*`), marketing leads, the /me self-info, the
 * /branches CRUD itself (you can't manage branches under a single-
 * branch scope), and the `/auth/*` family which has no scope yet.
 *
 * Every controller method must be annotated either with this decorator
 * or with `@CurrentScope()` (the latter implicitly requires branch
 * scope by extracting it). The CI lint rule
 * `controller-needs-scope-or-skip` enforces this and is the standing
 * v3.0.0 invariant for new endpoints.
 */
export const IS_SKIP_BRANCH_SCOPE_KEY = "isSkipBranchScope";
export const SkipBranchScope = () =>
  SetMetadata(IS_SKIP_BRANCH_SCOPE_KEY, true);
