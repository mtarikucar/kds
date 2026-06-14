import { SalesInvoiceController } from "./sales-invoice.controller";
import { SalesInvoiceService } from "../services/sales-invoice.service";
import { AccountingSyncService } from "../services/accounting-sync.service";

/**
 * Long-tail forwarding spec for SalesInvoiceController. Load-bearing
 * contracts: every call is tenant-scoped (IDOR), createFromOrder threads
 * orderId+tenant+dto, and syncToProvider runs the sync then re-reads the
 * fresh invoice so the caller sees the post-sync state.
 */
describe("SalesInvoiceController", () => {
  let service: Record<string, jest.Mock>;
  let sync: { syncInvoice: jest.Mock };
  let ctrl: SalesInvoiceController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    service = {
      createFromOrder: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: "inv-1", status: "SENT" }),
      cancel: jest.fn().mockResolvedValue({}),
    };
    sync = { syncInvoice: jest.fn().mockResolvedValue(undefined) };
    ctrl = new SalesInvoiceController(
      service as unknown as SalesInvoiceService,
      sync as unknown as AccountingSyncService,
    );
  });

  it("createFromOrder threads orderId, tenantId and the dto", () => {
    const dto = { customerName: "Acme" } as any;
    ctrl.createFromOrder("o1", req, dto);
    expect(service.createFromOrder).toHaveBeenCalledWith("o1", "t1", dto);
  });

  it("findAll forwards tenantId + query", () => {
    const query = { limit: 20 } as any;
    ctrl.findAll(req, query);
    expect(service.findAll).toHaveBeenCalledWith("t1", query);
  });

  it("findOne is tenant-scoped", () => {
    ctrl.findOne("inv-1", req);
    expect(service.findOne).toHaveBeenCalledWith("inv-1", "t1");
  });

  it("syncToProvider syncs then re-reads the fresh invoice", async () => {
    const out = await ctrl.syncToProvider("inv-1", req);
    expect(sync.syncInvoice).toHaveBeenCalledWith("inv-1", "t1");
    expect(service.findOne).toHaveBeenCalledWith("inv-1", "t1");
    expect(out).toEqual({ id: "inv-1", status: "SENT" });
  });

  it("cancel is tenant-scoped", () => {
    ctrl.cancel("inv-1", req);
    expect(service.cancel).toHaveBeenCalledWith("inv-1", "t1");
  });
});
