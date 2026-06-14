import { SystemClock, type Clock } from "./clock";

describe("SystemClock", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("nowMs() returns the real epoch ms (delegates to Date.now)", () => {
    jest.useFakeTimers();
    const fixed = new Date("2026-06-14T12:34:56.000Z");
    jest.setSystemTime(fixed);

    const clock = new SystemClock();

    expect(clock.nowMs()).toBe(fixed.getTime());
  });

  it("now() returns a Date at the real instant (delegates to new Date)", () => {
    jest.useFakeTimers();
    const fixed = new Date("2026-06-14T12:34:56.000Z");
    jest.setSystemTime(fixed);

    const clock = new SystemClock();
    const result = clock.now();

    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(fixed.getTime());
  });

  it("now() and nowMs() agree at the same instant", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const clock = new SystemClock();

    expect(clock.now().getTime()).toBe(clock.nowMs());
  });

  it("satisfies the Clock interface (structural contract)", () => {
    const clock: Clock = new SystemClock();
    expect(typeof clock.now).toBe("function");
    expect(typeof clock.nowMs).toBe("function");
  });
});
