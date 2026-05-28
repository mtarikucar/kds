import 'reflect-metadata';
import { AuthController } from './auth.controller';

/**
 * Iter-82 regression. Two auth endpoints used to ship without a
 * @Throttle decorator:
 *
 *   /refresh — @Public, does a DB updateMany + findUnique per call.
 *              An attacker spamming bogus refresh tokens would burn
 *              two DB roundtrips + a JWT verify CPU cycle per request
 *              with nothing to brake them.
 *
 *   /change-password — JwtAuthGuard-gated, but with a stolen access
 *              token an attacker can brute-force the current password
 *              via repeated bcrypt.compare attempts. iter-43 capped
 *              the password length; iter-82 caps the attempt count.
 *
 * Both inherit the global default throttler, but per-endpoint limits
 * are needed because the global default is set for normal API traffic
 * and is too generous for these surfaces. The spec inspects the
 * Throttle metadata Nest's reflector consults at request time so a
 * refactor that drops the decorator fails the suite.
 */
describe('AuthController per-endpoint throttle wiring (iter-82)', () => {
  function method<K extends keyof AuthController>(name: K): Function {
    return AuthController.prototype[name] as unknown as Function;
  }

  function throttleMeta(handler: Function): Record<string, { limit: number; ttl: number }> | undefined {
    // @nestjs/throttler stores per-route limits under
    // THROTTLER_LIMIT/THROTTLER_TTL or the merged THROTTLER_OPTIONS
    // key, depending on version. Try the modern key first (object
    // keyed by tracker name) and fall back to legacy.
    const merged = Reflect.getMetadata('THROTTLER:LIMIT_AND_TTL', handler);
    if (merged) return merged;
    // v6+ writes the per-route config under @nestjs/throttler-internal
    // metadata. The shape we care about is "is anything attached?".
    const allKeys = Reflect.getMetadataKeys(handler) as string[];
    const tk = allKeys.find((k) => /throttle/i.test(String(k)));
    return tk ? (Reflect.getMetadata(tk, handler) as any) : undefined;
  }

  it('/refresh has a per-endpoint @Throttle attached', () => {
    expect(throttleMeta(method('refresh'))).toBeDefined();
  });

  it('/change-password has a per-endpoint @Throttle attached', () => {
    expect(throttleMeta(method('changePassword'))).toBeDefined();
  });

  it('/login keeps its existing @Throttle (sanity check the inspector finds it)', () => {
    expect(throttleMeta(method('login'))).toBeDefined();
  });

  it('/logout intentionally has no @Throttle (auth-gated session terminator)', () => {
    // Logout is JwtAuthGuard-protected and only revokes the user's
    // own refresh tokens — no abuse leverage on rate limiting.
    expect(throttleMeta(method('logout'))).toBeUndefined();
  });
});
