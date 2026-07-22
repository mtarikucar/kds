import { GuidanceController } from "./guidance.controller";
import { BranchScope } from "../../../common/scoping/branch-scope";
import { UserRole } from "../../../common/constants/roles.enum";

// Thin-controller spec, matching the direct-instantiation style used for
// the rest of stock-management's controllers (see
// stock-management.controllers.spec.ts): no Nest TestingModule, the
// service is a plain jest-mock object passed straight into the
// constructor, and the handler is called with the resolved BranchScope
// (the shape @CurrentScope() hands the handler, per stock-dashboard
// .controller.ts).
const scope: BranchScope = {
  tenantId: "t1",
  branchId: "b1",
  userId: "u1",
  role: UserRole.MANAGER,
};

describe("GuidanceController", () => {
  let service: { getGuidance: jest.Mock };
  let controller: GuidanceController;

  beforeEach(() => {
    service = { getGuidance: jest.fn() };
    controller = new GuidanceController(service as any);
  });

  it("delegates to the service with tenant + branch scope", async () => {
    service.getGuidance.mockResolvedValue({
      volumeTier: "SMALL_CAFE",
      buyList: [],
      channelGuide: [],
    });

    const res = await controller.getGuidance(scope);

    expect(service.getGuidance).toHaveBeenCalledWith("t1", "b1");
    expect(res.volumeTier).toBe("SMALL_CAFE");
  });

  it("serves a cached result within the TTL for the same tenant+branch", async () => {
    service.getGuidance.mockResolvedValue({
      volumeTier: "SMALL_CAFE",
      buyList: [],
      channelGuide: [],
    });

    await controller.getGuidance(scope);
    await controller.getGuidance(scope);

    expect(service.getGuidance).toHaveBeenCalledTimes(1);
  });
});
