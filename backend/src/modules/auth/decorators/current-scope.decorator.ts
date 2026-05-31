import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BranchScope } from '../../../common/scoping/branch-scope';

/**
 * Extract the resolved `BranchScope` ({tenantId, branchId, userId,
 * role}) BranchGuard attached to the request.
 *
 * Use as the first parameter on every branch-scoped controller method.
 * The presence of this decorator on a handler is what the CI
 * `controller-needs-scope-or-skip` lint rule looks for; routes without
 * either this or `@SkipBranchScope()` are flagged at build time.
 *
 *   @Post()
 *   create(@CurrentScope() scope: BranchScope, @Body() dto: CreateDto) {
 *     return this.service.create(scope, dto);
 *   }
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BranchScope => {
    const request = ctx.switchToHttp().getRequest();
    if (!request.scope) {
      // BranchGuard sets req.scope. A missing scope here means either
      // the route bypassed the guard (it should carry @SkipBranchScope)
      // or guards ran out of order — both are bugs the request layer
      // must surface, not paper over.
      throw new Error(
        'CurrentScope decorator used on a route without BranchGuard. ' +
          'Annotate the controller with @SkipBranchScope() if tenant-wide ' +
          'or fix the guard chain.',
      );
    }
    return request.scope;
  },
);
