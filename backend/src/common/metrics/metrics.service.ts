import { Injectable } from "@nestjs/common";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

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

  /**
   * Depth of the outbox dead-letter queue (events that exhausted all retries
   * and need operator triage). Previously this was only discoverable by
   * grepping logs for "outbox DLQ"; exposing it as a gauge lets a Prometheus
   * alert fire on `outbox_dlq_depth > 0`. The worker bumps it inline as rows
   * give up and re-sets it to an authoritative count on each hourly prune.
   */
  private readonly outboxDlqDepthGauge = new Gauge({
    name: "outbox_dlq_depth",
    help: "Number of outbox events parked in the dead-letter queue (status=failed)",
    registers: [this.registry],
  });

  /**
   * Depth of the delivery-platforms dead-letter queue: log rows that
   * exhausted their retry budget (success=false, retryCount>=maxRetries,
   * nextRetryAt=null) and the RetryScheduler will never re-claim on its
   * own. Mirrors `outbox_dlq_depth`: DeliveryLogService bumps it inline
   * when incrementRetry crosses a row into the terminal null state, and
   * a cheap periodic tick re-sets it to an authoritative COUNT(*) so an
   * operator requeue/delete (or a restart) can't leave the gauge drifted.
   * A Prometheus alert can fire on `delivery_dlq_depth > 0`.
   */
  private readonly deliveryDlqDepthGauge = new Gauge({
    name: "delivery_dlq_depth",
    help: "Number of delivery-platform log entries parked in the dead-letter queue (retries exhausted, nextRetryAt=null)",
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  /** Set the DLQ depth to an authoritative value (e.g. a COUNT(*) result). */
  setOutboxDlqDepth(depth: number): void {
    this.outboxDlqDepthGauge.set(depth);
  }

  /** Increment the DLQ depth by one as a single event gives up. */
  incOutboxDlqDepth(): void {
    this.outboxDlqDepthGauge.inc();
  }

  /** Set the delivery DLQ depth to an authoritative value (COUNT(*) result). */
  setDeliveryDlqDepth(depth: number): void {
    this.deliveryDlqDepthGauge.set(depth);
  }

  /** Increment the delivery DLQ depth by one as a single log row gives up. */
  incDeliveryDlqDepth(): void {
    this.deliveryDlqDepthGauge.inc();
  }

  /**
   * Lazily-created domain counters, so any service can record a business
   * event (`orders_created_total`, `auth_login_failures_total`, …) without
   * each declaring its own prom-client Counter. The metric NAME set is
   * developer-controlled (never user input), so cardinality stays bounded.
   *
   * The first call for a name fixes its label set; later calls only emit the
   * known labels (missing → "", extras ignored) so a caller drift can never
   * throw on a business path — metrics must never break the request.
   */
  private readonly counters = new Map<
    string,
    { counter: Counter<string>; labelNames: string[] }
  >();

  /** Increment a named domain counter by one. */
  incCounter(
    name: string,
    help: string,
    labels: Record<string, string> = {},
  ): void {
    let entry = this.counters.get(name);
    if (!entry) {
      const labelNames = Object.keys(labels);
      const counter = new Counter({
        name,
        help,
        labelNames,
        registers: [this.registry],
      });
      entry = { counter, labelNames };
      this.counters.set(name, entry);
    }
    if (entry.labelNames.length === 0) {
      entry.counter.inc();
      return;
    }
    const values: Record<string, string> = {};
    for (const k of entry.labelNames) values[k] = labels[k] ?? "";
    entry.counter.labels(values).inc();
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
