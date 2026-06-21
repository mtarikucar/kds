import { Test, TestingModule } from '@nestjs/testing';
import { Response, Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './services/token.service';
import { DemoService } from '../demo/demo.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Controller-level tests focus on the thin wrapper between Nest's
 * decorators and the AuthService. Cookie writes and req/res plumbing
 * land in this layer; the actual auth logic is unit-tested separately
 * in auth.service.spec.ts.
 */
describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    getProfile: jest.fn(),
  };

  const mockDemoService = {
    ensureDemoTenant: jest.fn(),
  };

  const mockTokenService = {
    issueDemoAccessToken: jest.fn(),
  };

  const mockAuthResponse = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    user: {
      id: 'user-1',
      email: 'test@test.com',
      firstName: 'John',
      lastName: 'Doe',
      role: UserRole.ADMIN,
      tenantId: 'tenant-1',
    },
  };

  // Minimal Express stubs so the controller's @Res() handler can call
  // res.cookie() without blowing up. The implementation chain (`cookie`
  // returns `this`) lets multiple calls chain.
  const buildMockRes = (): Response => {
    const res: any = {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    };
    return res;
  };

  const buildMockReq = (extra: Partial<Request> = {}): Request => {
    return {
      headers: {},
      ip: '127.0.0.1',
      cookies: {},
      ...extra,
    } as unknown as Request;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: DemoService,
          useValue: mockDemoService,
        },
        {
          provide: TokenService,
          useValue: mockTokenService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('register', () => {
    it('delegates to AuthService.register and strips the refresh token from the body', async () => {
      const registerDto: RegisterDto = {
        email: 'newuser@test.com',
        password: 'password123',
        firstName: 'Jane',
        lastName: 'Smith',
        restaurantName: 'New Restaurant',
      };
      mockAuthService.register.mockResolvedValue(mockAuthResponse);
      const res = buildMockRes();

      const result = await controller.register(registerDto, res);

      // Controller calls stripRefresh() before returning, so the
      // refreshToken is in the cookie (set on res) but not the body.
      expect(result.accessToken).toBe('test-access-token');
      expect(result.user).toEqual(mockAuthResponse.user);
      expect((result as any).refreshToken).toBeUndefined();
      expect(res.cookie).toHaveBeenCalled();
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });

    it('does not set a refresh cookie for PENDING_APPROVAL registrations (no token)', async () => {
      const registerDto: RegisterDto = {
        email: 'staff@test.com',
        password: 'password123',
        firstName: 'Bob',
        lastName: 'Marley',
        tenantId: 'tenant-existing',
        role: UserRole.WAITER,
      };
      mockAuthService.register.mockResolvedValue({
        ...mockAuthResponse,
        accessToken: null,
        refreshToken: null,
        pendingApproval: true,
      });
      const res = buildMockRes();

      await controller.register(registerDto, res);

      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('delegates to AuthService.login and strips refresh token from the body', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'password123',
      };
      mockAuthService.login.mockResolvedValue(mockAuthResponse);
      const req = buildMockReq();
      const res = buildMockRes();

      const result = await controller.login(loginDto, req, res);

      expect(result.accessToken).toBe('test-access-token');
      expect(result.user.email).toBe(mockAuthResponse.user.email);
      expect((result as any).refreshToken).toBeUndefined();
      expect(res.cookie).toHaveBeenCalled();
      expect(authService.login).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('forwards the userId from the CurrentUser decorator to the service', async () => {
      const userId = 'user-1';
      const userProfile = {
        id: userId,
        email: 'test@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        tenantId: 'tenant-1',
      };
      mockAuthService.getProfile.mockResolvedValue(userProfile);

      const result = await controller.getProfile(userId);

      expect(result).toEqual(userProfile);
      expect(authService.getProfile).toHaveBeenCalledWith(userId);
    });
  });

  describe('demoSession', () => {
    it('ensures the demo tenant, mints a demo token, and returns the demo user (isDemo)', async () => {
      mockDemoService.ensureDemoTenant.mockResolvedValue({
        id: 'demo-1',
        email: 'demo-admin@demo.hummytummy.local',
        firstName: 'Demo',
        lastName: 'Yönetici',
        role: UserRole.ADMIN,
        tenantId: 'demo-tenant',
        phone: '+905550000000',
        locale: null,
      });
      mockTokenService.issueDemoAccessToken.mockResolvedValue({
        accessToken: 'demo-access-token',
        primaryBranchId: 'demo-branch',
      });

      const result = await controller.demoSession();

      expect(mockDemoService.ensureDemoTenant).toHaveBeenCalledTimes(1);
      expect(mockTokenService.issueDemoAccessToken).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBe('demo-access-token');
      expect(result.user).toMatchObject({
        id: 'demo-1',
        email: 'demo-admin@demo.hummytummy.local',
        tenantId: 'demo-tenant',
        primaryBranchId: 'demo-branch',
        allowedBranchIds: [],
        isDemo: true,
      });
    });
  });
});
