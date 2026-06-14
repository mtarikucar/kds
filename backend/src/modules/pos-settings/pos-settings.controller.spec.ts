import { PosSettingsController } from "./pos-settings.controller";
import { PosSettingsService } from "./pos-settings.service";
import { UpdatePosSettingsDto } from "./dto/update-pos-settings.dto";

/**
 * Long-tail forwarding spec for the thin PosSettingsController. POS
 * settings are tenant-wide; the controller forwards req.tenantId (and the
 * patch body) to the service unchanged.
 */
describe("PosSettingsController", () => {
  let svc: { findByTenant: jest.Mock; update: jest.Mock };
  let ctrl: PosSettingsController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    svc = {
      findByTenant: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    ctrl = new PosSettingsController(svc as unknown as PosSettingsService);
  });

  it("findByTenant forwards the tenantId", () => {
    ctrl.findByTenant(req);
    expect(svc.findByTenant).toHaveBeenCalledWith("t1");
  });

  it("update forwards tenantId and the patch DTO", () => {
    const dto: UpdatePosSettingsDto = { enableTablelessMode: true };
    ctrl.update(req, dto);
    expect(svc.update).toHaveBeenCalledWith("t1", dto);
  });
});
