import { SuperAdminUsersController } from "./superadmin-users.controller";
import { SuperAdminUsersService } from "../services/superadmin-users.service";

/**
 * Long-tail forwarding spec for the superadmin users controller. Load-
 * bearing: setEmailVerified threads the acting super-admin's id + email
 * into the service so the override is attributable in the audit trail.
 */
describe("SuperAdminUsersController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperAdminUsersController;

  beforeEach(() => {
    svc = {
      findAll: jest.fn().mockResolvedValue([]),
      getActivity: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      setEmailVerified: jest.fn().mockResolvedValue({}),
    };
    ctrl = new SuperAdminUsersController(
      svc as unknown as SuperAdminUsersService,
    );
  });

  it("findAll forwards the filters", async () => {
    await ctrl.findAll({ search: "a" } as any);
    expect(svc.findAll).toHaveBeenCalledWith({ search: "a" });
  });

  it("findOne forwards the id", async () => {
    await ctrl.findOne("u1");
    expect(svc.findOne).toHaveBeenCalledWith("u1");
  });

  it("setEmailVerified threads the flag + the acting super-admin identity", async () => {
    await ctrl.setEmailVerified(
      "u1",
      { emailVerified: true } as any,
      "sa-1",
      "root@x.com",
    );
    expect(svc.setEmailVerified).toHaveBeenCalledWith(
      "u1",
      true,
      "sa-1",
      "root@x.com",
    );
  });
});
