import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRED_SCOPE_KEY } from "../decorators/require-scope.decorator";

/**
 * Enforces the @RequireScope on a /display endpoint against the scopes carried
 * by the authenticated screen token (req.screen.scopes). Runs after
 * ScreenTokenGuard. No @RequireScope → no scope check.
 */
@Injectable()
export class ScreenScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(
      REQUIRED_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;
    const req = context.switchToHttp().getRequest();
    const scopes: string[] = req.screen?.scopes ?? [];
    if (!scopes.includes(required)) {
      throw new ForbiddenException(
        `Screen token lacks required scope: ${required}`,
      );
    }
    return true;
  }
}
