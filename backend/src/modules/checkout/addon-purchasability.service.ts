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
import {
  evaluatePurchasability,
  type PurchaseBlock,
} from "./addon-purchasability.rules";

export type { AddonPurchasabilityErrorCode } from "./addon-purchasability.rules";
import type { AddonPurchasabilityErrorCode } from "./addon-purchasability.rules";

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
  /**
   * This cart is a generated RENEWAL. Every line is something the tenant
   * already owns — that is what a renewal IS — so the ownership and
   * already-granted checks must not fire. Without this the renewal cart is
   * rejected line by line and nobody can ever pay their anniversary invoice.
   *
   * The licence prerequisite and the dependency check still run: a renewal
   * that drops the licence but keeps a module is exactly the case the
   * prerequisite exists for.
   */
  isRenewal?: boolean;
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
    const ent = await this.entitlements.getForTenant(tenantId);
    const cartCodes = ctx.cartCodes ?? new Set<string>();

    const facts = {
      addOn: {
        code: addOn.code,
        name: addOn.name,
        kind: addOn.kind,
        grants: (addOn.grants as Record<string, unknown> | null) ?? null,
        requiresLicense: addOn.requiresLicense,
        maxQuantity: addOn.maxQuantity ?? null,
      },
      entitlements: ent,
      quantity: input.quantity ?? 1,
      cartCodes,
      isRenewal: ctx.isRenewal,
    };

    // One implementation of "can this be bought", shared with the storefront.
    // When these were separate the store offered anything without an ownership
    // ROW — comps, operator overrides, the demo tenant's entire feature set —
    // and checkout refused the whole cart.
    //
    // Evaluated in two passes so the ownership read stays conditional: the
    // licence, already-granted and redundancy rules need no ownership at all,
    // and a product that is already granted must not cost a query to refuse.
    const withoutOwnership = evaluatePurchasability({
      ...facts,
      ownedQuantity: 0,
      isOwned: false,
    });
    if (withoutOwnership) this.rejectWith(withoutOwnership);

    if (addOn.kind !== "credit" && addOn.kind !== "license") {
      const activeOwned = await this.prisma.tenantAddOn.findFirst({
        where: {
          tenantId,
          addOnId: addOn.id,
          branchId: input.branchId ?? null,
          status: "active",
        },
        select: { id: true, quantity: true },
      });
      const blocked = evaluatePurchasability({
        ...facts,
        ownedQuantity: activeOwned?.quantity ?? 0,
        isOwned: !!activeOwned,
      });
      if (blocked) this.rejectWith(blocked);
    }

    await this.assertDeps(tenantId, addOn, cartCodes);
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

  private rejectWith(blocked: PurchaseBlock): never {
    throw new ConflictException({
      code: blocked.code,
      message: blocked.message,
      addOnCode: blocked.addOnCode,
    });
  }

  private reject(
    code: AddonPurchasabilityErrorCode,
    addOnCode: string,
    message: string,
  ): never {
    throw new ConflictException({ code, message, addOnCode });
  }
}
