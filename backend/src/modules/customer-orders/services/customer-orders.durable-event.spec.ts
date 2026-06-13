import { Prisma } from "@prisma/client";
import { CustomerOrdersService } from "./customer-orders.service";

/**
 * Customer (QR) orders are created directly here, not via OrdersService, so
 * they must emit their own durable order.created.v1 — otherwise a crash after
 * the order commits but before the live kdsGateway broadcast loses the kitchen
 * signal with no replay, and physical KDS devices (kds-routing consumes
 * order.created.v1) never see customer orders at all.
 */
function build(outbox?: { append: jest.Mock }) {
  return new CustomerOrdersService(
    {} as any, // prisma
    {} as any, // posSettingsService
    {} as any, // kdsGateway
    {} as any, // customersService
    {} as any, // customerSessionService
    undefined, // stockDeductionService
    outbox as any,
  );
}

describe("CustomerOrdersService durable order event", () => {
  it("appends order.created.v1 with the kds-routing payload shape + int cents", () => {
    const append = jest.fn().mockResolvedValue("evt-1");
    const svc = build({ append });

    (svc as any).emitOrderCreated({
      id: "o-1",
      tenantId: "t-1",
      branchId: "b-1",
      tableId: "tb-1",
      status: "PENDING_APPROVAL",
      finalAmount: new Prisma.Decimal("123.45"),
    });

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order.created.v1",
        tenantId: "t-1",
        payload: expect.objectContaining({
          orderId: "o-1",
          tenantId: "t-1",
          branchId: "b-1",
          tableId: "tb-1",
          status: "PENDING_APPROVAL",
          totalCents: 12345,
        }),
      }),
    );
  });

  it("no-ops (does not throw) when the outbox is not wired", () => {
    const svc = build(undefined);
    expect(() => (svc as any).emitOrderCreated({ id: "o" })).not.toThrow();
  });
});
