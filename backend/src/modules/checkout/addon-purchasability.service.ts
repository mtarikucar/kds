import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AddOnCatalogService } from "../marketplace/addon-catalog.service";
import { TenantMarketplaceService } from "../marketplace/tenant-marketplace.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { featureKey } from "../entitlements/entitlement-keys.const";
import { LICENSE_ADDON_CODE } from "../marketplace/catalog-validation";

export type AddonPurchasabilityErrorCode =
  | "ADDON_ALREADY_GRANTED"
  | "ADDON_ALREADY_OWNED"
  | "ADDON_REQUIRES_DEPENDENCY"
  | "ADDON_LIMIT_REDUNDANT"
  | "ADDON_MAX_QUANTITY"
  | "LICENSE_REQUIRED";

export interface AssertPurchasableInput {
  addOnCode: string;
  branchId?: string;
  quantity?: number;
}

/**
 * Codes present in the SAME cart. A prerequisite may be satisfied by a
 * sibling line rather than by something the tenant already owns — the opening
 * cart necessarily contains both the licence and the first module, and an AI
 * credit pack is legitimately bought alongside the AI module.
 */
export interface CartContext {
  cartCodes?: ReadonlySet<string>;
}

/**
 * Pre-payment purchasability gate for catalog products.
 *
 * `TenantMarketplaceService.purchase()` runs equivalent checks, but only
 * inside `confirmAndProvision` — AFTER PayTR has settled the charge. Without
 * this service a tenant can pay full price for something they already have,
 * or whose prerequisites they don't meet: the grant is then refused and there
 * is no refund rail (DEF-1 / DEF-2 / DEF-4). purchase()'s own guards stay as
 * defence in depth for callers that bypass checkout.
 */
@Injectable()
export class AddonPurchasabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AddOnCatalogService,
    private readonly entitlements: EntitlementService,
  ) {}

  async assertPurchasable(
    tenantId: string,
    input: AssertPurchasableInput,
    ctx: CartContext = {},
  ): Promise<void> {
    const addOn = await this.catalog.findByCodeOrThrow(input.addOnCode);
    const grants = (addOn.grants as Record<string, unknown> | null) ?? null;
    const ent = await this.entitlements.getForTenant(tenantId);
    const cartCodes = ctx.cartCodes ?? new Set<string>();
    const hasLicense = ent.features?.[featureKey("license")] === true;

    // 1) The licence prerequisite. Everything gated on it is unusable without
    // one — the projector suppresses the grants of every `requiresLicense`
    // product while the licence is dark — so selling one first would take
    // money for access the buyer cannot exercise.
    if (addOn.requiresLicense && !hasLicense) {
      if (!cartCodes.has(LICENSE_ADDON_CODE)) {
        this.reject(
          "LICENSE_REQUIRED",
          addOn.code,
          `"${addOn.name}" requires an active HummyTummy licence. Add the licence to your cart first.`,
        );
      }
    }

    // 2) The licence itself: one at a time. Renewal goes through the renewal
    // cycle, which re-pays the EXISTING row rather than minting a second one.
    if (addOn.kind === "license") {
      if (hasLicense) {
        this.reject(
          "ADDON_ALREADY_OWNED",
          addOn.code,
          `Your licence is already active. It renews on your anniversary.`,
        );
      }
      return; // no ownership/redundancy checks apply to the licence
    }

    // 3) Credit packs are consumable, not entitlements: buying a second pack
    // is always meaningful, so none of the ownership or redundancy checks
    // below apply. Only the dependency check does — a pack whose spending
    // module the tenant does not own is money they cannot use.
    if (addOn.kind === "credit") {
      await this.assertDeps(tenantId, addOn, cartCodes);
      return;
    }

    // 4) Already covered by the tenant's effective entitlements — paying
    // again buys nothing (DEF-1).
    if (TenantMarketplaceService.isIncludedInEntitlements(grants, ent)) {
      this.reject(
        "ADDON_ALREADY_GRANTED",
        addOn.code,
        `"${addOn.name}" is already active on your account.`,
      );
    }

    // 5) Capacity is quantity-based: owning one extra branch must not block
    // buying a second. Enforce the catalog ceiling instead of an
    // already-owned rejection (pre-3.3 this threw "change quantity instead",
    // pointing at a path that did not exist — capacity was unsellable past
    // one unit).
    const activeOwned = await this.prisma.tenantAddOn.findFirst({
      where: {
        tenantId,
        addOnId: addOn.id,
        branchId: input.branchId ?? null,
        status: "active",
      },
      select: { id: true, quantity: true },
    });

    if (addOn.kind === "capacity") {
      const owned = activeOwned?.quantity ?? 0;
      const wanted = owned + (input.quantity ?? 1);
      if (addOn.maxQuantity != null && wanted > addOn.maxQuantity) {
        this.reject(
          "ADDON_MAX_QUANTITY",
          addOn.code,
          `"${addOn.name}" is limited to ${addOn.maxQuantity} per account (you have ${owned}).`,
        );
      }
    } else if (activeOwned) {
      this.reject(
        "ADDON_ALREADY_OWNED",
        addOn.code,
        `"${addOn.name}" is already active for this ${
          input.branchId ? "branch" : "account"
        }.`,
      );
    }

    await this.assertDeps(tenantId, addOn, cartCodes);

    // 6) Redundant capacity (DEF-8) — a limit.* grant whose effective limit
    // is already unlimited (-1) buys nothing.
    for (const [key] of Object.entries(grants ?? {})) {
      if (!key.startsWith("limit.")) continue;
      if (ent.limits?.[key] === -1) {
        this.reject(
          "ADDON_LIMIT_REDUNDANT",
          addOn.code,
          `"${addOn.name}" adds capacity you already have unlimited.`,
        );
      }
    }
  }

  /**
   * Dependencies are bare catalog codes, satisfied by an ACTIVE ownership row
   * or by a sibling line in the same cart.
   *
   * The pre-3.3 `plan:<NAME>` form is gone with plans themselves; the catalog
   * validator rejects it at write time, so any that survive in old data are
   * treated as unsatisfiable — which is the truth.
   */
  private async assertDeps(
    tenantId: string,
    addOn: { code: string; name: string; deps: string[] },
    cartCodes: ReadonlySet<string>,
  ): Promise<void> {
    if (addOn.deps.length === 0) return;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const activeAddOns = await this.prisma.tenantAddOn.findMany({
      where: { tenantId, status: "active" },
      include: { addOn: { select: { code: true, name: true } } },
    });
    const have = new Set(activeAddOns.map((ta) => ta.addOn.code));

    for (const dep of addOn.deps) {
      if (have.has(dep) || cartCodes.has(dep)) continue;
      const depName =
        (
          await this.prisma.marketplaceAddOn.findUnique({
            where: { code: dep },
            select: { name: true },
          })
        )?.name ?? dep;
      this.reject(
        "ADDON_REQUIRES_DEPENDENCY",
        addOn.code,
        `"${addOn.name}" requires "${depName}". Add it to your cart first.`,
      );
    }
  }

  private reject(
    code: AddonPurchasabilityErrorCode,
    addOnCode: string,
    message: string,
  ): never {
    throw new ConflictException({ code, message, addOnCode });
  }
}
