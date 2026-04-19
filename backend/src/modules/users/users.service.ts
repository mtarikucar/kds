import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto, UpdateEmailDto } from './dto/update-profile.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../../common/constants/roles.enum';

const LIST_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  tenantId: true,
  approvedAt: true,
  approvedById: true,
  approvedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  reactivatedAt: true,
  reactivatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface UserListFilters {
  status?: string;
  role?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
  ) {}

  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 15 ? parsed : 12;
  }

  /**
   * Count active ADMINs in a tenant, excluding an optional user id
   * (the one we're about to demote / deactivate). Used to block the
   * "orphan tenant" case where the last admin loses admin powers.
   */
  private async countActiveAdminsExcept(
    tenantId: string,
    excludeUserId?: string,
  ): Promise<number> {
    return this.prisma.user.count({
      where: {
        tenantId,
        role: UserRole.ADMIN,
        status: 'ACTIVE',
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
    });
  }

  private async assertNotLastAdmin(
    targetUserId: string,
    tenantId: string,
  ): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { role: true, status: true },
    });
    if (!target) return;
    if (target.role !== UserRole.ADMIN || target.status !== 'ACTIVE') return;
    const otherAdmins = await this.countActiveAdminsExcept(tenantId, targetUserId);
    if (otherAdmins === 0) {
      throw new BadRequestException(
        'Cannot demote or deactivate the last active admin of this restaurant',
      );
    }
  }

  async create(
    createUserDto: CreateUserDto,
    tenantId: string,
    actor: { id: string; role: string },
  ) {
    // A MANAGER must not be able to mint an ADMIN — that would be a
    // privilege escalation. Only an existing ADMIN can create ADMINs.
    if (createUserDto.role === UserRole.ADMIN && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an ADMIN can create another ADMIN');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });
    if (existingUser) {
      // Generic message — prevents cross-tenant email enumeration.
      throw new ConflictException('Email is not available');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, this.bcryptCost());

    return this.prisma.user.create({
      data: {
        email: createUserDto.email,
        password: hashedPassword,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        role: createUserDto.role,
        // Admin/Manager-created accounts are already vetted — skip the
        // PENDING_APPROVAL flow used by public self-registration.
        status: 'ACTIVE',
        tenantId,
      },
      select: LIST_SELECT,
    });
  }

  async findAll(tenantId: string, filters: UserListFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));

    const where: Prisma.UserWhereInput = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.role) where.role = filters.role;
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: LIST_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    tenantId: string,
    actor: { id: string; role: string },
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, role: true, email: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Role changes are privileged: only ADMIN can do them, and nobody can
    // change their own role (avoids "MANAGER promotes self to ADMIN").
    if (dto.role !== undefined && dto.role !== existing.role) {
      if (actor.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Only ADMIN can change roles');
      }
      if (actor.id === id) {
        throw new ForbiddenException('You cannot change your own role');
      }
      // If the target is currently the only active admin, don't demote.
      if (
        existing.role === UserRole.ADMIN &&
        dto.role !== UserRole.ADMIN &&
        existing.status === 'ACTIVE'
      ) {
        const otherAdmins = await this.countActiveAdminsExcept(tenantId, id);
        if (otherAdmins === 0) {
          throw new BadRequestException(
            'Cannot demote the last active admin of this restaurant',
          );
        }
      }
    }

    if (dto.email && dto.email !== existing.email) {
      const collision = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (collision && collision.id !== id) {
        throw new ConflictException('Email is not available');
      }
    }

    // Build the update object explicitly — never spread the DTO into
    // Prisma data, since future DTO fields would silently become updatable.
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, this.bcryptCost());
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: LIST_SELECT,
    });
  }

  async remove(id: string, tenantId: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Cannot deactivate the only remaining active admin.
    await this.assertNotLastAdmin(id, tenantId);

    // Soft delete. Tombstone the email so the same address can be used
    // to sign up again (global uniqueness otherwise blocks re-hires and
    // role-based addresses like info@restaurant.com).
    const tombstonedEmail = target.email.endsWith('@tombstone.kds')
      ? target.email
      : `${target.email}+deleted-${id}@tombstone.kds`;

    return this.prisma.user.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        email: tombstonedEmail,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });
  }

  /**
   * Update current user's profile
   */
  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateProfileDto,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        status: true,
        emailVerified: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Update user email (requires password confirmation)
   */
  async updateEmail(userId: string, updateEmailDto: UpdateEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(
      updateEmailDto.currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: updateEmailDto.email },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email is not available');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: updateEmailDto.email,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        status: true,
        emailVerified: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    try {
      await this.authService.sendEmailVerification(userId);
    } catch (error) {
      console.error('Failed to send verification email after email update:', error);
    }

    return updatedUser;
  }

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        status: true,
        emailVerified: true,
        lastLogin: true,
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            subdomain: true,
            status: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Approve a pending user. Uses a conditional updateMany so two admins
   * racing to approve the same user don't both flip approvedById — only
   * the first write sees status=PENDING_APPROVAL.
   */
  async approveUser(userId: string, approverId: string, tenantId: string) {
    const result = await this.prisma.user.updateMany({
      where: {
        id: userId,
        tenantId,
        status: 'PENDING_APPROVAL',
      },
      data: {
        status: 'ACTIVE',
        approvedAt: new Date(),
        approvedById: approverId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Onay bekleyen kullanıcı bulunamadı');
    }

    return this.prisma.user.findUnique({
      where: { id: userId },
      select: LIST_SELECT,
    });
  }

  /**
   * Reactivate an inactive user. Re-checks the plan's maxUsers limit
   * inside a transaction (the guard pre-check is TOCTOU-racy when two
   * reactivations happen concurrently).
   */
  async reactivateUser(userId: string, tenantId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: userId, tenantId, status: 'INACTIVE' },
      });
      if (!target) {
        throw new NotFoundException('Pasif kullanıcı bulunamadı');
      }

      const subscription = await tx.subscription.findFirst({
        where: { tenantId, status: { in: ['ACTIVE', 'TRIALING'] } },
        include: { plan: true },
      });
      if (!subscription?.plan) {
        throw new ForbiddenException('No active subscription found');
      }
      if (subscription.plan.maxUsers !== -1) {
        const activeCount = await tx.user.count({
          where: { tenantId, status: 'ACTIVE' },
        });
        if (activeCount >= subscription.plan.maxUsers) {
          throw new ForbiddenException(
            `User limit reached (${subscription.plan.maxUsers}). Upgrade your plan to add more users.`,
          );
        }
      }

      // Restore the original email if it was tombstoned during soft-delete.
      const emailUpdate = target.email.includes('+deleted-')
        ? { email: target.email.replace(/\+deleted-[^@]+@tombstone\.kds$/, '') }
        : {};

      return tx.user.update({
        where: { id: userId },
        data: {
          status: 'ACTIVE',
          reactivatedAt: new Date(),
          reactivatedById: actorId,
          // Stale approval data is cleared so audit reflects "reactivation,
          // not original approval."
          approvedAt: null,
          approvedById: null,
          ...emailUpdate,
        },
        select: LIST_SELECT,
      });
    });
  }

  /**
   * Reject a pending user via soft delete (status REJECTED + tombstone
   * email). Hard delete would break FK relations if any related row exists.
   */
  async rejectUser(userId: string, tenantId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, status: 'PENDING_APPROVAL' },
      select: { id: true, email: true },
    });
    if (!target) {
      throw new NotFoundException('Onay bekleyen kullanıcı bulunamadı');
    }

    const tombstonedEmail = target.email.endsWith('@tombstone.kds')
      ? target.email
      : `${target.email}+rejected-${userId}@tombstone.kds`;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'REJECTED',
        email: tombstonedEmail,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
  }

  async getOnboarding(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingData: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const defaultOnboarding = {
      hasSeenWelcome: false,
      tourProgress: {},
      skipAllTours: false,
    };

    return user.onboardingData || defaultOnboarding;
  }

  async updateOnboarding(userId: string, updateOnboardingDto: UpdateOnboardingDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingData: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentData = (user.onboardingData as any) || {
      hasSeenWelcome: false,
      tourProgress: {},
      skipAllTours: false,
    };

    const updatedData = {
      hasSeenWelcome:
        updateOnboardingDto.hasSeenWelcome ?? currentData.hasSeenWelcome ?? false,
      skipAllTours:
        updateOnboardingDto.skipAllTours ?? currentData.skipAllTours ?? false,
      tourProgress: {
        ...(currentData.tourProgress || {}),
        ...(updateOnboardingDto.tourProgress || {}),
      },
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingData: updatedData as any },
    });

    return updatedData;
  }
}
