import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

/**
 * v3.0.0 — read the active branch off the request. Counterpart to
 * `@CurrentUser`/`@CurrentTenant`. The value is populated by
 * BranchGuard on every request that runs through the standard auth
 * pipeline (i.e. not `@Public()`, not `@SkipBranchScope()`).
 *
 * Throws when used on a route without a BranchGuard in scope —
 * propagating `undefined` downstream produces misleading Prisma
 * errors when `where: { ..., branchId: undefined }` silently widens
 * to "any branch".
 */
export const CurrentBranch = createParamDecorator((data: string, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const branchId = request.branchId;
  if (typeof branchId !== 'string' || branchId.length === 0) {
    throw new InternalServerErrorException(
      'CurrentBranch used on a route without an active BranchGuard (or on a @SkipBranchScope route)',
    );
  }
  return data ? request[data] : branchId;
});
