import { THROTTLER_PROFILES } from "./throttler.config";

/**
 * Tripwire for the silent-inert-throttle bug class: 49 routes carry
 * `@Throttle({ default: {...} })`, and @nestjs/throttler binds those
 * overrides ONLY to a registered throttler literally named "default".
 * For months no such profile existed, so every route-level brute-force /
 * abuse cap (OTP send, device pairing, public lookups, self-pay…) was
 * silently unenforced. This spec fails the build if anyone removes or
 * renames the profile again.
 */
describe("THROTTLER_PROFILES", () => {
  const byName = Object.fromEntries(
    THROTTLER_PROFILES.map((p) => [p.name, p]),
  );

  it('registers the "default" throttler that all @Throttle({default}) overrides bind to', () => {
    expect(byName.default).toBeDefined();
  });

  it('keeps "default" looser than "long" so registering it changes nothing globally', () => {
    // default exists purely so route overrides bind; the generic global
    // backstop must remain `long` (100/min). If default were tighter it
    // would silently become a new global limit on every route.
    const perMinute = (p: { ttl: number; limit: number }) =>
      (p.limit / p.ttl) * 60_000;
    expect(perMinute(byName.default as any)).toBeGreaterThan(
      perMinute(byName.long as any),
    );
  });

  it("keeps the pre-existing short/medium/long globals unchanged", () => {
    expect(byName.short).toMatchObject({ ttl: 1000, limit: 10 });
    expect(byName.medium).toMatchObject({ ttl: 10000, limit: 50 });
    expect(byName.long).toMatchObject({ ttl: 60000, limit: 100 });
  });
});
