import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route as authenticated by a NON-JWT machine principal (Partner API
 * key or Screen token) rather than a user JWT. It makes the global
 * Jwt/Roles/Tenant/Branch guard chain step aside (via shouldBypassGlobalAuth)
 * so the route's dedicated @UseGuards(PartnerKeyGuard | ScreenTokenGuard)
 * becomes the sole authenticator. Distinct from @Public (which means "no auth
 * at all") — machine routes ARE authenticated, just not by a JWT.
 */
export const IS_MACHINE_AUTH_KEY = "isMachineAuth";
export const MachineAuth = () => SetMetadata(IS_MACHINE_AUTH_KEY, true);
