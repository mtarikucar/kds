import { timingSafeEqual } from "crypto";
import {
  Controller,
  Get,
  Header,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { Request } from "express";
import { Public } from "../../modules/auth/decorators/public.decorator";
import { MetricsService } from "./metrics.service";

/**
 * GET /api/metrics — Prometheus scrape target.
 *
 * @Public bypasses the global JWT guard (Prometheus can't do a login
 * flow). Access control instead:
 *   - production: METRICS_TOKEN is MANDATORY. A missing token now
 *     refuses every request with 503 rather than silently exposing
 *     the scrape (audit H6). The env-validation layer also fails
 *     fast at boot — see the boot-time check below.
 *   - non-prod (dev/staging/test): if METRICS_TOKEN is unset, the
 *     endpoint stays open. Deployments must keep /api/metrics off
 *     the public ingress at the nginx layer in either case.
 */
@Controller()
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Get("metrics")
  @Header("Cache-Control", "no-store")
  async metrics(@Req() req: Request): Promise<string> {
    this.assertAuthorized(req);
    return this.metricsService.metrics();
  }

  private assertAuthorized(req: Request): void {
    const token = this.configService.get<string>("METRICS_TOKEN");
    const env = this.configService.get<string>("NODE_ENV");
    if (!token) {
      if (env === "production") {
        // Fail closed. Pre-audit the controller short-circuited with
        // `return` here, leaving prod metrics PUBLIC any time the
        // operator forgot to set METRICS_TOKEN.
        throw new UnauthorizedException(
          "METRICS_TOKEN is not configured (production posture refuses to expose unauthenticated metrics).",
        );
      }
      return;
    }

    const header = req.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expected = Buffer.from(token);
    const actual = Buffer.from(presented);
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      throw new UnauthorizedException("Invalid metrics token");
    }
  }
}
