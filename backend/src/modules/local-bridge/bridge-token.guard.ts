import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { LocalBridgeService } from './local-bridge.service';

/**
 * Authenticates a bridge by its bearer token (sent as `Authorization: Bridge
 * <token>`). Bridges are first-class principals separate from users and
 * devices — their permissions are scoped to their branch and to commands
 * targeting devices attached to them.
 */
@Injectable()
export class BridgeTokenGuard implements CanActivate {
  constructor(private readonly bridges: LocalBridgeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header) throw new UnauthorizedException('No bridge token');
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bridge' || !token) {
      throw new UnauthorizedException('Expected "Authorization: Bridge <token>"');
    }
    const bridge = await this.bridges.authenticateToken(token);
    if (!bridge) throw new UnauthorizedException('Invalid or expired bridge token');
    if (bridge.status === 'retired') throw new UnauthorizedException('Bridge retired');
    req.bridge = bridge;
    return true;
  }
}
