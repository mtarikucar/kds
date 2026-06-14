import { Request, Response, NextFunction } from "express";
import { RequestLoggerMiddleware } from "./request-logger.middleware";
import { LoggerService } from "../services/logger.service";
import { MetricsService } from "../metrics/metrics.service";

/**
 * Long-tail spec for the HTTP request logger + metrics tap. Load-bearing
 * contracts: it mints/honours a correlation id and echoes it on the
 * X-Request-Id response header; it calls next(); on res 'finish' it feeds
 * the metrics histogram with the bounded route pattern; and it EXCLUDES
 * self-observation paths (/api/metrics, /api/health…) from the histogram.
 *
 * The middleware builds its own LoggerService internally, so we silence the
 * winston-backed log methods on the prototype to keep the test hermetic.
 */
describe("RequestLoggerMiddleware", () => {
  beforeAll(() => {
    jest.spyOn(LoggerService.prototype, "http").mockImplementation(() => {});
    jest
      .spyOn(LoggerService.prototype, "logWithLevel")
      .mockImplementation(() => {});
  });
  afterAll(() => jest.restoreAllMocks());

  function makeReqRes(url: string, route?: { path: string }) {
    const finishHandlers: Array<() => void> = [];
    const headers: Record<string, string> = {};
    const req = {
      method: "GET",
      originalUrl: url,
      baseUrl: "",
      ip: "1.2.3.4",
      headers: {},
      route,
      get: () => "jest-agent",
    } as unknown as Request;
    const res = {
      statusCode: 200,
      get: () => "123",
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      on: (ev: string, cb: () => void) => {
        if (ev === "finish") finishHandlers.push(cb);
      },
    } as unknown as Response;
    const fireFinish = () => finishHandlers.forEach((h) => h());
    return { req, res, headers, fireFinish };
  }

  it("sets an X-Request-Id response header and calls next()", () => {
    const mw = new RequestLoggerMiddleware();
    const { req, res, headers } = makeReqRes("/api/orders");
    const next = jest.fn() as unknown as NextFunction;
    mw.use(req, res, next);
    expect(headers["X-Request-Id"]).toMatch(/[0-9a-f-]{36}/);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("honours an inbound X-Request-Id for cross-service tracing", () => {
    const mw = new RequestLoggerMiddleware();
    const { req, res, headers } = makeReqRes("/api/orders");
    (req.headers as Record<string, string>)["x-request-id"] = "trace-123";
    mw.use(req, res, jest.fn() as unknown as NextFunction);
    expect(headers["X-Request-Id"]).toBe("trace-123");
  });

  it("observes the bounded route pattern in the metrics histogram on finish", () => {
    const metrics = {
      observeHttpRequest: jest.fn(),
    } as unknown as MetricsService;
    const mw = new RequestLoggerMiddleware(metrics);
    const { req, res, fireFinish } = makeReqRes("/api/orders/123", {
      path: "/orders/:id",
    });
    mw.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish();
    expect(metrics.observeHttpRequest).toHaveBeenCalledWith(
      "GET",
      "/orders/:id",
      200,
      expect.any(Number),
    );
  });

  it("excludes self-observation paths from the metrics histogram", () => {
    const metrics = {
      observeHttpRequest: jest.fn(),
    } as unknown as MetricsService;
    const mw = new RequestLoggerMiddleware(metrics);
    const { req, res, fireFinish } = makeReqRes("/api/metrics");
    mw.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish();
    expect(metrics.observeHttpRequest).not.toHaveBeenCalled();
  });

  it("labels an unmatched route (no req.route) as 'unmatched'", () => {
    const metrics = {
      observeHttpRequest: jest.fn(),
    } as unknown as MetricsService;
    const mw = new RequestLoggerMiddleware(metrics);
    const { req, res, fireFinish } = makeReqRes("/api/does-not-exist");
    mw.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish();
    expect(metrics.observeHttpRequest).toHaveBeenCalledWith(
      "GET",
      "unmatched",
      200,
      expect.any(Number),
    );
  });
});
