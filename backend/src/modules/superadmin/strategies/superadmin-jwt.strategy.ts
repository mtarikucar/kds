import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  type: 'superadmin';
}

@Injectable()
export class SuperAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'superadmin-jwt',
) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('SUPERADMIN_JWT_SECRET'),
    });
  }

  async validate(payload: SuperAdminJwtPayload) {
    if (payload.type !== 'superadmin') {
      throw new UnauthorizedException('Invalid token type');
    }

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        twoFactorEnabled: true,
      },
    });

    if (!superAdmin || superAdmin.status !== 'ACTIVE') {
      throw new UnauthorizedException('SuperAdmin not found or inactive');
    }

    return superAdmin;
  }
}
