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
 *   - METRICS_TOKEN set   → require `Authorization: Bearer <token>`
 *                           (constant-time compare).
 *   - METRICS_TOKEN unset → open; deployments must then keep /api/metrics
 *                           off the public ingress (internal network only),
 *                           same posture as the OTel collector endpoint.
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
    if (!token) return;

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
