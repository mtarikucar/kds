import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  role: string;

  @ApiProperty()
  tenantId: string;

  /**
   * v3.0.0 — the user's home branch.
   *
   * The frontend's `branchScopeStore` hydrates from this on login.
   * Hard-restricted roles always carry a non-null primaryBranchId
   * (DB CHECK constraint); ADMIN/MANAGER may carry null when they
   * legitimately roam (in that case the SPA forces an explicit
   * BranchPicker selection before any branch-scoped request fires).
   */
  @ApiProperty({ type: String, nullable: true })
  primaryBranchId: string | null;

  /**
   * v3.0.0 — branches the user may target via the BranchPicker /
   * X-Branch-Id header.
   *
   * - ADMIN with `[]` is the wildcard owner account — can access any
   *   active branch in the tenant.
   * - MANAGER must have every roam-able branch listed; explicit row
   *   in `user_branch_assignments` per entry.
   * - WAITER/KITCHEN/COURIER carry a single-element array equal to
   *   primaryBranchId; BranchGuard ignores it for those roles anyway.
   */
  @ApiProperty({ type: [String] })
  allowedBranchIds: string[];
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
