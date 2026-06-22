import { DisplayController } from "./display.controller";

/**
 * Light unit spec for the /display thin adapters: assert each handler reads the
 * authenticated screen token (req.screen) and forwards orderingSessionId /
 * tableId to the unchanged underlying service, and that POST /orders injects
 * the venue's tenant coords so the existing geofence passes.
 */
const SESSION = "a".repeat(64);

function makeReq(overrides: Record<string, any> = {}) {
  return {
    ip: "1.2.3.4",
    screen: {
      id: "scr-1",
      tenantId: "tenant-1",
      branchId: "branch-1",
      tableId: "table-1",
      partnerApiKeyId: "key-1",
      orderingSessionId: SESSION,
      scopes: ["menu:read", "orders:read", "orders:write"],
    },
    ...overrides,
  };
}

function makeDeps() {
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue(null) },
    partnerApiKey: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const menuQuery = { getPublicMenu: jest.fn().mockResolvedValue({}) };
  const customerOrders = {
    getSessionOrders: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: "o1" }),
    createWaiterRequest: jest.fn().mockResolvedValue({ id: "w1" }),
    createBillRequest: jest.fn().mockResolvedValue({ id: "b1" }),
  };
  const selfPayQuery = {
    getPayableItemsForSession: jest.fn().mockResolvedValue({}),
    getPayStatus: jest.fn().mockResolvedValue({}),
  };
  const selfPayIntent = {
    createPayIntent: jest.fn().mockResolvedValue({ merchantOid: "m1" }),
  };
  const ctrl = new DisplayController(
    prisma as any,
    menuQuery as any,
    customerOrders as any,
    selfPayQuery as any,
    selfPayIntent as any,
  );
  return {
    ctrl,
    prisma,
    menuQuery,
    customerOrders,
    selfPayQuery,
    selfPayIntent,
  };
}

describe("DisplayController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("GET /menu forwards tenantId + tableId from the screen", () => {
    const { ctrl, menuQuery } = makeDeps();
    ctrl.getMenu(makeReq());
    expect(menuQuery.getPublicMenu).toHaveBeenCalledWith("tenant-1", {
      tableId: "table-1",
    });
  });

  it("GET /menu passes undefined tableId for a tableless screen", () => {
    const { ctrl, menuQuery } = makeDeps();
    ctrl.getMenu(makeReq({ screen: { ...makeReq().screen, tableId: null } }));
    expect(menuQuery.getPublicMenu).toHaveBeenCalledWith("tenant-1", {
      tableId: undefined,
    });
  });

  it("GET /orders forwards the screen's orderingSessionId", () => {
    const { ctrl, customerOrders } = makeDeps();
    ctrl.getOrders(makeReq());
    expect(customerOrders.getSessionOrders).toHaveBeenCalledWith(SESSION);
  });

  it("POST /orders builds the customer-order DTO from req.screen (no body sessionId)", async () => {
    const { ctrl, customerOrders } = makeDeps();
    await ctrl.createOrder(makeReq(), {
      items: [{ productId: "p1", quantity: 2 }] as any,
      notes: "no onions",
    });
    expect(customerOrders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION,
        tableId: "table-1",
        notes: "no onions",
        items: [{ productId: "p1", quantity: 2 }],
      }),
    );
  });

  it("POST /orders injects the venue's tenant coords when configured", async () => {
    const { ctrl, prisma, customerOrders } = makeDeps();
    prisma.tenant.findUnique.mockResolvedValueOnce({
      latitude: 41.01,
      longitude: 28.97,
    });
    await ctrl.createOrder(makeReq(), {
      items: [{ productId: "p1", quantity: 1 }] as any,
    });
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      select: { latitude: true, longitude: true },
    });
    expect(customerOrders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 41.01, longitude: 28.97 }),
    );
  });

  it("POST /orders omits coords (undefined) when the tenant has none", async () => {
    const { ctrl, customerOrders } = makeDeps();
    await ctrl.createOrder(makeReq(), {
      items: [{ productId: "p1", quantity: 1 }] as any,
    });
    const dto = customerOrders.createOrder.mock.calls[0][0];
    expect(dto.latitude).toBeUndefined();
    expect(dto.longitude).toBeUndefined();
  });

  it("POST /waiter-requests forwards orderingSessionId + tableId + message", () => {
    const { ctrl, customerOrders } = makeDeps();
    ctrl.createWaiterRequest(makeReq(), { message: "plates" });
    expect(customerOrders.createWaiterRequest).toHaveBeenCalledWith({
      sessionId: SESSION,
      tableId: "table-1",
      message: "plates",
    });
  });

  it("POST /bill-requests forwards orderingSessionId + tableId", () => {
    const { ctrl, customerOrders } = makeDeps();
    ctrl.createBillRequest(makeReq(), {});
    expect(customerOrders.createBillRequest).toHaveBeenCalledWith({
      sessionId: SESSION,
      tableId: "table-1",
    });
  });

  it("GET /payable-items forwards the orderingSessionId", () => {
    const { ctrl, selfPayQuery } = makeDeps();
    ctrl.getPayableItems(makeReq());
    expect(selfPayQuery.getPayableItemsForSession).toHaveBeenCalledWith(
      SESSION,
    );
  });

  it("POST /pay-intent forwards sessionId, dto, ip + the key's first return origin", async () => {
    const { ctrl, prisma, selfPayIntent } = makeDeps();
    prisma.partnerApiKey.findUnique.mockResolvedValueOnce({
      allowedReturnOrigins: ["https://partner.example.com", "https://x.com"],
    });
    const body = { items: [{ orderItemId: "oi1", quantity: 1 }] } as any;
    await ctrl.createPayIntent(makeReq(), body);
    expect(prisma.partnerApiKey.findUnique).toHaveBeenCalledWith({
      where: { id: "key-1" },
      select: { allowedReturnOrigins: true },
    });
    expect(selfPayIntent.createPayIntent).toHaveBeenCalledWith(
      SESSION,
      body,
      "1.2.3.4",
      "https://partner.example.com",
    );
  });

  it("POST /pay-intent passes undefined origin when the key has none", async () => {
    const { ctrl, selfPayIntent } = makeDeps();
    const body = { items: [{ orderItemId: "oi1", quantity: 1 }] } as any;
    await ctrl.createPayIntent(makeReq(), body);
    expect(selfPayIntent.createPayIntent).toHaveBeenCalledWith(
      SESSION,
      body,
      "1.2.3.4",
      undefined,
    );
  });

  it("GET /pay-status forwards orderingSessionId + the oid query", () => {
    const { ctrl, selfPayQuery } = makeDeps();
    ctrl.getPayStatus(makeReq(), "OID-123");
    expect(selfPayQuery.getPayStatus).toHaveBeenCalledWith(SESSION, "OID-123");
  });
});
