import { LoggerService } from "./logger.service";

/**
 * Long-tail spec for the Winston-backed LoggerService. We don't assert log
 * output (winston transports are environment-dependent); instead we verify
 * the delegation contract: each NestLoggerService method forwards to the
 * right winston level with the configured context, and setContext changes
 * the context used for subsequent calls.
 */
describe("LoggerService", () => {
  function withSpiedLogger(context?: string) {
    const svc = new LoggerService(context);
    const inner = (svc as unknown as { logger: Record<string, jest.Mock> })
      .logger;
    inner.info = jest.fn();
    inner.error = jest.fn();
    inner.warn = jest.fn();
    inner.debug = jest.fn();
    inner.verbose = jest.fn();
    inner.log = jest.fn();
    return { svc, inner };
  }

  it("log() forwards to winston.info with the constructor context", () => {
    const { svc, inner } = withSpiedLogger("Boot");
    svc.log("hello");
    expect(inner.info).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ context: "Boot" }),
    );
  });

  it("error() forwards to winston.error and threads the trace", () => {
    const { svc, inner } = withSpiedLogger("Svc");
    svc.error("boom", "stack-trace");
    expect(inner.error).toHaveBeenCalledWith(
      "boom",
      expect.objectContaining({ context: "Svc", trace: "stack-trace" }),
    );
  });

  it("warn()/debug()/verbose() forward to their matching winston level", () => {
    const { svc, inner } = withSpiedLogger("Svc");
    svc.warn("w");
    svc.debug("d");
    svc.verbose("v");
    expect(inner.warn).toHaveBeenCalled();
    expect(inner.debug).toHaveBeenCalled();
    expect(inner.verbose).toHaveBeenCalled();
  });

  it("a per-call context overrides the instance context", () => {
    const { svc, inner } = withSpiedLogger("Default");
    svc.log("x", "Override");
    expect(inner.info).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({ context: "Override" }),
    );
  });

  it("setContext changes the context used by later calls", () => {
    const { svc, inner } = withSpiedLogger("Old");
    svc.setContext("New");
    svc.log("x");
    expect(inner.info).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({ context: "New" }),
    );
  });

  it("http() logs at the http level via winston.log", () => {
    const { svc, inner } = withSpiedLogger("HTTP");
    svc.http("GET /x", { ip: "1.1.1.1" });
    expect(inner.log).toHaveBeenCalledWith(
      "http",
      "GET /x",
      expect.objectContaining({ ip: "1.1.1.1" }),
    );
  });
});
