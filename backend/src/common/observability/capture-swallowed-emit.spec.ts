const mockCapture = jest.fn();
jest.mock("../../sentry.config", () => ({
  captureException: (...args: unknown[]) => mockCapture(...args),
}));

import { Logger } from "@nestjs/common";
import { captureSwallowedEmit } from "./capture-swallowed-emit";

describe("captureSwallowedEmit", () => {
  beforeEach(() => mockCapture.mockClear());

  it("logs at warn and captures the error to Sentry with context", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    const handler = captureSwallowedEmit(logger, { module: "m", op: "o" });

    handler(new Error("append failed"));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("swallowed emit failure [m/o]: append failed"),
    );
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      { module: "m", op: "o" },
    );
  });

  it("coerces a non-Error rejection into an Error", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    captureSwallowedEmit(logger, {})("string failure");

    const [err] = mockCapture.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("string failure");
  });

  it("does not throw (keeps the emit best-effort)", () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    expect(() => captureSwallowedEmit(logger, {})(new Error("x"))).not.toThrow();
  });
});
