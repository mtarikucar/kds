import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it("exposes default process metrics", async () => {
    const output = await service.metrics();
    expect(output).toContain("process_cpu_user_seconds_total");
    expect(output).toContain("nodejs_heap_size_total_bytes");
  });

  it("exposes outbox_dlq_depth and reflects set()/inc()", async () => {
    service.setOutboxDlqDepth(3);
    let output = await service.metrics();
    expect(output).toContain("outbox_dlq_depth 3");

    service.incOutboxDlqDepth();
    output = await service.metrics();
    expect(output).toContain("outbox_dlq_depth 4");

    service.setOutboxDlqDepth(0);
    output = await service.metrics();
    expect(output).toContain("outbox_dlq_depth 0");
  });

  it("records http request observations with labels", async () => {
    service.observeHttpRequest("GET", "/api/orders/:id", 200, 0.042);
    service.observeHttpRequest("GET", "/api/orders/:id", 200, 0.061);
    service.observeHttpRequest("POST", "/api/orders", 500, 1.2);

    const output = await service.metrics();
    expect(output).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/orders/:id",status_code="200"} 2',
    );
    expect(output).toContain(
      'http_request_duration_seconds_count{method="POST",route="/api/orders",status_code="500"} 1',
    );
  });

  it("uses an isolated registry per instance (no duplicate-name collisions)", () => {
    // Constructing a second service must not throw — proves we are not on
    // prom-client's shared global registry.
    expect(() => new MetricsService()).not.toThrow();
  });

  it("reports the Prometheus exposition content type", () => {
    expect(service.contentType).toContain("text/plain");
  });
});
