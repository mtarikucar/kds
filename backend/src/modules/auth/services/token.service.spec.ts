import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TokenService } from './token.service';

/**
 * Direct spec for TokenService — the refresh-rotation security seam:
 *  - hashToken is a plain sha256 hex (stable, used as the DB key)
 *  - refreshToken: bad signature → 401, wrong token type → 401, missing/expired
 *    stored row → 401, inactive user/tenant → 401, stale ver → "revoked", and
 *    the family-revoke theft branch when the atomic claim affects 0 rows
 *  - revokeAllForUser revokes every active row
 */
function makeJwt() {
  return {
    sign: jest.fn().mockReturnValue('signed'),
    verify: jest.fn(),
    decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  };
}
function makePrisma() {
  return {
    user: { findUnique: jest.fn() },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}
const config = { get: (k: string) => (k.includes('SECRET') ? 'secret' : '15m') } as any;

const activeUser = {
  id: 'u1',
  email: 'u@test.com',
  firstName: 'A',
  lastName: 'B',
  role: 'ADMIN',
  status: 'ACTIVE',
  tenantId: 't1',
  tokenVersion: 2,
  tenant: { status: 'ACTIVE' },
};

describe('TokenService.hashToken', () => {
  it('produces the sha256 hex of the input', () => {
    const svc = new TokenService(makePrisma() as any, makeJwt() as any, config);
    const expected = createHash('sha256').update('abc').digest('hex');
    expect(svc.hashToken('abc')).toBe(expected);
  });
});

describe('TokenService.refreshToken', () => {
  function svcWith(jwt: any, prisma: any) {
    return new TokenService(prisma as any, jwt as any, config);
  }

  it('throws when the JWT signature is invalid', async () => {
    const jwt = makeJwt();
    jwt.verify.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const svc = svcWith(jwt, makePrisma());
    await expect(svc.refreshToken('bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws on a non-user token type', async () => {
    const jwt = makeJwt();
    jwt.verify.mockReturnValue({ type: 'superadmin', sub: 'x', ver: 0 });
    const svc = svcWith(jwt, makePrisma());
    await expect(svc.refreshToken('tok')).rejects.toThrow(/Invalid token type/);
  });

  it('throws when the stored refresh row is missing', async () => {
    const jwt = makeJwt();
    jwt.verify.mockReturnValue({ type: 'user', ver: 2 });
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    const svc = svcWith(jwt, prisma);
    await expect(svc.refreshToken('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the stored row is expired', async () => {
    const jwt = makeJwt();
    jwt.verify.mockReturnValue({ type: 'user', ver: 2 });
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue({
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1000),
    });
    const svc = svcWith(jwt, prisma);
    await expect(svc.refreshToken('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the user is inactive', async () => {
    const jwt = makeJwt();
    jwt.verify.mockReturnValue({ type: 'user', ver: 2 });
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue({
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10000),
    });
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, status: 'INACTIVE' });
    const svc = svcWith(jwt, prisma);
    await expect(svc.refreshToken('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws "revoked" when the token version is stale (no family revoke)', async () => {
    const jwt = makeJwt();
    jwt.verify.mockReturnValue({ type: 'user', ver: 1 }); // user.tokenVersion is 2
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue({
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10000),
    });
    prisma.user.findUnique.mockResolvedValue(activeUser);
    const svc = svcWith(jwt, prisma);
    await expect(svc.refreshToken('tok')).rejects.toThrow(/revoked/i);
    // stale-ver path must NOT family-revoke
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('detects reuse (claim count 0) and family-revokes the user', async () => {
    const jwt = makeJwt();
    jwt.verify.mockReturnValue({ type: 'user', ver: 2 });
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue({
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10000),
    });
    prisma.user.findUnique.mockResolvedValue(activeUser);
    // first updateMany = atomic claim → count 0 (already revoked)
    prisma.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 3 }); // family revoke
    const svc = svcWith(jwt, prisma);
    await expect(svc.refreshToken('tok')).rejects.toThrow(/reuse detected/i);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(2);
    // the family revoke targets all of the user's active tokens
    expect(prisma.refreshToken.updateMany.mock.calls[1][0].where).toMatchObject({
      userId: 'u1',
      revokedAt: null,
    });
  });
});

describe('TokenService.revokeAllForUser', () => {
  it('revokes every active refresh token for the user', async () => {
    const prisma = makePrisma();
    const svc = new TokenService(prisma as any, makeJwt() as any, config);
    await svc.revokeAllForUser('u1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
