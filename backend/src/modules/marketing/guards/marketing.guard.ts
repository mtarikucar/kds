import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_MARKETING_PUBLIC_KEY } from '../decorators/marketing-public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketingJwtPayload } from '../types';

@Injectable()
export class MarketingGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_MARKETING_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync<MarketingJwtPayload>(
        token,
        {
          secret: this.configService.get<string>('MARKETING_JWT_SECRET'),
        },
      );

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

      request.marketingUser = marketingUser;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
