import { OutboxService } from "./outbox.service";
import { RequestContext } from "../../common/context/request-context";

/**
 * Track 2 — outbox requestId propagation contract.
 *
 * The audit's "request → log → outbox" correlation chain: an outbox append
 * made inside a RequestContext.run must stamp that request's correlation id
 * into the persisted event metadata so a single failed request can be traced
 * from the HTTP access log, through the service-layer logs, all the way into
 * the durable event row the request produced.
 *
 * OutboxEvent has no dedicated `meta` column, so the requestId is folded into
 * a reserved `_meta` envelope key on the payload JSON. Existing consumers
 * parse `payload` with `.strip()`-default Zod schemas, so the extra key is
 * invisible to them — behaviour-preserving for every reader.
 */
describe("OutboxService — requestId propagation", () => {
  function makePrisma() {
    const create = jest.fn().mockResolvedValue({ id: "evt-1" });
    return {
      prisma: { outboxEvent: { create } } as any,
      create,
    };
  }

  it("stamps the active requestId into payload._meta when appended inside RequestContext.run", async () => {
    const { prisma, create } = makePrisma();
    const svc = new OutboxService(prisma);

    await RequestContext.run({ requestId: "req-abc-123" }, () =>
      svc.append({
        type: "order.created.v1",
        tenantId: "t-1",
        payload: { orderId: "o-1" },
      }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    // Business payload preserved verbatim…
    expect(data.payload.orderId).toBe("o-1");
    // …with the correlation id folded into the reserved envelope key.
    expect(data.payload._meta).toEqual({ requestId: "req-abc-123" });
  });

  it("honours an explicit requestId already present in _meta (no clobber)", async () => {
    const { prisma, create } = makePrisma();
    const svc = new OutboxService(prisma);

    await RequestContext.run({ requestId: "ctx-req" }, () =>
      svc.append({
        type: "order.created.v1",
        tenantId: "t-1",
        payload: { orderId: "o-2", _meta: { requestId: "explicit-req" } },
      }),
    );

    const data = create.mock.calls[0][0].data;
    expect(data.payload._meta.requestId).toBe("explicit-req");
  });

  it("does NOT add a _meta envelope when there is no active request context", async () => {
    const { prisma, create } = makePrisma();
    const svc = new OutboxService(prisma);

    // No RequestContext.run wrapper → cron / bootstrap path.
    await svc.append({
      type: "order.created.v1",
      tenantId: "t-1",
      payload: { orderId: "o-3" },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.payload.orderId).toBe("o-3");
    expect(data.payload._meta).toBeUndefined();
  });

  it("returns the generated event id unchanged (signature preserved)", async () => {
    const { prisma } = makePrisma();
    const svc = new OutboxService(prisma);
    const id = await RequestContext.run({ requestId: "req-x" }, () =>
      svc.append({ type: "order.created.v1", payload: {} }),
    );
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
