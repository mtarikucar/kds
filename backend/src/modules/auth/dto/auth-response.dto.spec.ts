import { plainToInstance } from 'class-transformer';
import { AuthResponseDto, UserResponseDto } from './auth-response.dto';

/**
 * Contract spec for the auth response shape (no validators — these are
 * outbound DTOs). The branch-scope claims are load-bearing for the SPA's
 * branchScopeStore hydration, so we pin the documented contract:
 *   - primaryBranchId is nullable (ADMIN/MANAGER roam case carries null)
 *   - allowedBranchIds is an array (wildcard ADMIN carries [])
 *   - AuthResponseDto nests the full UserResponseDto under `user`
 */
describe('UserResponseDto contract', () => {
  it('round-trips a roaming admin with null primaryBranchId and [] allowedBranchIds', () => {
    const dto = plainToInstance(UserResponseDto, {
      id: 'u1',
      email: 'a@b.c',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      tenantId: 't1',
      primaryBranchId: null,
      allowedBranchIds: [],
    });
    expect(dto.primaryBranchId).toBeNull();
    expect(Array.isArray(dto.allowedBranchIds)).toBe(true);
    expect(dto.allowedBranchIds).toEqual([]);
  });

  it('round-trips a restricted user with a non-null primaryBranchId', () => {
    const dto = plainToInstance(UserResponseDto, {
      id: 'u2',
      email: 'w@b.c',
      firstName: 'W',
      lastName: 'X',
      role: 'WAITER',
      tenantId: 't1',
      primaryBranchId: 'b1',
      allowedBranchIds: ['b1'],
    });
    expect(dto.primaryBranchId).toBe('b1');
    expect(dto.allowedBranchIds).toEqual(['b1']);
  });
});

describe('AuthResponseDto contract', () => {
  it('nests tokens + the full user payload', () => {
    const dto = plainToInstance(AuthResponseDto, {
      accessToken: 'a',
      refreshToken: 'r',
      user: {
        id: 'u1',
        email: 'a@b.c',
        firstName: 'A',
        lastName: 'B',
        role: 'ADMIN',
        tenantId: 't1',
        primaryBranchId: 'b1',
        allowedBranchIds: ['b1', 'b2'],
      },
    });
    expect(dto.accessToken).toBe('a');
    expect(dto.refreshToken).toBe('r');
    expect(dto.user.id).toBe('u1');
    expect(dto.user.allowedBranchIds).toEqual(['b1', 'b2']);
  });
});
