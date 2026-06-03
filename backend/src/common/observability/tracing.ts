/**
 * OpenTelemetry bootstrap for HummyTummy.
 *
 * Opt-in via env vars — when neither is set the function returns early and
 * the rest of the codebase keeps using the existing Sentry-based tracing
 * (sentry.config.ts). When OTEL_EXPORTER_OTLP_ENDPOINT is present, this
 * registers an OTLP exporter + auto-instrumentation, and every NestJS
 * request/Prisma query/HTTP outbound automatically appears in the trace.
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT  e.g. http://otel-collector:4318
 *   OTEL_SERVICE_NAME            defaults to "hummytummy-backend"
 *   OTEL_RESOURCE_ATTRIBUTES     comma-separated key=value list
 *
 * The SDK packages (`@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`,
 * `@opentelemetry/exporter-trace-otlp-http`) are intentionally lazy-imported
 * so production installs can skip them — adding them is a one-line
 * package.json change when the OTel collector is provisioned.
 */
export async function bootstrapTracing(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // Off by default. Sentry tracing in sentry.config.ts continues to work
    // — OTel is a strictly-additive observability path.
    return;
  }

  try {
    // Lazy `require` via `Function` so webpack/esbuild's static analysis
    // does NOT try to resolve these at build time. The SDK packages are
    // optional peer-deps — production installs that enable OTel run
    // `npm install` on the listed packages and the dynamic require picks
    // them up at boot.
    const dynRequire = new Function("mod", "return require(mod)") as (
      m: string,
    ) => any;
    const { NodeSDK } = dynRequire("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = dynRequire(
      "@opentelemetry/auto-instrumentations-node",
    );
    const { OTLPTraceExporter } = dynRequire(
      "@opentelemetry/exporter-trace-otlp-http",
    );
    const { Resource } = dynRequire("@opentelemetry/resources");
    const { SemanticResourceAttributes } = dynRequire(
      "@opentelemetry/semantic-conventions",
    );

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME ?? "hummytummy-backend",
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
          process.env.NODE_ENV ?? "development",
      }),
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // HTTP request body / response body capture is too verbose for
          // production — disable so the spans stay compact.
          "@opentelemetry/instrumentation-http": {
            enabled: true,
            ignoreIncomingRequestHook: (req: any) =>
              req.url === "/healthz/live",
          },
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();
    // eslint-disable-next-line no-console
    console.log(`[OTel] tracing enabled → ${endpoint}`);

    // Flush on shutdown so the last spans don't disappear with the
    // process. NodeSDK already wires its own SIGTERM handler but we
    // belt-and-suspenders with an explicit shutdown.
    const shutdown = async () => {
      try {
        await sdk.shutdown();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[OTel] shutdown failed", e);
      }
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      "[OTel] tracing requested but SDK not installed; run: " +
        "npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions",
      e,
    );
  }
}

/**
 * Wrap an arbitrary async work unit in a span when OTel is active. No-op
 * fallback when the SDK isn't loaded — callers can use this freely without
 * a runtime cost in dev.
 *
 * Example:
 *   await withSpan('outbox.dispatch', { 'event.type': type }, async () => { ... });
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return fn();
  try {
    const dynRequire = new Function("mod", "return require(mod)") as (
      m: string,
    ) => any;
    const api = dynRequire("@opentelemetry/api");
    const tracer = api.trace.getTracer("hummytummy");
    return await tracer.startActiveSpan(name, async (span) => {
      try {
        for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
        const out = await fn();
        span.end();
        return out;
      } catch (e) {
        span.recordException(e as Error);
        span.setStatus({ code: 2 /* ERROR */ });
        span.end();
        throw e;
      }
    });
  } catch {
    return fn();
  }
}
