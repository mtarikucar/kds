import { ThrottlerOptions } from "@nestjs/throttler";

/**
 * Root throttler profiles. Factored out of app.module so a spec can pin the
 * one invariant that silently broke for months: a throttler named `default`
 * MUST be registered.
 *
 * Every per-route `@Throttle({ default: { ... } })` in the codebase (49
 * routes: OTP send, device pairing, public lookups, self-pay, webhooks…)
 * targets the throttler NAMED "default". @nestjs/throttler resolves the
 * override per registered throttler name — with no `default` profile
 * registered, every one of those decorators was INERT and the only live
 * limits were the generic short/medium/long globals. The `default` profile
 * below is deliberately LOOSER than `long` (300/min vs 100/min), so
 * registering it changes NOTHING globally — its entire purpose is to give
 * the 49 route-level overrides a live throttler to bind to.
 */
export const THROTTLER_PROFILES: ThrottlerOptions[] = [
  {
    name: "short",
    ttl: 1000,
    limit: 10,
  },
  {
    name: "medium",
    ttl: 10000,
    limit: 50,
  },
  {
    name: "long",
    ttl: 60000,
    limit: 100,
  },
  {
    name: "default",
    ttl: 60000,
    limit: 300,
  },
];
