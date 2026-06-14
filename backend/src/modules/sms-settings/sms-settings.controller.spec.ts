import { SmsSettingsController } from "./sms-settings.controller";
import { SmsSettingsService } from "./sms-settings.service";
import { UpdateSmsSettingsDto } from "./dto/update-sms-settings.dto";

/**
 * Long-tail forwarding spec for the thin SmsSettingsController. SMS settings
 * are tenant-scoped; the controller forwards req.tenantId (and the patch).
 */
describe("SmsSettingsController", () => {
  let svc: { findByTenant: jest.Mock; update: jest.Mock };
  let ctrl: SmsSettingsController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    svc = {
      findByTenant: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    ctrl = new SmsSettingsController(svc as unknown as SmsSettingsService);
  });

  it("findByTenant forwards the tenantId", () => {
    ctrl.findByTenant(req);
    expect(svc.findByTenant).toHaveBeenCalledWith("t1");
  });

  it("update forwards tenantId + patch", () => {
    const dto: UpdateSmsSettingsDto = { isEnabled: true };
    ctrl.update(req, dto);
    expect(svc.update).toHaveBeenCalledWith("t1", dto);
  });
});
