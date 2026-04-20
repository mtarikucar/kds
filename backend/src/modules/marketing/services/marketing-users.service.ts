import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMarketingUserDto } from '../dto/create-marketing-user.dto';
import { UpdateMarketingUserDto } from '../dto/update-marketing-user.dto';

@Injectable()
export class MarketingUsersService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 15 ? parsed : 12;
  }

  async create(dto: CreateMarketingUserDto) {
    const existing = await this.prisma.marketingUser.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, this.bcryptCost());

    return this.prisma.marketingUser.create({
      data: {
        ...dto,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async findAll() {
    return this.prisma.marketingUser.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        lastLogin: true,
        createdAt: true,
        _count: {
          select: { leads: true, activities: true, commissions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.marketingUser.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        status: true,
        lastLogin: true,
        createdAt: true,
        _count: {
          select: { leads: true, activities: true, commissions: true, tasks: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateMarketingUserDto) {
    const user = await this.prisma.marketingUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const data: any = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.marketingUser.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
      },
    });
  }

  async delete(id: string) {
    const user = await this.prisma.marketingUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.marketingUser.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    return { message: 'User deactivated successfully' };
  }
}
