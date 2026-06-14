import { AccountingSettingsController } from "./accounting-settings.controller";
import { AccountingSettingsService } from "../services/accounting-settings.service";
import { AccountingSyncService } from "../services/accounting-sync.service";

/**
 * Long-tail forwarding spec for AccountingSettingsController. Load-bearing
 * contracts: read/update both SANITIZE the settings before returning (so
 * raw vendor credentials never leave the API), tenantId comes off req, and
 * test-connection routes through the sync service.
 */
describe("AccountingSettingsController", () => {
  let service: { findByTenant: jest.Mock; update: jest.Mock; sanitize: jest.Mock };
  let sync: { testConnection: jest.Mock };
  let ctrl: AccountingSettingsController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    service = {
      findByTenant: jest.fn().mockResolvedValue({ raw: "secret" }),
      update: jest.fn().mockResolvedValue({ raw: "secret" }),
      sanitize: jest.fn().mockReturnValue({ safe: true }),
    };
    sync = { testConnection: jest.fn().mockResolvedValue(true) };
    ctrl = new AccountingSettingsController(
      service as unknown as AccountingSettingsService,
      sync as unknown as AccountingSyncService,
    );
  });

  it("findByTenant sanitizes before returning (no raw credentials leak)", async () => {
    const out = await ctrl.findByTenant(req);
    expect(service.findByTenant).toHaveBeenCalledWith("t1");
    expect(service.sanitize).toHaveBeenCalledWith({ raw: "secret" });
    expect(out).toEqual({ safe: true });
  });

  it("update persists then sanitizes the result", async () => {
    const dto = { provider: "PARASUT" } as any;
    const out = await ctrl.update(req, dto);
    expect(service.update).toHaveBeenCalledWith("t1", dto);
    expect(service.sanitize).toHaveBeenCalled();
    expect(out).toEqual({ safe: true });
  });

  it("testConnection routes through the sync service", () => {
    ctrl.testConnection(req);
    expect(sync.testConnection).toHaveBeenCalledWith("t1");
  });
});
