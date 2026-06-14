import { BaseAdapter } from "./base.adapter";

/**
 * Pure-logic locks for BaseAdapter — the shared HTTP/auth machinery every
 * concrete adapter inherits but no spec exercised directly.
 *
 * Covered:
 *   - getAuthHeaders -> Bearer scheme.
 *   - request() retry policy: retries 5xx & 429, does NOT retry other 4xx,
 *     honours numeric Retry-After (clamped), and surfaces the last error
 *     after exhausting retries.
 *
 * The httpClient is a real axios instance; we stub its `.request` so no
 * network I/O occurs. `sleep` is neutralised so backoff doesn't slow tests.
 */
class TestAdapter extends BaseAdapter {
  constructor() {
    super("TestAdapter", "https://example.test");
  }
  // Expose the protected members for assertions.
  public callAuth(token: string) {
    return this.getAuthHeaders(token);
  }
  public callRequest(config: any, retries?: number) {
    return this.request(config, retries);
  }
  public get client() {
    return this.httpClient;
  }
}

describe("BaseAdapter", () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    // Make backoff instantaneous regardless of computed delay.
    jest
      .spyOn(adapter as any, "sleep")
      .mockImplementation(() => Promise.resolve());
  });

  describe("getAuthHeaders", () => {
    it("builds a Bearer Authorization header", () => {
      expect(adapter.callAuth("abc123")).toEqual({
        Authorization: "Bearer abc123",
      });
    });
  });

  describe("request() retry policy", () => {
    const httpError = (status?: number, headers: any = {}) => {
      const err: any = new Error(`HTTP ${status}`);
      err.response = { status, headers };
      return err;
    };

    it("returns immediately on first success (no retries)", async () => {
      const requestSpy = jest
        .spyOn(adapter.client, "request")
        .mockResolvedValue({ data: { ok: true }, status: 200 } as any);

      const res = await adapter.callRequest({ method: "GET", url: "/x" });

      expect(res.data).toEqual({ ok: true });
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a 400 client error and rethrows it", async () => {
      const requestSpy = jest
        .spyOn(adapter.client, "request")
        .mockRejectedValue(httpError(400));

      await expect(
        adapter.callRequest({ method: "GET", url: "/x" }),
      ).rejects.toThrow("HTTP 400");
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("retries a 429 rate-limit and eventually succeeds", async () => {
      const requestSpy = jest
        .spyOn(adapter.client, "request")
        .mockRejectedValueOnce(httpError(429))
        .mockResolvedValueOnce({ data: "ok", status: 200 } as any);

      const res = await adapter.callRequest({ method: "GET", url: "/x" });

      expect(res.data).toBe("ok");
      expect(requestSpy).toHaveBeenCalledTimes(2);
    });

    it("retries a 503 server error up to the retry budget then throws the last error", async () => {
      const requestSpy = jest
        .spyOn(adapter.client, "request")
        .mockRejectedValue(httpError(503));

      await expect(
        adapter.callRequest({ method: "GET", url: "/x" }, 2),
      ).rejects.toThrow("HTTP 503");
      // initial attempt + 2 retries = 3 calls.
      expect(requestSpy).toHaveBeenCalledTimes(3);
    });

    it("honours a numeric Retry-After header for the backoff delay", async () => {
      jest
        .spyOn(adapter.client, "request")
        .mockRejectedValueOnce(httpError(429, { "retry-after": "2" }))
        .mockResolvedValueOnce({ data: "ok", status: 200 } as any);
      const sleepSpy = jest.spyOn(adapter as any, "sleep");

      await adapter.callRequest({ method: "GET", url: "/x" });

      // 2 seconds -> 2000ms (clamped under the 30s cap).
      expect(sleepSpy).toHaveBeenCalledWith(2000);
    });

    it("does not retry when retries=0 and surfaces the error", async () => {
      const requestSpy = jest
        .spyOn(adapter.client, "request")
        .mockRejectedValue(httpError(500));

      await expect(
        adapter.callRequest({ method: "GET", url: "/x" }, 0),
      ).rejects.toThrow("HTTP 500");
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });
  });
});
