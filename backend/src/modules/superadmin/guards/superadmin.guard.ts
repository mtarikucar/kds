import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_SUPERADMIN_PUBLIC_KEY } from '../decorators/superadmin.decorator';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SuperAdminJwtPayload {
  sub: string;
  email: string;
  type: 'superadmin';
}

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_SUPERADMIN_PUBLIC_KEY,
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
      const payload = await this.jwtService.verifyAsync<SuperAdminJwtPayload>(
        token,
        {
          secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
        },
      );

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

      request.superAdmin = superAdmin;
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
