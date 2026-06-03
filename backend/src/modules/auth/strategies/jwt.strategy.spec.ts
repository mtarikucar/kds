import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { mockPrismaClient, mockUser } from '../../../common/test/prisma-mock.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: ReturnType<typeof mockPrismaClient>;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        JWT_SECRET: 'test-secret',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should return user when valid JWT payload is provided', async () => {
      const payload = {
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        tenantId: mockUser.tenantId,
      };

      const fullUser = {
        ...mockUser,
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        emailVerified: true,
        emailVerificationCode: null,
        emailVerificationCodeExpires: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        lastLoginAt: null,
        phoneNumber: null,
        // jwt.strategy joins through tenant.status — without an ACTIVE
        // tenant on the mock, every validate() call throws "restaurant
        // account is not active". tokenVersion=0 must match the
        // payload.ver=0 default below.
        tokenVersion: 0,
        tenant: { status: 'ACTIVE' },
      };

      prisma.user.findUnique.mockResolvedValue(fullUser as any);

      const result = await strategy.validate(payload);

      // The strategy strips `tenant` and `tokenVersion` from the
      // returned user, and v3.0.0 appends `activeBranchId` +
      // `allowedBranchIds` from the JWT payload (defaults: null + []
      // when the legacy-shape payload omits them).
      const { tenant: _t, tokenVersion: _v, ...expected } = fullUser as any;
      expect(result).toEqual({
        ...expected,
        activeBranchId: null,
        allowedBranchIds: [],
      });
      expect(prisma.user.findUnique).toHaveBeenCalled();
    });

    it('returns activeBranchId + allowedBranchIds verbatim from the JWT payload', async () => {
      const payload = {
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        tenantId: mockUser.tenantId,
        primaryBranchId: 'b-primary',
        activeBranchId: 'b-active',
        allowedBranchIds: ['b-primary', 'b-other'],
      };
      const fullUser = {
        ...mockUser,
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        tokenVersion: 0,
        primaryBranchId: 'b-primary',
        tenant: { status: 'ACTIVE' },
      };
      prisma.user.findUnique.mockResolvedValue(fullUser as any);

      const result = await strategy.validate(payload);

      expect(result).toMatchObject({
        primaryBranchId: 'b-primary',
        activeBranchId: 'b-active',
        allowedBranchIds: ['b-primary', 'b-other'],
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      const payload = {
        sub: 'non-existent-user',
        email: 'test@test.com',
        role: 'ADMIN',
        tenantId: 'tenant-1',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return user data when found (email verification checked in auth flow)', async () => {
      const payload = {
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        tenantId: mockUser.tenantId,
      };

      const fullUser = {
        ...mockUser,
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        emailVerified: true,
        emailVerificationCode: null,
        emailVerificationCodeExpires: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        lastLoginAt: null,
        phoneNumber: null,
        // jwt.strategy joins through tenant.status — without an ACTIVE
        // tenant on the mock, every validate() call throws "restaurant
        // account is not active". tokenVersion=0 must match the
        // payload.ver=0 default below.
        tokenVersion: 0,
        tenant: { status: 'ACTIVE' },
      };

      prisma.user.findUnique.mockResolvedValue(fullUser as any);

      const result = await strategy.validate(payload);

      expect(result).toBeTruthy();
    });
  });
});
