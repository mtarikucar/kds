import * as Sentry from "@sentry/node";
import {
  withTransaction,
  withSpan,
  addBreadcrumb,
  setUserContext,
  setContext,
} from "./tracing";

jest.mock("@sentry/node", () => ({
  startSpan: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setContext: jest.fn(),
}));

const sentry = Sentry as jest.Mocked<typeof Sentry>;

/**
 * Long-tail spec for the Sentry tracing helpers. Load-bearing contracts:
 * withTransaction runs the body inside a span, marks OK on success and
 * ERROR + captureException on throw; tags become span attributes; the
 * scope helpers forward to the matching Sentry API with the documented
 * field mapping (tenantId → tenant_id).
 */
describe("utils/tracing", () => {
  beforeEach(() => jest.clearAllMocks());

  function fakeSpan() {
    return { setStatus: jest.fn(), setAttribute: jest.fn() };
  }

  describe("withTransaction", () => {
    it("runs the body, returns its value and marks the span OK", async () => {
      const span = fakeSpan();
      sentry.startSpan.mockImplementation((_opts, cb: any) => cb(span));
      const result = await withTransaction(
        { name: "payment.create", op: "payment", tags: { method: "card" } },
        async () => "ok",
      );
      expect(result).toBe("ok");
      expect(span.setAttribute).toHaveBeenCalledWith("method", "card");
      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
    });

    it("marks ERROR and captures the exception on throw", async () => {
      const span = fakeSpan();
      sentry.startSpan.mockImplementation((_opts, cb: any) => cb(span));
      await expect(
        withTransaction({ name: "x", op: "y" }, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(span.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ code: 2 }),
      );
      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  describe("withSpan", () => {
    it("runs the body and marks OK", async () => {
      const span = fakeSpan();
      sentry.startSpan.mockImplementation((_opts, cb: any) => cb(span));
      const r = await withSpan({ name: "db.insert", op: "db" }, async () => 7);
      expect(r).toBe(7);
      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
    });
  });

  describe("scope helpers", () => {
    it("addBreadcrumb forwards message/category/level to Sentry", () => {
      addBreadcrumb("did thing", "auth", { x: 1 }, "warning");
      expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "did thing",
          category: "auth",
          level: "warning",
        }),
      );
    });

    it("setUserContext maps tenantId → tenant_id", () => {
      setUserContext({ id: "u1", email: "a@b.com", tenantId: "t1" });
      expect(sentry.setUser).toHaveBeenCalledWith({
        id: "u1",
        email: "a@b.com",
        tenant_id: "t1",
      });
    });

    it("setContext forwards to Sentry.setContext", () => {
      setContext("order", { id: "o1" });
      expect(sentry.setContext).toHaveBeenCalledWith("order", { id: "o1" });
    });
  });
});
