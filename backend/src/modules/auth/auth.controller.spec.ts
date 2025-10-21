import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../common/constants/roles.enum';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    getProfile: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      const registerDto: RegisterDto = {
        email: 'newuser@test.com',
        password: 'password123',
        firstName: 'Jane',
        lastName: 'Smith',
        restaurantName: 'New Restaurant',
      };

      mockAuthService.register.mockResolvedValue(mockAuthResponse);

      const result = await controller.register(registerDto);

      expect(result).toEqual(mockAuthResponse);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(authService.register).toHaveBeenCalledTimes(1);
    });

    it('should call authService.register with correct parameters', async () => {
      const registerDto: RegisterDto = {
        email: 'test@test.com',
        password: 'pass123',
        firstName: 'Test',
        lastName: 'User',
        tenantId: 'tenant-existing',
        role: UserRole.WAITER,
      };

      mockAuthService.register.mockResolvedValue(mockAuthResponse);

      await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });
  });

  describe('login', () => {
    it('should successfully login a user', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'password123',
      };

      mockAuthService.login.mockResolvedValue(mockAuthResponse);

      const result = await controller.login(loginDto);

      expect(result).toEqual(mockAuthResponse);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(authService.login).toHaveBeenCalledTimes(1);
    });

    it('should return tokens and user data on successful login', async () => {
      const loginDto: LoginDto = {
        email: 'admin@test.com',
        password: 'admin123',
      };

      mockAuthService.login.mockResolvedValue(mockAuthResponse);

      const result = await controller.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(mockAuthResponse.user.email);
    });
  });

  describe('refresh', () => {
    it('should successfully refresh access token', async () => {
      const refreshToken = 'valid-refresh-token';

      mockAuthService.refreshToken.mockResolvedValue(mockAuthResponse);

      const result = await controller.refresh(refreshToken);

      expect(result).toEqual(mockAuthResponse);
      expect(authService.refreshToken).toHaveBeenCalledWith(refreshToken);
      expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    });

    it('should return new tokens on successful refresh', async () => {
      const refreshToken = 'test-refresh-token';

      const newAuthResponse = {
        ...mockAuthResponse,
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockAuthService.refreshToken.mockResolvedValue(newAuthResponse);

      const result = await controller.refresh(refreshToken);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
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
      expect(authService.getProfile).toHaveBeenCalledTimes(1);
    });

    it('should call authService.getProfile with userId from decorator', async () => {
      const userId = 'user-123';

      mockAuthService.getProfile.mockResolvedValue(mockAuthResponse.user);

      await controller.getProfile(userId);

      expect(authService.getProfile).toHaveBeenCalledWith(userId);
    });
  });
});
