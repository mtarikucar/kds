import { GUARDS_METADATA } from "@nestjs/common/constants";
import { InternalEntitlementsController } from "./internal-entitlements.controller";
import { InternalServiceTokenGuard } from "../../common/guards/internal-service-token.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";

/**
 * Spec for the deploy-triggered entitlement reprojection endpoint.
 *
 * Load-bearing contracts:
 *   - the handler delegates to PlanProjectorService.reconcileNightly() (the
 *     advisory-locked, idempotent "reproject EVERY tenant" sweep — NOT the
 *     boot backfill, which skips tenants that already have rows and would miss
 *     a newly-added plan feature column) and returns the { ok: true } envelope
 *     the deploy gates on;
 *   - the controller is locked behind InternalServiceTokenGuard and opted out
 *     of the global tenant-JWT pipeline via @Public — i.e. it is reachable ONLY
 *     with the internal service token, exactly like InternalProvisioningController.
 */
describe("InternalEntitlementsController", () => {
  let planProjector: { reconcileNightly: jest.Mock };
  let controller: InternalEntitlementsController;

  beforeEach(() => {
    planProjector = {
      reconcileNightly: jest.fn().mockResolvedValue(undefined),
    };
    controller = new InternalEntitlementsController(planProjector as never);
  });

  describe("reprojectAll", () => {
    it("calls the projector's reconcileNightly() sweep and returns { ok: true }", async () => {
      await expect(controller.reprojectAll()).resolves.toEqual({ ok: true });
      expect(planProjector.reconcileNightly).toHaveBeenCalledTimes(1);
    });

    it("propagates a sweep failure (so the deploy can surface it)", async () => {
      planProjector.reconcileNightly.mockRejectedValue(new Error("boom"));
      await expect(controller.reprojectAll()).rejects.toThrow("boom");
    });
  });

  describe("guarding", () => {
    it("is guarded by InternalServiceTokenGuard at the class level", () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        InternalEntitlementsController,
      );
      expect(guards).toContain(InternalServiceTokenGuard);
    });

    it("opts out of the global tenant-JWT pipeline via @Public()", () => {
      const isPublic = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        InternalEntitlementsController,
      );
      expect(isPublic).toBe(true);
    });

    it("skips the throttler (machine traffic, not a browser)", () => {
      const skip = Reflect.getMetadata(
        "THROTTLER:SKIPdefault",
        InternalEntitlementsController,
      );
      expect(skip).toBe(true);
    });
  });
});
