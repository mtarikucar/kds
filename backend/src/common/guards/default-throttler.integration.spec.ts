import { Controller, Get, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerModule,
  Throttle,
  ThrottlerModuleOptions,
} from "@nestjs/throttler";
import request from "supertest";

/**
 * Regression for the silently-inert rate limits.
 *
 * Every sensitive auth/public route in this app limits itself with
 * `@Throttle({ default: { limit, ttl } })`. @nestjs/throttler's guard only
 * consults throttlers whose `name` appears in `ThrottlerModule.forRoot([...])`.
 * For a long stretch the module registered only `short`/`medium`/`long` —
 * NOT `default` — so every one of those per-route overrides was DEAD: the
 * routes fell back to the loose global `long` (100/min) bucket, leaving
 * login/register/2FA/refresh effectively unthrottled.
 *
 * This spec proves the contract at the HTTP layer (not just decorator
 * presence): with a `default` throttler registered, a `default`-keyed
 * override actually returns 429; without it, the same override is inert.
 */
@Controller("t")
class ProbeController {
  // 2 requests / minute on the `default` bucket — the same override shape
  // /auth/login uses, just with a tiny limit so the test is fast.
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Get("limited")
  limited() {
    return { ok: true };
  }
}

async function bootstrap(
  throttlers: ThrottlerModuleOptions,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(throttlers)],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe("default-keyed @Throttle firing", () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("FIRES when a 'default' throttler is registered: 3rd request → 429", async () => {
    app = await bootstrap([{ name: "default", ttl: 60_000, limit: 100 }]);
    const server = app.getHttpServer();
    expect((await request(server).get("/t/limited")).status).toBe(200);
    expect((await request(server).get("/t/limited")).status).toBe(200);
    expect((await request(server).get("/t/limited")).status).toBe(429);
  });

  it("is INERT when no 'default' throttler is registered (documents the bug): 3rd request still 200", async () => {
    // Mirrors the pre-fix module: only short/medium/long, no `default`.
    app = await bootstrap([{ name: "long", ttl: 60_000, limit: 100 }]);
    const server = app.getHttpServer();
    expect((await request(server).get("/t/limited")).status).toBe(200);
    expect((await request(server).get("/t/limited")).status).toBe(200);
    // Would be 429 if the override bound — it does not, so the route is
    // only capped by the global `long` (100/min) bucket.
    expect((await request(server).get("/t/limited")).status).toBe(200);
  });
});
