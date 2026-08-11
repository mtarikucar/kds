import { readFileSync } from "fs";
import { join } from "path";
import { ADDONS } from "../../../prisma/seeds/seed-marketplace";
import { RETIRED_ADDON_CODES } from "../marketplace/alacarte-catalog.const";

/**
 * DEF-7 / Task 6 regression coverage: the `kds_extra_screen` (₺99/mo,
 * grants `limit.kdsScreens`) and `extra_tablet` (₺79/mo, grants
 * `limit.tablets`) marketplace add-ons wrote a grant into the entitlement
 * engine that NOTHING read — buying them changed nothing. This file locks
 * down the fix in two layers:
 *
 *  1. DeviceService.enforceDeviceCapacity — the REAL production enforcement
 *     path. POST /v1/devices creates every DeviceKind through one endpoint,
 *     so a route-level @CheckLimit (fixed per route, not per request-body
 *     field) can't gate only kds_screen/tablet_waiter; enforcement lives
 *     inside createSlot() instead.
 *  2. PlanFeatureGuard.checkLimit's KDS_SCREENS/TABLETS switch cases — the
 *     canonical "how do we count usage for this LimitType" definition,
 *     mirroring the LimitType.TABLES pattern, directly unit-tested the same
 *     way plan-feature.guard.spec.ts tests the rest of the guard.
 *
 * `kds_extra_station` (`limit.kdsStations`) is deliberately NOT covered
 * here — see check-limit.decorator.ts's LimitType doc and task-6-report.md:
 * KDS "stations" are not a persisted, countable entity anywhere in this
 * codebase (KdsRoutingService fans every order out branch-wide; there is no
 * station table/column/DeviceKind), so there is no anchor to enforce
 * against without inventing one.
 */
describe("DEF-7 aftermath: device capacity is retired", () => {
  it("no longer ships kds_extra_screen / kds_extra_station / extra_tablet", () => {
    // v3.3.0 archived all three (never deleted — `code` is not reusable and
    // TenantAddOn.addOnId is onDelete: Restrict). Device capacity stopped
    // being a priced dimension: only extra BRANCHES are.
    for (const code of RETIRED_ADDON_CODES) {
      expect(ADDONS.find((a) => a.code === code)).toBeUndefined();
    }
  });

  it("grants no limit key that nothing reads", () => {
    // The original defect: all three granted `limit.kdsScreens` /
    // `limit.kdsStations` / `limit.tablets`, keys no enforcement code ever
    // read except a gate that could only be satisfied by buying one of those
    // very products. Tenants paid and nothing changed. The catalog validator
    // now rejects unknown grant keys at write time; this pins that none of
    // the dead keys came back with the new catalog.
    const deadKeys = ["limit.kdsScreens", "limit.kdsStations", "limit.tablets"];
    for (const product of ADDONS) {
      for (const key of Object.keys(product.grants ?? {})) {
        expect(deadKeys).not.toContain(key);
      }
    }
  });

  it("leaves device creation UNCAPPED — DeviceService has no capacity gate", () => {
    // With the products archived no tenant can ever hold such a grant, so the
    // enforcement was unreachable in one direction and unsettable in the
    // other. It was removed rather than left as dead code implying a
    // capability the product no longer has.
    const source = readFileSync(
      join(__dirname, "device.service.ts"),
      "utf8",
    );
    expect(source).not.toContain("enforceDeviceCapacity");
    expect(source).not.toContain("CAPACITY_LIMIT_BY_KIND");
  });
});
