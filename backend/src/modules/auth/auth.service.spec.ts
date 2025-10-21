import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../common/constants/roles.enum';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaClient;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
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

      await expect(service.register(registerDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if neither restaurantName nor tenantId provided', async () => {
      const registerDto: RegisterDto = {
        email: 'test@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(BadRequestException);
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

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockUser,
      });

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
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(loginDto.email);
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'wrongpassword',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
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
      };

      mockJwtService.verify.mockReturnValue(mockPayload);
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      mockJwtService.sign.mockReturnValueOnce('new-access-token').mockReturnValueOnce('new-refresh-token');

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
