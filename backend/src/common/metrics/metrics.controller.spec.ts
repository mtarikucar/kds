import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

function makeRequest(authorization?: string): Request {
  return {
    get: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  } as unknown as Request;
}

function makeController(metricsToken?: string): MetricsController {
  const config = {
    get: (key: string) => (key === "METRICS_TOKEN" ? metricsToken : undefined),
  } as unknown as ConfigService;
  return new MetricsController(new MetricsService(), config);
}

describe("MetricsController", () => {
  it("serves metrics openly when METRICS_TOKEN is not configured", async () => {
    const controller = makeController(undefined);
    const body = await controller.metrics(makeRequest());
    expect(body).toContain("http_request_duration_seconds");
  });

  it("rejects requests without a token when METRICS_TOKEN is set", async () => {
    const controller = makeController("scrape-secret");
    await expect(controller.metrics(makeRequest())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a wrong bearer token", async () => {
    const controller = makeController("scrape-secret");
    await expect(
      controller.metrics(makeRequest("Bearer wrong-secret")),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("accepts the configured bearer token", async () => {
    const controller = makeController("scrape-secret");
    const body = await controller.metrics(makeRequest("Bearer scrape-secret"));
    expect(body).toContain("process_cpu_user_seconds_total");
  });
});
