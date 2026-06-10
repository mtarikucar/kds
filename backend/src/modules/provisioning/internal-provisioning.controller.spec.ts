import { BadRequestException } from "@nestjs/common";
import { InternalProvisioningController } from "./internal-provisioning.controller";

/**
 * Wire-contract tests for core's server side of CoreProvisioningPort. The
 * canonical contract (core-contracts/provisioning/http-contract) says every
 * route is POST + JSON and every success is a 200 JSON ENVELOPE — these
 * tests pin the envelopes and the strict ISO-8601 body validation.
 */
describe("InternalProvisioningController", () => {
  let provisioning: {
    provisionTenantForLead: jest.Mock;
    listProvisionedLeads: jest.Mock;
    describePlan: jest.Mock;
  };
  let controller: InternalProvisioningController;

  beforeEach(() => {
    provisioning = {
      provisionTenantForLead: jest.fn(),
      listProvisionedLeads: jest.fn().mockResolvedValue([]),
      describePlan: jest.fn().mockResolvedValue(null),
    };
    controller = new InternalProvisioningController(provisioning as never);
  });

  describe("describePlan", () => {
    it("wraps a known plan in the { plan } envelope", async () => {
      const snapshot = {
        planCode: "PRO",
        planName: "Profesyonel",
        monthlyPrice: 499,
        currency: "TRY",
      };
      provisioning.describePlan.mockResolvedValue(snapshot);

      await expect(
        controller.describePlan({ planId: "plan-1" }),
      ).resolves.toEqual({ plan: snapshot });
    });

    it("returns { plan: null } for an unknown plan (200, never an empty body)", async () => {
      provisioning.describePlan.mockResolvedValue(null);

      await expect(
        controller.describePlan({ planId: "nope" }),
      ).resolves.toEqual({ plan: null });
    });

    it("400s when planId is missing", async () => {
      await expect(
        controller.describePlan({} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("listProvisionedLeads", () => {
    it("wraps the ledger entries in the { leads } envelope", async () => {
      const records = [
        { leadId: "l-1", tenantId: "t-1", planFacts: null },
      ];
      provisioning.listProvisionedLeads.mockResolvedValue(records);

      await expect(
        controller.listProvisionedLeads({
          createdAfter: "2026-06-01T00:00:00.000Z",
          createdBefore: "2026-06-02T00:00:00.000Z",
        }),
      ).resolves.toEqual({ leads: records });

      expect(provisioning.listProvisionedLeads).toHaveBeenCalledWith(
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-02T00:00:00.000Z"),
      );
    });

    it("accepts date-only ISO-8601 strings", async () => {
      await expect(
        controller.listProvisionedLeads({
          createdAfter: "2026-06-01",
          createdBefore: "2026-06-02",
        }),
      ).resolves.toEqual({ leads: [] });
    });

    it.each([
      // `new Date(null)` is the epoch and `new Date(12345)` is a timestamp:
      // a bare NaN check let these through as surprising ranges.
      ["null values", { createdAfter: null, createdBefore: null }],
      ["numbers", { createdAfter: 12345, createdBefore: 67890 }],
      ["non-ISO strings", { createdAfter: "yesterday", createdBefore: "now" }],
      [
        "calendar garbage",
        { createdAfter: "2026-99-99", createdBefore: "2026-06-02" },
      ],
      ["missing fields", {}],
      [
        "one bad field",
        { createdAfter: "2026-06-01T00:00:00Z", createdBefore: 0 },
      ],
    ])("400s on %s instead of coercing", async (_label, body) => {
      await expect(
        controller.listProvisionedLeads(body as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(provisioning.listProvisionedLeads).not.toHaveBeenCalled();
    });
  });

  describe("provisionTenantForLead", () => {
    it("passes the command through verbatim", async () => {
      const result = { tenantId: "t-1", created: true };
      provisioning.provisionTenantForLead.mockResolvedValue(result);
      const command = {
        leadId: "l-1",
        idempotencyKey: "lead-convert:l-1",
        tenantName: "Acme",
        admin: { email: "a@b.c", firstName: "A", lastName: "B" },
        plan: null,
      };

      await expect(
        controller.provisionTenantForLead(command),
      ).resolves.toBe(result);
      expect(provisioning.provisionTenantForLead).toHaveBeenCalledWith(command);
    });

    it("400s without leadId/idempotencyKey", async () => {
      await expect(
        controller.provisionTenantForLead({ leadId: "l-1" } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
