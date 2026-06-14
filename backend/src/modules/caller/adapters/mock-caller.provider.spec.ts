import { MockCallerProvider } from "./mock-caller.provider";

/**
 * Long-tail spec for the mock VoIP caller provider (the FAKE impl behind
 * the CallerProvider seam). Load-bearing contracts: it normalises a single
 * object OR an array of objects into NormalisedCallerEvent[], fills sane
 * defaults (kind=incoming, generated callId/occurredAt), and returns [] for
 * unparseable input rather than throwing into the webhook pipeline.
 */
describe("MockCallerProvider", () => {
  const provider = new MockCallerProvider();

  it("normalises a single posted object into one event", async () => {
    const raw = JSON.stringify({ callId: "c1", e164: "+905551112233" });
    const events = await provider.parseWebhook("", raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      providerId: "mock",
      callId: "c1",
      kind: "incoming",
      e164: "+905551112233",
    });
    expect(typeof events[0].occurredAt).toBe("string");
  });

  it("normalises an array of posted objects", async () => {
    const raw = JSON.stringify([{ callId: "a" }, { callId: "b" }]);
    const events = await provider.parseWebhook("", raw);
    expect(events.map((e) => e.callId)).toEqual(["a", "b"]);
  });

  it("generates a callId when absent", async () => {
    const events = await provider.parseWebhook("", JSON.stringify({}));
    expect(events[0].callId).toMatch(/^mock-/);
  });

  it("returns [] for unparseable input (no throw)", async () => {
    await expect(provider.parseWebhook("", "not json")).resolves.toEqual([]);
  });

  it("healthCheck reports ok in mock mode", async () => {
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
