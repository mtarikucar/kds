import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import {
  CATEGORY_DEFAULT_SALE_MODE,
  SaleMode,
} from "./dto/create-hardware-product.dto";

// Hardware-quote event type. Kept as a literal so the core catalog stays
// decoupled from marketing. Must match MarketingEventTypes.HardwareQuoteRequested
// on the consumer side, which now lives in the standalone kds-marketing service
// (backend/src/modules/marketing/events/marketing-event-types.ts in that repo).
const HARDWARE_QUOTE_EVENT = "marketing.lead.hardware_quote.v1";

/**
 * Hardware product catalog. The public store reads `published` rows; the
 * super-admin UI manages everything. Inventory rows are kept in lockstep
 * with products — every product gets an empty inventory row on create.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    // OutboxModule is @Global, so OutboxService injects without a module import.
    private readonly outbox: OutboxService,
  ) {}

  async listPublic(filters?: { category?: string }) {
    const rows = await this.prisma.hardwareProduct.findMany({
      where: {
        status: "published",
        ...(filters?.category ? { category: filters.category } : {}),
      },
      include: { inventory: { select: { available: true } } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return rows.map((r) => this.toPublicView(r));
  }

  /**
   * Public lookup by SKU. Same row as findBySkuOrThrow but stripped of
   * private inventory fields (allocated, shipped, serialsAvailable).
   * Internal callers (CheckoutService quote/provision path) should keep
   * using findBySkuOrThrow directly — they need the serials column.
   */
  async findBySkuPublicOrThrow(sku: string) {
    const row = await this.prisma.hardwareProduct.findUnique({
      where: { sku },
      include: { inventory: { select: { available: true } } },
    });
    if (!row || row.status !== "published") {
      // Don't leak whether a draft/archived row exists — same NotFound
      // for both "doesn't exist" and "not for sale".
      throw new NotFoundException(`SKU not found: ${sku}`);
    }
    return this.toPublicView(row);
  }

  /**
   * Strip private inventory fields and expose only what the storefront
   * needs. `available` lets the card render the "Son N adet" low-stock
   * chip without revealing how many we've allocated or which serials
   * are queued. v2.8.87 introduced this helper alongside the
   * details/serviceMeta detail-page wiring.
   *
   * The shape returned here is the contract the SPA + landing storefronts
   * consume — adding a private field to HardwareProduct/HardwareInventory
   * does NOT bleed into the public payload unless explicitly listed here.
   */
  private toPublicView<
    T extends { inventory?: Array<{ available?: number | null }> | null },
  >(row: T) {
    const inventory = Array.isArray(row.inventory) ? row.inventory : [];
    const available = inventory.reduce(
      (acc, inv) => acc + (inv.available ?? 0),
      0,
    );
    // Strip the inventory relation entirely from the public payload —
    // we replace it with a single scalar `available` field.
    const { inventory: _omitted, ...rest } = row;
    return { ...rest, available };
  }

  async listAdmin(filters?: { status?: string; category?: string }) {
    return this.prisma.hardwareProduct.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.category ? { category: filters.category } : {}),
      },
      include: { inventory: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async findOrThrow(id: string) {
    const row = await this.prisma.hardwareProduct.findUnique({
      where: { id },
      include: { inventory: true },
    });
    if (!row) throw new NotFoundException("Product not found");
    return row;
  }

  async findBySkuOrThrow(sku: string) {
    const row = await this.prisma.hardwareProduct.findUnique({
      where: { sku },
      include: { inventory: true },
    });
    if (!row) throw new NotFoundException(`SKU not found: ${sku}`);
    return row;
  }

  async create(input: {
    sku: string;
    category: string;
    name: string;
    brand?: string;
    model?: string;
    description?: string;
    specs?: Record<string, unknown>;
    compat?: Record<string, unknown>;
    details?: Record<string, unknown>;
    serviceMeta?: Record<string, unknown>;
    priceCents: number;
    rentalMonthlyCents?: number;
    currency?: string;
    warrantyMonths?: number;
    images?: string[];
    shippingProfile?: Record<string, unknown>;
    status?: string;
    saleMode?: string;
    partnerRedirect?: Record<string, unknown>;
    complianceDocs?: Record<string, unknown>;
  }) {
    // Resolve the regulatory tier: explicit input wins, else the category
    // default (CATEGORY_DEFAULT_SALE_MODE), with the scale-without-docs
    // fallback applied. Gate publishing of regulated/direct-sale rows.
    const saleMode = this.finalSaleMode(
      input.category,
      input.saleMode,
      undefined,
      input.complianceDocs,
    );
    if ((input.status ?? "draft") === "published") {
      this.assertPublishable(
        saleMode,
        input.partnerRedirect,
        input.complianceDocs,
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.hardwareProduct.create({
          data: {
            sku: input.sku,
            category: input.category,
            name: input.name,
            brand: input.brand,
            model: input.model,
            description: input.description,
            specs: input.specs as any,
            compat: input.compat as any,
            details: input.details as any,
            serviceMeta: input.serviceMeta as any,
            priceCents: input.priceCents,
            rentalMonthlyCents: input.rentalMonthlyCents,
            currency: input.currency ?? "TRY",
            warrantyMonths: input.warrantyMonths ?? 12,
            images: input.images ?? [],
            shippingProfile: input.shippingProfile as any,
            status: input.status ?? "draft",
            saleMode,
            partnerRedirect: input.partnerRedirect as any,
            complianceDocs: input.complianceDocs as any,
          },
        });
        await tx.hardwareInventory.create({ data: { productId: product.id } });
        return product;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException(`SKU exists: ${input.sku}`);
      }
      throw e;
    }
  }

  async update(
    id: string,
    input: Partial<Omit<Parameters<CatalogService["create"]>[0], "sku">>,
  ) {
    const exists = await this.prisma.hardwareProduct.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException("Product not found");

    const effectiveCategory = input.category ?? exists.category;
    // When the category changes we re-derive the tier from the new category's
    // default (unless the caller set saleMode explicitly) so a printer→yazarkasa
    // reclassification can't keep a stale DIRECT_SALE tier and bypass the
    // regulation. When the category is unchanged we keep the existing tier.
    const categoryChanged =
      input.category !== undefined && input.category !== exists.category;
    const effectiveDocs =
      input.complianceDocs ?? (exists.complianceDocs as any);
    const saleMode = this.finalSaleMode(
      effectiveCategory,
      input.saleMode,
      categoryChanged ? undefined : (exists.saleMode as SaleMode),
      effectiveDocs,
    );
    const effectiveStatus = input.status ?? exists.status;
    // Only gate at meaningful moments so routine edits (e.g. a price tweak)
    // on an already-published product aren't blocked: when transitioning into
    // published, or when this update touches the regulated fields.
    const publishing =
      input.status === "published" && exists.status !== "published";
    const touchingRegulated =
      input.saleMode !== undefined ||
      input.partnerRedirect !== undefined ||
      input.complianceDocs !== undefined ||
      input.category !== undefined;
    if (effectiveStatus === "published" && (publishing || touchingRegulated)) {
      this.assertPublishable(
        saleMode,
        input.partnerRedirect ?? (exists.partnerRedirect as any),
        effectiveDocs,
      );
    }

    return this.prisma.hardwareProduct.update({
      where: { id },
      data: {
        category: input.category,
        name: input.name,
        brand: input.brand,
        model: input.model,
        description: input.description,
        specs: input.specs as any,
        compat: input.compat as any,
        details: input.details as any,
        serviceMeta: input.serviceMeta as any,
        priceCents: input.priceCents,
        rentalMonthlyCents: input.rentalMonthlyCents,
        currency: input.currency,
        warrantyMonths: input.warrantyMonths,
        images: input.images,
        shippingProfile: input.shippingProfile as any,
        status: input.status,
        saleMode,
        partnerRedirect: input.partnerRedirect as any,
        complianceDocs: input.complianceDocs as any,
      },
    });
  }

  /**
   * Resolve the regulatory tier to persist.
   *  - explicit `provided` wins (validated upstream by the DTO), EXCEPT the
   *    scale rule below;
   *  - else `existing` (update with unchanged category);
   *  - else the category default.
   * Scale (terazi) is metrology-regulated: it may only be DIRECT_SALE with
   * compliance docs on file. If the caller EXPLICITLY asks for a DIRECT_SALE
   * scale without docs we reject loudly (so the admin learns why); if
   * DIRECT_SALE only arrives via the category default/existing value we
   * silently fall back to RECOMMENDED_ONLY rather than sell an uncertified
   * device.
   */
  private finalSaleMode(
    category: string,
    provided: string | undefined,
    existing: SaleMode | null | undefined,
    complianceDocs: unknown,
  ): SaleMode {
    let mode: SaleMode;
    if (provided) mode = provided as SaleMode;
    else if (existing) mode = existing;
    else mode = CATEGORY_DEFAULT_SALE_MODE[category] ?? "DIRECT_SALE";

    if (
      category === "scale" &&
      mode === "DIRECT_SALE" &&
      !this.hasComplianceDocs(complianceDocs)
    ) {
      if (provided === "DIRECT_SALE") {
        // Explicit choice with no docs — give the admin a reason instead of
        // silently downgrading their selection.
        throw new BadRequestException(
          "A scale can only be DIRECT_SALE with compliance docs (calibration / conformity / commercial-use). Attach complianceDocs or leave it as RECOMMENDED_ONLY.",
        );
      }
      mode = "RECOMMENDED_ONLY";
    }
    return mode;
  }

  /** At least one non-empty compliance/warranty document is on file. */
  private hasComplianceDocs(docs: unknown): boolean {
    if (!docs || typeof docs !== "object") return false;
    return Object.values(docs as Record<string, unknown>).some(
      (v) => v !== null && v !== undefined && v !== "" && v !== false,
    );
  }

  /**
   * Block publishing rows that would render a broken/non-compliant storefront:
   *  - PARTNER_REDIRECT without a partnerRedirect.partnerUrl → dead CTA.
   *  - DIRECT_SALE without any compliance doc → seller-responsibility gap
   *    (fatura/garanti/distribütör/CE/kılavuz/servis/iade).
   * QUOTE_ONLY / RECOMMENDED_ONLY are never sold directly, so they don't gate.
   */
  private assertPublishable(
    saleMode: SaleMode,
    partnerRedirect: unknown,
    complianceDocs: unknown,
  ) {
    if (saleMode === "PARTNER_REDIRECT") {
      const url = (partnerRedirect as { partnerUrl?: unknown } | null)
        ?.partnerUrl;
      // Must be an absolute http(s) URL. The value is rendered as an outbound
      // <a href target=_blank> in the authenticated admin SPA, so reject
      // javascript:/data:/protocol-relative payloads at write time (stored-XSS
      // / open-redirect guard) — not just a non-empty string.
      if (typeof url !== "string" || !/^https?:\/\/\S+/i.test(url.trim())) {
        throw new BadRequestException(
          "PARTNER_REDIRECT products require a valid http(s) partnerRedirect.partnerUrl before publishing",
        );
      }
      return;
    }
    if (saleMode === "DIRECT_SALE" && !this.hasComplianceDocs(complianceDocs)) {
      throw new BadRequestException(
        "DIRECT_SALE products require at least one compliance document (complianceDocs) before publishing",
      );
    }
  }

  async archive(id: string) {
    // Reject archive while there are unfulfilled order lines pointing at
    // this product. Otherwise the fulfillment workflow (packing slips,
    // shipping labels, warranty registration) hits a hidden product and
    // either silently shows blanks or fails at render time. Operators
    // should either ship those orders first or cancel them.
    //
    // "Pending" here = the HardwareOrder is not yet delivered/installed/
    // refunded — the FK from items to orders gives us the order status
    // for the eligibility check.
    const pending = await this.prisma.hardwareOrderItem.count({
      where: {
        productId: id,
        order: {
          status: {
            notIn: [
              "delivered",
              "installed",
              "refunded",
              "returned",
              "cancelled",
            ],
          },
        },
      },
    });
    if (pending > 0) {
      throw new BadRequestException(
        `Cannot archive — ${pending} unfulfilled order line(s) reference this product. Ship or cancel them first.`,
      );
    }
    return this.update(id, { status: "archived" });
  }

  /**
   * "Teklif Al" for a QUOTE_ONLY device (yazarkasa / YN ÖKC). These can't be
   * bought directly (the checkout guard blocks them), so the request is
   * recorded as a marketing Lead (source=HARDWARE_QUOTE) for a rep to run the
   * authorized-dealer/service + GİB offer/installation process.
   *
   * Decoupling note: we write the shared `leads` row directly via Prisma
   * Decoupled write path: instead of writing the marketing-owned `leads`
   * table directly, we emit a `marketing.lead.hardware_quote` outbox event.
   * The marketing HardwareQuoteConsumer creates + auto-assigns the lead. This
   * keeps the core catalog free of marketing-table writes (Phase-5 split) and
   * gets auto-assignment for free. The event's idempotencyKey + the consumer's
   * deterministic externalRef dedup collapse double-submits into one lead.
   *
   * Note: until the quote reaches WON there is no automated InstallationJob —
   * a fiscal-device install must not be auto-provisioned ahead of the
   * dealer/GİB process, so the rep creates it manually.
   */
  async requestQuote(
    tenantId: string,
    input: {
      sku: string;
      qty?: number;
      contactPerson: string;
      phone?: string;
      email?: string;
      notes?: string;
    },
  ) {
    const product = await this.findBySkuOrThrow(input.sku);
    if (product.saleMode !== "QUOTE_ONLY") {
      // Only quote-only devices use this flow; other tiers are bought
      // directly, redirected to a bank/PSP, or recommended-only.
      throw new BadRequestException(`SKU ${product.sku} is not quote-only`);
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const qty = Math.min(999, Math.max(1, input.qty ?? 1));
    const summary = `[Donanım teklif talebi] ${product.name} (SKU: ${product.sku}) × ${qty}`;
    // v3.0.1 round-4 audit fix — freeze a structured snapshot of the
    // catalog row + request payload at write time. Pre-fix the Lead row
    // carried only the freeform summary string in `notes`; the marketing
    // rep had no context if the admin later renamed/archived the SKU
    // between request and dealer follow-up. The snapshot captures every
    // field the dealer's offer template needs, plus the tier so a future
    // "Teklif Al for PARTNER_REDIRECT" wouldn't be confused with the
    // QUOTE_ONLY YN ÖKC flow.
    const productSnapshot = {
      capturedAt: new Date().toISOString(),
      tenantName: tenant?.name ?? null,
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        saleMode: product.saleMode,
        category: product.category ?? null,
        priceCents: product.priceCents ?? null,
        currency: product.currency ?? null,
      },
      request: {
        qty,
        contactPerson: input.contactPerson,
        phone: input.phone ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
      },
    };
    const notes = input.notes ? `${summary}\n\n${input.notes}` : summary;
    // Deterministic dedup/idempotency key (`hwq:<tenant>:<sku>`, namespaced so
    // it can't collide with CRM external refs). The consumer upserts the lead
    // on this externalRef, so resubmits collapse into one lead; passing it as
    // the outbox idempotencyKey also keeps retried emits to a single row.
    const dedupRef = `hwq:${tenantId}:${product.sku}`;
    await this.outbox.append({
      type: HARDWARE_QUOTE_EVENT,
      tenantId,
      idempotencyKey: dedupRef,
      payload: {
        tenantId,
        dedupRef,
        businessName: tenant?.name || input.contactPerson,
        contactPerson: input.contactPerson,
        phone: input.phone ?? null,
        email: input.email ?? null,
        notes,
        productSnapshot,
        occurredAt: new Date().toISOString(),
      },
    });
    return { ok: true };
  }

  /** Inventory ops — adjust stock and serials in one place to keep totals consistent. */
  async receiveStock(productId: string, qty: number, serials?: string[]) {
    if (qty < 1) throw new BadRequestException("qty must be ≥ 1");
    return this.prisma.hardwareInventory.update({
      where: { productId },
      data: {
        available: { increment: qty },
        ...(serials && serials.length > 0
          ? { serialsAvailable: { push: serials.slice(0, qty) } }
          : {}),
      },
    });
  }

  /**
   * Atomically check-and-decrement stock for an order line. Without this
   * being a single statement, two concurrent checkouts each read the same
   * `available` count and both decrement — overselling by 1×qty.
   *
   * `updateMany` with the `available >= qty` guard is atomic in Postgres:
   * the rowlock + WHERE clause ensures only one transaction sees the row
   * as eligible. Count=0 on return means another checkout claimed it
   * first, so we throw a 409-style BadRequest with the current stock.
   *
   * Serial allocation happens in a second read after the decrement
   * commits — at that point the row is exclusively ours, so a plain
   * read + update of the remaining serials is race-free.
   */
  async allocate(
    productId: string,
    qty: number,
    tx?: Prisma.TransactionClient,
  ) {
    const client = (tx ?? this.prisma) as
      | Prisma.TransactionClient
      | PrismaService;

    const claim = await client.hardwareInventory.updateMany({
      where: { productId, available: { gte: qty } },
      data: {
        available: { decrement: qty },
        allocated: { increment: qty },
      },
    });
    if (claim.count === 0) {
      const inv = await client.hardwareInventory.findUnique({
        where: { productId },
      });
      if (!inv) throw new NotFoundException("No inventory row for product");
      throw new BadRequestException(
        `Insufficient stock: have ${inv.available}, need ${qty}`,
      );
    }

    // Pop serials post-claim. Re-reading is cheap (single row) and we know
    // we own the decrement at this point.
    const inv = await client.hardwareInventory.findUnique({
      where: { productId },
    });
    const popped = inv!.serialsAvailable.slice(0, qty);
    if (popped.length > 0) {
      const remaining = inv!.serialsAvailable.slice(popped.length);
      await client.hardwareInventory.update({
        where: { productId },
        data: { serialsAvailable: remaining },
      });
    }
    return { serials: popped };
  }

  /**
   * When a shipment leaves: allocated → shipped. Floor-guarded (allocated >=
   * qty) exactly like allocate() guards available >= qty — the sibling was
   * missing it, so a bad caller (a double markShipped, or qty > allocated)
   * silently drove `allocated` NEGATIVE and broke the
   * available + allocated + shipped = received invariant. Now it fails loud.
   */
  async markShipped(productId: string, qty: number) {
    const claim = await this.prisma.hardwareInventory.updateMany({
      where: { productId, allocated: { gte: qty } },
      data: {
        allocated: { decrement: qty },
        shipped: { increment: qty },
      },
    });
    if (claim.count === 0) {
      const inv = await this.prisma.hardwareInventory.findUnique({
        where: { productId },
      });
      if (!inv) throw new NotFoundException("No inventory row for product");
      throw new BadRequestException(
        `Cannot mark ${qty} shipped: only ${inv.allocated} unit(s) allocated for this product.`,
      );
    }
    // Row is guaranteed present (the claim matched it); return the fresh state.
    return this.prisma.hardwareInventory.findUnique({
      where: { productId },
    });
  }
}
