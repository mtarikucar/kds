import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

export interface MarketingJwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'marketing';
}

@Injectable()
export class MarketingJwtStrategy extends PassportStrategy(
  Strategy,
  'marketing-jwt',
) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('MARKETING_JWT_SECRET'),
    });
  }

  async validate(payload: MarketingJwtPayload) {
    if (payload.type !== 'marketing') {
      throw new UnauthorizedException('Invalid token type');
    }

    const marketingUser = await this.prisma.marketingUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    if (!marketingUser || marketingUser.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    return marketingUser;
  }
}
