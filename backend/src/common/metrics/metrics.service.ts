import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

/**
 * Prometheus metrics for the backend, exposed at GET /api/metrics
 * (metrics.controller.ts) and fed by RequestLoggerMiddleware.
 *
 * Strictly additive to the existing observability stack: Sentry keeps
 * error tracking and its tracing, OTel (common/observability/tracing.ts)
 * stays the opt-in distributed-tracing path. This registry is what a
 * Prometheus/Grafana stack scrapes for RED dashboards and alert rules.
 *
 * A dedicated Registry (not the prom-client global) so jest workers that
 * construct multiple Nest apps never collide on duplicate metric names.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds, labeled by method/route/status",
    labelNames: ["method", "route", "status_code"] as const,
    // Sub-5ms cache hits through 10s report generation.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  /**
   * Record one finished HTTP request. `route` must be the Express route
   * pattern (`/api/orders/:id`), never the raw URL — raw URLs embed IDs
   * and would explode label cardinality.
   */
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.httpRequestDuration
      .labels(method, route, String(statusCode))
      .observe(durationSeconds);
  }

  /** Serialized registry in the Prometheus exposition format. */
  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
