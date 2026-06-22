import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ScreenSessionService } from "../screen-session.service";

/**
 * Authenticates a partner screen by its scoped token, presented as
 * `Authorization: Screen <token>` (non-Bearer, like Device/Bridge, so HTTP
 * intermediaries that strip Bearer for user sessions don't clobber it). On
 * success sets req.screen (the session row incl. orderingSessionId + scopes)
 * + req.machinePrincipalId.
 */
@Injectable()
export class ScreenTokenGuard implements CanActivate {
  constructor(private readonly screenSessions: ScreenSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header) throw new UnauthorizedException("No screen token");
    const [scheme, token] = header.split(" ");
    if (scheme !== "Screen" || !token) {
      throw new UnauthorizedException(
        'Expected "Authorization: Screen <token>"',
      );
    }
    const screen = await this.screenSessions.authenticate(token);
    if (!screen) {
      throw new UnauthorizedException("Invalid or expired screen token");
    }
    req.screen = screen;
    req.machinePrincipalId = `screen:${screen.id}`;
    return true;
  }
}
