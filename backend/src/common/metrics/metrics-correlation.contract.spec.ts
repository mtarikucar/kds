import express from "express";
import request from "supertest";
import { MetricsService } from "./metrics.service";
import { RequestLoggerMiddleware } from "../middleware/request-logger.middleware";

/**
 * Track 2 — metrics-exposition + correlation-id HTTP contract.
 *
 * Two contracts a Prometheus/Grafana stack and cross-service tracing both
 * depend on, pinned end-to-end through a minimal express app that wires the
 * REAL RequestLoggerMiddleware and a metrics route backed by the REAL
 * MetricsService (the same two pieces app.module wires in production):
 *
 *   1. GET /api/metrics → 200 and the Prometheus exposition body exposes the
 *      expected metric NAMES (the Track-2 domain counters + the gauges/
 *      histogram the rest of the observability stack relies on).
 *   2. Every request echoes an `X-Request-Id` response header — minted when
 *      absent, honoured verbatim when the caller supplies one (the inbound
 *      half of the cross-service correlation chain).
 *
 * The domain counters are lazily created on first `incCounter`, so the test
 * touches each once up front to register its name (mirrors what the services
 * under test do on their first business event).
 */
describe("metrics + correlation-id HTTP contract", () => {
  let metrics: MetricsService;
  let app: express.Express;

  // The Track-2 domain counters this wave adds, plus the always-present
  // gauges/histogram every metrics scrape must continue to expose.
  const EXPECTED_COUNTER_NAMES = [
    "payment_intents_outcome_total",
    "checkout_provisions_total",
    "subscription_billing_total",
    "cash_drawer_ops_total",
    "webhook_delivery_total",
    "self_pay_settled_total",
  ];
  const EXPECTED_GAUGE_NAMES = [
    "outbox_dlq_depth",
    "delivery_dlq_depth",
    "outbox_oldest_queued_age_seconds",
  ];

  beforeEach(() => {
    metrics = new MetricsService();

    // Register each domain counter's name (lazy until first increment).
    metrics.incCounter("payment_intents_outcome_total", "h", {
      outcome: "success",
    });
    metrics.incCounter("checkout_provisions_total", "h", { result: "paid" });
    metrics.incCounter("subscription_billing_total", "h", { event: "create" });
    metrics.incCounter("cash_drawer_ops_total", "h", { op: "open" });
    metrics.incCounter("webhook_delivery_total", "h", { result: "success" });
    metrics.incCounter("self_pay_settled_total", "h", { result: "success" });

    const mw = new RequestLoggerMiddleware(metrics);
    app = express();
    // Wire the real middleware exactly as AppModule does.
    app.use((req, res, next) => mw.use(req, res, next));
    // A trivial business route to observe the X-Request-Id echo on.
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));
    // The metrics scrape route, backed by the real MetricsService.
    app.get("/api/metrics", async (_req, res) => {
      res.set("Content-Type", metrics.contentType);
      res.send(await metrics.metrics());
    });
  });

  describe("GET /api/metrics", () => {
    it("returns 200 and exposes every expected domain-counter name", async () => {
      const res = await request(app).get("/api/metrics");
      expect(res.status).toBe(200);
      for (const name of EXPECTED_COUNTER_NAMES) {
        expect(res.text).toContain(name);
      }
    });

    it("exposes the observability gauges the rest of the stack relies on", async () => {
      const res = await request(app).get("/api/metrics");
      for (const name of EXPECTED_GAUGE_NAMES) {
        expect(res.text).toContain(name);
      }
      // The HTTP request-duration histogram name is exposed too.
      expect(res.text).toContain("http_request_duration_seconds");
    });

    it("serves the Prometheus exposition content-type", async () => {
      const res = await request(app).get("/api/metrics");
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
    });
  });

  describe("X-Request-Id correlation header", () => {
    it("mints an X-Request-Id when the caller sends none", async () => {
      const res = await request(app).get("/api/ping");
      expect(res.status).toBe(200);
      const id = res.headers["x-request-id"];
      expect(id).toBeDefined();
      // A minted id is a non-empty UUID-shaped string.
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("honours an inbound X-Request-Id verbatim", async () => {
      const inbound = "trace-from-upstream-service-42";
      const res = await request(app)
        .get("/api/ping")
        .set("X-Request-Id", inbound);
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(inbound);
    });
  });
});
