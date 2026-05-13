import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../common/constants/roles.enum';
import {
  ResourceAlreadyExistsException,
  ValidationException,
  InvalidCredentialsException,
} from '../../common/exceptions';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaClient;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    // The refresh-token flow persists the hashed token to the DB and
    // needs the `exp` claim to compute the expiry — auth.service.ts
    // calls `jwtService.decode(refreshToken)` to read it back. Return a
    // far-future exp so the resulting Date is sane in any test run.
    decode: jest.fn(() => ({
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    })),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        JWT_SECRET: 'test-secret',
        JWT_EXPIRES_IN: '7d',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_REFRESH_EXPIRES_IN: '30d',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EmailService,
          useValue: {
            sendVerificationEmail: jest.fn(),
            sendPasswordResetEmail: jest.fn(),
            sendWelcomeEmail: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
            sendToUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);

    // The register path wraps tenant+subscription creation in
    // $transaction(async tx => ...). mockDeep returns undefined by
    // default, so we replay the callback against the same mock client
    // and return whatever the callback resolves to — this matches the
    // real Prisma behaviour closely enough for these unit tests.
    (prisma.$transaction as any).mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      return Promise.all(arg);
    });
    // Re-arm jwtService.decode after the per-test mock reset (afterEach
    // resets the queue, which would otherwise leave generateTokens
    // dereferencing undefined.exp on the next test).
    mockJwtService.decode.mockImplementation(() => ({
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    }));
  });

  afterEach(() => {
    // `clearAllMocks` only resets call history. `resetAllMocks` also
    // empties the `mockReturnValueOnce` queue, which prior tests in this
    // file leaked into successor tests — refreshToken kept seeing the
    // tail of register's queued tokens.
    jest.resetAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new user with new restaurant', async () => {
      const registerDto: RegisterDto = {
        email: 'newadmin@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        restaurantName: 'New Restaurant',
        paymentRegion: 'INTERNATIONAL',
      };

      const mockFreePlan = {
        id: 'plan-free',
        name: 'FREE',
        currency: 'USD',
        monthlyPrice: 0,
        yearlyPrice: 0,
        features: {},
      };

      const mockTenant = {
        id: 'tenant-new',
        name: 'New Restaurant',
        subdomain: 'new-restaurant',
        paymentRegion: 'INTERNATIONAL',
        currentPlanId: 'plan-free',
      };

      const mockUser = {
        id: 'user-new',
        email: 'newadmin@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        tenantId: 'tenant-new',
      };

      // Mock implementations
      prisma.user.findUnique.mockResolvedValue(null); // No existing user
      prisma.tenant.findUnique.mockResolvedValue(null); // No existing tenant
      prisma.subscriptionPlan.findUnique.mockResolvedValue(mockFreePlan as any);
      prisma.tenant.create.mockResolvedValue(mockTenant as any);
      prisma.subscription.create.mockResolvedValue({} as any);
      prisma.user.create.mockResolvedValue(mockUser as any);

      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      // Execute
      const result = await service.register(registerDto);

      // Assertions
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockUser,
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });

      expect(prisma.tenant.create).toHaveBeenCalled();
      expect(prisma.subscription.create).toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if email already exists', async () => {
      const registerDto: RegisterDto = {
        email: 'existing@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        restaurantName: 'Test Restaurant',
      };

      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' } as any);

      await expect(service.register(registerDto)).rejects.toThrow(ResourceAlreadyExistsException);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
    });

    it('should throw BadRequestException if both restaurantName and tenantId provided', async () => {
      const registerDto: RegisterDto = {
        email: 'test@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        restaurantName: 'Test Restaurant',
        tenantId: 'tenant-123',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(ValidationException);
    });

    it('should throw BadRequestException if neither restaurantName nor tenantId provided', async () => {
      const registerDto: RegisterDto = {
        email: 'test@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(ValidationException);
    });

    it('should successfully register a user joining existing tenant', async () => {
      const registerDto: RegisterDto = {
        email: 'waiter@test.com',
        password: 'password123',
        firstName: 'Jane',
        lastName: 'Smith',
        tenantId: 'tenant-existing',
        role: UserRole.WAITER,
      };

      const mockTenant = {
        id: 'tenant-existing',
        name: 'Existing Restaurant',
      };

      const mockUser = {
        id: 'user-waiter',
        email: 'waiter@test.com',
        firstName: 'Jane',
        lastName: 'Smith',
        role: UserRole.WAITER,
        tenantId: 'tenant-existing',
      };

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue(mockTenant as any);
      prisma.user.create.mockResolvedValue(mockUser as any);

      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await service.register(registerDto);

      // Non-ADMIN users joining an existing tenant land in
      // PENDING_APPROVAL — no tokens issued until the restaurant's
      // admin approves them. The response carries `pendingApproval: true`
      // and null tokens so the frontend can show "waiting" instead of
      // logging in. Tokens are minted at /auth/approve, not here.
      expect(result.accessToken).toBeNull();
      expect(result.refreshToken).toBeNull();
      expect((result as any).pendingApproval).toBe(true);
      expect(result.user.email).toBe(registerDto.email);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: registerDto.tenantId },
      });
    });
  });

  describe('login', () => {
    it('should successfully login a user with valid credentials', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'password123',
      };

      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        password: await bcrypt.hash('password123', 10),
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        tokenVersion: 0,
        // auth.service.login() now requires user.tenant.status === ACTIVE
        // before issuing tokens — suspended restaurants don't get a JWT.
        tenant: { status: 'ACTIVE' },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(loginDto.email);
    });

    it('should throw InvalidCredentialsException for unknown email', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'wrongpassword',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      // auth.service throws the typed InvalidCredentialsException (which
      // extends BusinessException, not UnauthorizedException). The
      // http-exception filter renders it as 401, but unit-level tests
      // assert on the typed exception itself.
      await expect(service.login(loginDto)).rejects.toThrow(InvalidCredentialsException);
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'password123',
      };

      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        password: await bcrypt.hash('password123', 10),
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        status: 'INACTIVE',
        tenantId: 'tenant-1',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateUser', () => {
    it('should return user data without password for valid credentials', async () => {
      const email = 'test@test.com';
      const password = 'password123';

      const mockUser = {
        id: 'user-1',
        email,
        password: await bcrypt.hash(password, 10),
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        tokenVersion: 0,
        // auth.service.login() now requires user.tenant.status === ACTIVE
        // before issuing tokens — suspended restaurants don't get a JWT.
        tenant: { status: 'ACTIVE' },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);

      const result = await service.validateUser(email, password);

      expect(result).toBeDefined();
      expect(result.email).toBe(email);
      expect(result.password).toBeUndefined();
    });

    it('should return null for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('nonexistent@test.com', 'password123');

      expect(result).toBeNull();
    });

    it('should return null for wrong password', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        password: await bcrypt.hash('correctpassword', 10),
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        tokenVersion: 0,
        // auth.service.login() now requires user.tenant.status === ACTIVE
        // before issuing tokens — suspended restaurants don't get a JWT.
        tenant: { status: 'ACTIVE' },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);

      const result = await service.validateUser('test@test.com', 'wrongpassword');

      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh tokens', async () => {
      const refreshToken = 'valid-refresh-token';
      const mockPayload = {
        sub: 'user-1',
        email: 'test@test.com',
        role: UserRole.ADMIN,
        tenantId: 'tenant-1',
      };

      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        tokenVersion: 0,
        // auth.service.login() now requires user.tenant.status === ACTIVE
        // before issuing tokens — suspended restaurants don't get a JWT.
        tenant: { status: 'ACTIVE' },
      };

      mockJwtService.verify.mockReturnValue(mockPayload);
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      mockJwtService.sign.mockReturnValueOnce('new-access-token').mockReturnValueOnce('new-refresh-token');

      // auth.service.refreshToken hashes the token, atomically revokes
      // the old refresh row, and re-fetches it to issue a new pair. The
      // findUnique result must look ACTIVE-and-unexpired for the flow
      // to continue past line 499.
      (prisma.refreshToken.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.refreshToken.findUnique as any).mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'irrelevant-hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: null,
      });
      // create() is invoked to persist the new refresh token.
      (prisma.refreshToken.create as any).mockResolvedValue({ id: 'rt-2' });

      const result = await service.refreshToken(refreshToken);

      expect(result).toHaveProperty('accessToken', 'new-access-token');
      expect(result).toHaveProperty('refreshToken', 'new-refresh-token');
      expect(result).toHaveProperty('user');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      const mockPayload = {
        sub: 'user-1',
        email: 'test@test.com',
      };

      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        status: 'INACTIVE',
      };

      mockJwtService.verify.mockReturnValue(mockPayload);
      prisma.user.findUnique.mockResolvedValue(mockUser as any);

      await expect(service.refreshToken('valid-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const userId = 'user-1';
      const mockUser = {
        id: userId,
        email: 'test@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        tenantId: 'tenant-1',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);

      const result = await service.getProfile(userId);

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
        },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow(UnauthorizedException);
    });
  });
});
