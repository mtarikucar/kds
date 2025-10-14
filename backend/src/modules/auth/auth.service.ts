import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { UserRole } from '../../common/constants/roles.enum';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    // Validate registration data
    const hasRestaurantName = !!registerDto.restaurantName;
    const hasTenantId = !!registerDto.tenantId;

    // Mutual exclusion: cannot provide both
    if (hasRestaurantName && hasTenantId) {
      throw new BadRequestException('Cannot provide both restaurantName and tenantId');
    }

    // One of them must be provided
    if (!hasRestaurantName && !hasTenantId) {
      throw new BadRequestException('Either restaurantName or tenantId must be provided');
    }

    let tenantId: string;
    let userRole = registerDto.role;

    // Scenario 1: Creating a new restaurant (ADMIN only)
    if (hasRestaurantName) {
      // If creating a restaurant, role must be ADMIN (or default to ADMIN)
      if (userRole && userRole !== UserRole.ADMIN) {
        throw new BadRequestException('Only ADMIN role is allowed when creating a new restaurant');
      }
      userRole = UserRole.ADMIN;

      // Generate a subdomain from restaurant name
      const subdomain = registerDto.restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Check if subdomain already exists, if so, append a random string
      let finalSubdomain = subdomain;
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { subdomain },
      });

      if (existingTenant) {
        finalSubdomain = `${subdomain}-${Math.random().toString(36).substring(2, 8)}`;
      }

      // Get FREE plan
      const freePlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: 'FREE' },
      });

      if (!freePlan) {
        throw new BadRequestException('FREE plan not found. Please seed the database.');
      }

      // Create new tenant with FREE subscription
      const tenant = await this.prisma.tenant.create({
        data: {
          name: registerDto.restaurantName,
          subdomain: finalSubdomain,
          paymentRegion: registerDto.paymentRegion || 'INTERNATIONAL',
          currentPlanId: freePlan.id,
        },
      });

      // Create FREE subscription for new tenant
      const now = new Date();
      const currentPeriodEnd = new Date(now);
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 10); // FREE plan never expires

      await this.prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: freePlan.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          paymentProvider: registerDto.paymentRegion === 'TURKEY' ? 'IYZICO' : 'STRIPE',
          startDate: now,
          currentPeriodStart: now,
          currentPeriodEnd: currentPeriodEnd,
          isTrialPeriod: false,
          amount: 0,
          currency: freePlan.currency,
          autoRenew: true,
          cancelAtPeriodEnd: false,
        },
      });

      tenantId = tenant.id;
    }
    // Scenario 2: Joining an existing restaurant
    else {
      // Verify tenant exists
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: registerDto.tenantId },
      });

      if (!tenant) {
        throw new BadRequestException('Invalid tenant');
      }

      // Cannot join as ADMIN (ADMIN creates their own restaurant)
      if (userRole === UserRole.ADMIN) {
        throw new BadRequestException('Cannot join existing restaurant as ADMIN. ADMIN must create their own restaurant.');
      }

      // Default to WAITER if no role provided
      if (!userRole) {
        userRole = UserRole.WAITER;
      }

      tenantId = registerDto.tenantId;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        password: hashedPassword,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: userRole,
        tenantId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    return this.generateTokens(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
      },
    });

    if (!user) {
      return null;
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async refreshToken(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
        },
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('User not found or inactive');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async generateTokens(user: UserResponseDto): Promise<AuthResponseDto> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '7d',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d',
    });

    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
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

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
