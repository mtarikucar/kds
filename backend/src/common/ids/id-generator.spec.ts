import { SystemIdGenerator, type IdGenerator } from "./id-generator";

describe("SystemIdGenerator", () => {
  const gen = new SystemIdGenerator();

  it("uuid() returns a v4 UUID string", () => {
    const id = gen.uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("uuid() returns distinct values across calls", () => {
    const a = gen.uuid();
    const b = gen.uuid();
    expect(a).not.toBe(b);
  });

  it("randomHex(n) returns 2*n lowercase hex characters", () => {
    const hex = gen.randomHex(3);
    expect(hex).toMatch(/^[0-9a-f]{6}$/);
  });

  it("randomHex respects the requested byte length", () => {
    expect(gen.randomHex(0)).toHaveLength(0);
    expect(gen.randomHex(1)).toHaveLength(2);
    expect(gen.randomHex(16)).toHaveLength(32);
  });

  it("randomHex produces different bytes across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(gen.randomHex(8));
    expect(seen.size).toBe(50);
  });

  it("satisfies the IdGenerator interface (structural contract)", () => {
    const g: IdGenerator = new SystemIdGenerator();
    expect(typeof g.uuid).toBe("function");
    expect(typeof g.randomHex).toBe("function");
  });
});
