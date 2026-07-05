import { ServiceUnavailableException } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

/**
 * Health-probe contract. The load-bearing behaviour: `/healthz/ready` must
 * return 503 (not 200 with ok:false) when a hard dependency is down, so a
 * blackbox/uptime probe + load balancer + Prometheus all see the true state.
 * `/healthz/live` stays 200 (liveness = "process is alive").
 */
describe("AppController health probes", () => {
  function make(health: Record<string, unknown>) {
    const appService = {
      getHealth: jest.fn().mockResolvedValue(health),
    } as unknown as AppService;
    // kms/payments/fiscal are @Optional — omitted here, so those branches skip.
    return new AppController(appService);
  }

  it("liveness is always 200 (process is alive)", () => {
    expect(make({ status: "ok" }).liveness()).toMatchObject({ ok: true });
  });

  it("readiness returns ok when the base health is ok", async () => {
    const res = (await make({ status: "ok" }).readiness()) as {
      ok: boolean;
    };
    expect(res.ok).toBe(true);
  });

  it("readiness THROWS 503 (ServiceUnavailable) when a dependency is down", async () => {
    await expect(make({ status: "degraded" }).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("the 503 body carries the failing base for operator triage", async () => {
    const err = await make({ status: "degraded", redis: "down" })
      .readiness()
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const body = (err as ServiceUnavailableException).getResponse() as {
      ok: boolean;
      base: { status: string };
    };
    expect(body.ok).toBe(false);
    expect(body.base).toMatchObject({ status: "degraded" });
  });
});
