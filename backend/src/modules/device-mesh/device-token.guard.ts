import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { DeviceService } from './device.service';

/**
 * Authenticates a device by its bearer token. Distinct from JwtAuthGuard
 * because devices use opaque random tokens (sha256-stored), not JWTs —
 * cheaper, revocable in one DB write, and tied to the device row.
 *
 * Token is sent as `Authorization: Device <token>`. We deliberately use a
 * non-Bearer scheme so HTTP intermediaries that strip `Bearer` for user
 * sessions don't accidentally clobber device auth.
 */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly devices: DeviceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header) throw new UnauthorizedException('No device token');
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Device' || !token) {
      throw new UnauthorizedException('Expected "Authorization: Device <token>"');
    }
    const device = await this.devices.authenticateToken(token);
    if (!device) throw new UnauthorizedException('Invalid or expired device token');
    if (device.status === 'retired') throw new UnauthorizedException('Device retired');
    req.device = device;
    return true;
  }
}
