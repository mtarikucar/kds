import { LoggerService } from "./logger.service";
import { RequestContext } from "../context/request-context";

/**
 * Verifies the correlation backbone: every log emitted inside a request's
 * AsyncLocalStorage context carries the requestId (and tenant/branch/user
 * when enriched), so service-layer logs join up with the HTTP access log
 * and Sentry events for the same request.
 */
describe("LoggerService correlation enrichment", () => {
  it("injects requestId + tenant context into log meta inside a request", () => {
    const svc = new LoggerService("Test");
    const infoSpy = jest
      .spyOn((svc as any).logger, "info")
      .mockImplementation(() => undefined);

    RequestContext.run({ requestId: "req-1", tenantId: "t-1", branchId: "b-1" }, () => {
      svc.log("hello");
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        requestId: "req-1",
        tenantId: "t-1",
        branchId: "b-1",
        context: "Test",
      }),
    );
  });

  it("enriches error/warn paths too", () => {
    const svc = new LoggerService("Test");
    const errSpy = jest
      .spyOn((svc as any).logger, "error")
      .mockImplementation(() => undefined);

    RequestContext.run({ requestId: "req-2" }, () => {
      svc.error("boom", "stack");
    });

    expect(errSpy).toHaveBeenCalledWith(
      "boom",
      expect.objectContaining({ requestId: "req-2", trace: "stack", context: "Test" }),
    );
  });

  it("omits correlation fields when no request context is active", () => {
    const svc = new LoggerService("Test");
    const warnSpy = jest
      .spyOn((svc as any).logger, "warn")
      .mockImplementation(() => undefined);

    svc.warn("nope");

    expect(warnSpy).toHaveBeenCalledWith("nope", { context: "Test" });
  });
});
