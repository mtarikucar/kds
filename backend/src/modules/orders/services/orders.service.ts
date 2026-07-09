import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreateOrderDto } from "../dto/create-order.dto";
import { UpdateOrderDto } from "../dto/update-order.dto";
import { UpdateOrderStatusDto } from "../dto/update-order-status.dto";
import {
  OrderStatus,
  StockMovementType,
} from "../../../common/constants/order-status.enum";
import { validateTransition } from "../../../common/utils/order-state-machine";
import { TableStatus } from "../../tables/dto/create-table.dto";
import { Logger } from "@nestjs/common";
import { KdsGateway } from "../../kds/kds.gateway";
import { DeliveryStatusSyncService } from "../../delivery-platforms/services/delivery-status-sync.service";
import { StockDeductionService } from "../../stock-management/services/stock-deduction.service";
import { SmsNotificationService } from "../../sms-settings/sms-notification.service";
import { TaxCalculationService } from "../../accounting/services/tax-calculation.service";
import { withTransaction, addBreadcrumb } from "../../../common/utils/tracing";
import { ReceiptSnapshotBuilder } from "./receipt-snapshot.builder";
import { OrderPricingCalculator } from "./order-pricing.calculator";
import {
  explodeComboLine,
  ComboCatalog,
  ComboValidationError,
} from "./combo-pricing";
import { ReservationStatus } from "../../reservations/constants/reservation-status.enum";
import { OutboxService } from "../../outbox/outbox.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";
import { MetricsService } from "../../../common/metrics/metrics.service";
import { captureSwallowedEmit } from "../../../common/observability/capture-swallowed-emit";
import { toIntCents } from "../../../common/money/to-int-cents";
import { ORDER_DETAIL_INCLUDE, buildFindAllWhere } from "./order-query.builder";
import { validateModifierSelections } from "../../../common/validators/modifier-selection.validator";

/**
 * Walk-in (POST /orders) guard window: refuse to open a new order on
 * a table whose next CONFIRMED reservation starts within this many
 * minutes. Matches the reservation-scheduler's auto-RESERVED window so
 * the two systems agree on "what counts as imminent".
 */
const RESERVATION_HOLD_WINDOW_MINUTES = 30;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private receiptSnapshotBuilder: ReceiptSnapshotBuilder,
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway: KdsGateway,
    @Optional()
    @Inject(forwardRef(() => DeliveryStatusSyncService))
    private deliveryStatusSync?: DeliveryStatusSyncService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
    @Optional()
    private smsNotificationService?: SmsNotificationService,
    @Optional()
    private taxCalculationService?: TaxCalculationService,
    // OutboxModule is @Global — Optional() because tests construct the
    // service directly without an outbox mock. When absent, emits silently
    // no-op (kds-routing falls back to the existing kdsGateway broadcast).
    @Optional()
    private outbox?: OutboxService,
    @Optional()
    private metrics?: MetricsService,
    // Pure line-item pricing math extracted from createInner()/update()
    // (wave-d2 split). @Optional with a zero-dep fallback so existing tests
    // that construct OrdersService directly (without listing the calculator
    // as a provider) keep the identical pricing behaviour.
    @Optional()
    pricingCalculator?: OrderPricingCalculator,
  ) {
    this.pricingCalculator = pricingCalculator ?? new OrderPricingCalculator();
  }

  private pricingCalculator: OrderPricingCalculator;

  /**
   * Best-effort outbox emit so the new device-mesh KDS routing (and any
   * future consumer) sees the order lifecycle. Failures are swallowed so a
   * misconfigured outbox never breaks order creation — the existing
   * kdsGateway Socket.IO path continues to power the live KDS UI.
   */
  private emitOrderEvent(
    type:
      | "order.created.v1"
      | "order.updated.v1"
      | "order.completed.v1"
      | "order.cancelled.v1",
    order: any,
  ): void {
    this.metrics?.incCounter(
      "orders_lifecycle_total",
      "Order lifecycle events by type (created|updated|completed|cancelled)",
      { type },
    );
    if (!this.outbox) return;
    this.outbox
      .append({
        type,
        tenantId: order?.tenantId,
        payload: {
          orderId: order?.id,
          tenantId: order?.tenantId,
          branchId: (order as any)?.branchId ?? null,
          tableId: order?.tableId ?? null,
          status: order?.status,
          // finalAmount lands here as a Prisma.Decimal (DB type) almost
          // always, so the previous `typeof === 'number'` check was always
          // false and `totalCents` came out undefined. Normalise via
          // String() → integer cents to dodge the IEEE-754 conversion that
          // would otherwise lose precision on large orders.
          totalCents: toIntCents(order?.finalAmount),
        },
      })
      .catch(captureSwallowedEmit(this.logger, { module: "orders", op: type }));
  }

  /**
   * Block a destructive operation (item-set rewrite, item delete,
   * order cancel) while a customer is mid-PayTR on this order. The
   * customer's intent.itemsByOrder JSON snapshot is keyed on the
   * current OrderItem ids; deleting them would orphan the intent
   * and the webhook would fail post-charge — PayTR took the money,
   * we couldn't book it, manual refund required.
   *
   * If `targetOrderItemId` is given, only blocks when THAT item
   * appears in any pending intent's itemsByOrder. Otherwise any
   * pending intent on the order blocks.
   */
  private async ensureNoInFlightSelfPayIntent(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    targetOrderItemId?: string,
  ): Promise<void> {
    const pendingIntents = await tx.pendingSelfPayment.findMany({
      where: {
        tenantId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      select: { itemsByOrder: true },
    });
    const conflicts = pendingIntents.some((intent) => {
      const buckets = intent.itemsByOrder as Array<{
        orderId: string;
        items?: Array<{ orderItemId: string; quantity: number }>;
      }>;
      if (!Array.isArray(buckets)) return false;
      return buckets.some((b) => {
        if (b?.orderId !== orderId) return false;
        if (!targetOrderItemId) return true;
        return (b.items ?? []).some((i) => i.orderItemId === targetOrderItemId);
      });
    });
    if (conflicts) {
      throw new ConflictException(
        "A customer is currently paying for this order via PayTR. " +
          "Wait until their payment finalizes (or expires) before modifying.",
      );
    }
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now();
    const random = randomUUID().substring(0, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  /**
   * Run an order-create call with retries on P2002(orderNumber). Under
   * multi-replica load two sub-ms POSTs can end up with the same Date.now()
   * + random suffix; schema unique catches it and we just roll a new
   * number. Bails with ConflictException after a handful of attempts
   * rather than looping forever.
   */
  private async createWithOrderNumberRetry<T>(
    op: (orderNumber: string) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await op(this.generateOrderNumber());
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          Array.isArray((err.meta as any)?.target) &&
          (err.meta as any).target.includes("orderNumber")
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    this.logger.error(
      `Failed to allocate order number after ${maxAttempts} tries: ${lastErr}`,
    );
    throw new BadRequestException(
      "Could not allocate an order number — please retry",
    );
  }

  async create(scope: BranchScope, createOrderDto: CreateOrderDto) {
    const created = await this.createInner(scope, createOrderDto);
    // Outbox emit happens AFTER the transaction commits so consumers don't
    // see an order that later rolled back. Best-effort: a failed emit logs
    // a warning but never undoes a committed order.
    this.emitOrderEvent("order.created.v1", created);
    return created;
  }

  /**
   * Explode COMBO order lines into a 0₺ parent grouping row + qty-1 children
   * that carry the money (spec §2/§4). Pure money math lives in combo-pricing;
   * this method resolves the server-side catalog, enforces availability, and
   * shapes the Prisma create rows. Children carry `parentOrderItemId` (the
   * parent's explicit uuid) but NOT `orderId` — the caller stamps that inside
   * the atomic $transaction once the order row exists.
   */
  private buildComboOrderItems(
    comboItems: Array<{
      productId: string;
      quantity: number;
      notes?: string;
      comboSelections?: Array<{ groupId: string; componentProductId: string }>;
    }>,
    productMap: Map<string, any>,
    now: Date,
  ): {
    parents: any[];
    children: any[];
    totalAmount: number;
    totalTaxAmount: number;
  } {
    const parents: any[] = [];
    const children: any[] = [];
    let totalAmount = 0;
    let totalTaxAmount = 0;

    for (const item of comboItems) {
      const product = productMap.get(item.productId);
      const groups = product?.comboGroups ?? [];
      if (groups.length === 0) {
        throw new BadRequestException(
          `"${product?.name ?? item.productId}" bir kombo ama içeriği tanımlı değil`,
        );
      }

      // Availability of the chosen components is enforced against the catalog.
      const availabilityById = new Map<string, boolean>();
      const catalog: ComboCatalog = {
        combo: {
          id: product.id,
          price: product.price,
          campaignPrice: product.campaignPrice,
          campaignStartAt: product.campaignStartAt,
          campaignEndAt: product.campaignEndAt,
        },
        groups: groups.map((g: any) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          items: g.items.map((it: any) => {
            availabilityById.set(
              it.componentProduct.id,
              it.componentProduct.isAvailable !== false,
            );
            return {
              componentProductId: it.componentProductId,
              quantity: it.quantity,
              priceDelta: it.priceDelta,
              isDefault: it.isDefault,
              component: {
                id: it.componentProduct.id,
                price: it.componentProduct.price,
                taxRate: it.componentProduct.taxRate,
                campaignPrice: it.componentProduct.campaignPrice,
                campaignStartAt: it.componentProduct.campaignStartAt,
                campaignEndAt: it.componentProduct.campaignEndAt,
              },
            };
          }),
        })),
      };

      // Normalize selections: the POS reopen path (mapOrderItemsToCart) can
      // only reconstruct componentProductId from the stored children, not the
      // groupId — resolve an empty/unknown groupId by finding the slot that
      // offers that component. Lets update()/re-save re-explode a reopened
      // combo without losing which slot each component filled.
      const normalizedSelections = (item.comboSelections ?? []).map((sel) => {
        if (sel.groupId) return sel;
        const g = catalog.groups.find((gr) =>
          gr.items.some(
            (it) => it.componentProductId === sel.componentProductId,
          ),
        );
        return {
          groupId: g?.id ?? "",
          componentProductId: sel.componentProductId,
        };
      });

      let exploded;
      try {
        exploded = explodeComboLine(
          catalog,
          normalizedSelections,
          item.quantity,
          now,
        );
      } catch (err) {
        if (err instanceof ComboValidationError) {
          throw new BadRequestException(err.message);
        }
        throw err;
      }

      // Reject a combo whose chosen component is out of stock / unavailable.
      const unavailable = exploded.children.find(
        (c) => availabilityById.get(c.productId) === false,
      );
      if (unavailable) {
        throw new BadRequestException(
          "Seçilen kombo bileşenlerinden biri şu an mevcut değil",
        );
      }

      const parentId = randomUUID();
      parents.push({
        id: parentId,
        productId: exploded.parent.productId,
        quantity: exploded.parent.quantity,
        unitPrice: 0,
        subtotal: 0,
        modifierTotal: 0,
        taxRate: 0,
        taxAmount: 0,
        listUnitPrice: exploded.parent.listUnitPrice,
        notes: item.notes,
      });
      for (const child of exploded.children) {
        children.push({
          parentOrderItemId: parentId,
          productId: child.productId,
          quantity: child.quantity,
          unitPrice: child.unitPrice,
          subtotal: child.subtotal,
          modifierTotal: 0,
          taxRate: child.taxRate,
          taxAmount: child.taxAmount,
          listUnitPrice: child.listUnitPrice,
        });
      }
      totalAmount += exploded.lineTotal;
      totalTaxAmount += exploded.lineTax;
    }

    return { parents, children, totalAmount, totalTaxAmount };
  }

  private async createInner(
    scope: BranchScope,
    createOrderDto: CreateOrderDto,
  ) {
    const { tenantId, userId } = scope;
    return withTransaction(
      {
        name: "order.create",
        op: "order",
        tags: {
          "order.type": createOrderDto.type,
          "tenant.id": tenantId,
          "branch.id": scope.branchId,
          "user.id": userId,
          has_table: String(!!createOrderDto.tableId),
        },
        data: {
          itemCount: createOrderDto.items.length,
        },
      },
      async () => {
        addBreadcrumb("Starting order creation", "order", {
          type: createOrderDto.type,
          itemCount: createOrderDto.items.length,
        });

        // Idempotency fast-path: if the client supplied a key and we've
        // already recorded an order for this (tenantId, branchId, key),
        // return the existing row instead of creating a duplicate.
        //
        // v3.0.1 audit fix — branchId is now part of the idempotency
        // address. Pre-fix the lookup AND the DB partial unique were
        // (tenantId, idempotencyKey) only; a POS terminal in branch B2
        // retrying with idempotencyKey=k could collide with a different
        // order created in branch B1 by another tablet using the same
        // key (UUIDv4 client-side, very low odds but non-zero, and any
        // chain that templates keys deterministically would hit it).
        // The DB migration also widens the partial unique to
        // (tenantId, branchId, idempotencyKey).
        if (createOrderDto.idempotencyKey) {
          const existing = await this.prisma.order.findFirst({
            where: {
              ...branchScope(scope),
              idempotencyKey: createOrderDto.idempotencyKey,
            },
            include: {
              orderItems: {
                include: {
                  product: {
                    select: { id: true, name: true, price: true, image: true },
                  },
                  modifiers: {
                    include: {
                      modifier: {
                        select: { id: true, name: true, priceAdjustment: true },
                      },
                    },
                  },
                },
              },
              table: { select: { id: true, number: true, section: true } },
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          });
          if (existing) {
            addBreadcrumb(
              "Idempotency hit — returning existing order",
              "order",
              {
                orderId: existing.id,
                orderNumber: existing.orderNumber,
              },
            );
            return existing;
          }
        }

        // Validate table if provided
        let tableBranchId: string | null = null;
        if (createOrderDto.tableId) {
          const table = await this.prisma.table.findFirst({
            where: {
              id: createOrderDto.tableId,
              tenantId,
            },
            select: { id: true, branchId: true },
          });

          if (!table) {
            throw new BadRequestException(
              "Invalid table or table does not belong to your tenant",
            );
          }

          // v3.0.1 audit fix (round 2) — explicit cross-branch table
          // guard. BranchGuard only proves `X-Branch-Id` is in the
          // caller's allow-list; it does NOT cross-check the request
          // body's `tableId` against the resolved scope. A waiter
          // pinned to B1 could otherwise POST a body with a tableId
          // belonging to B2 (same tenant) and the order would land on
          // B2's books, bypassing the branch isolation contract. The
          // round-1 fix only stamped scope.branchId on tableless
          // orders; this round adds the equality assertion for the
          // tableId path. Without it, the idempotency lookup
          // (scope-keyed) and the create stamp (table-keyed) also
          // diverge — see the round-2 audit note on P2002→500.
          if (table.branchId && table.branchId !== scope.branchId) {
            throw new ForbiddenException(
              "Table belongs to a different branch than the request scope. " +
                "Switch to that branch (X-Branch-Id) and retry.",
            );
          }

          // HummyTummy Phase 3: capture the table's branch so the order
          // inherits it for branch-scoped reports and KDS routing.
          tableBranchId = table.branchId;

          // Reservation-overlap guard: refuse a walk-in if there's an
          // active CONFIRMED reservation on this table that either
          //   (a) is currently in-window (start <= now <= end), or
          //   (b) starts within the next 30 minutes.
          // Without this check a waiter could open an order on a table
          // that a customer reserved weeks ago; later when they arrive,
          // the reservation seat-flow would overwrite the order's table
          // and orphan the items. SEATED reservations also block —
          // those mean the rezervationist already physically seated the
          // guest, walk-in on the same table is nonsense.
          await this.assertNoReservationOverlap(
            tenantId,
            createOrderDto.tableId,
          );
        }

        // Validate all products exist and belong to tenant.
        // Eager-load the modifier groups (active) → available modifiers so the
        // staff POS path enforces the SAME ModifierGroup required/min/max rules
        // the customer QR path enforces (see validateModifierSelections below).
        const productIds = createOrderDto.items.map((item) => item.productId);
        const products = await this.prisma.product.findMany({
          where: {
            id: { in: productIds },
            tenantId,
          },
          include: {
            modifierGroups: {
              include: {
                group: {
                  include: {
                    modifiers: {
                      where: { isAvailable: true },
                      select: { id: true },
                    },
                  },
                },
              },
            },
            // Combo slots + their selectable components (spec §5). Only
            // populated for COMBO products; a STANDARD product carries none.
            comboGroups: {
              orderBy: { displayOrder: "asc" },
              include: {
                items: {
                  orderBy: { displayOrder: "asc" },
                  include: {
                    componentProduct: {
                      select: {
                        id: true,
                        name: true,
                        price: true,
                        taxRate: true,
                        isAvailable: true,
                        campaignPrice: true,
                        campaignStartAt: true,
                        campaignEndAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (products.length !== productIds.length) {
          throw new BadRequestException(
            "One or more products are invalid or do not belong to your tenant",
          );
        }

        // Check product availability
        const unavailableProducts = products.filter((p) => !p.isAvailable);
        if (unavailableProducts.length > 0) {
          throw new BadRequestException(
            `Products not available: ${unavailableProducts.map((p) => p.name).join(", ")}`,
          );
        }

        // Validate modifiers if present
        const allModifierIds = createOrderDto.items.flatMap((item) =>
          (item.modifiers || []).map((m) => m.modifierId),
        );

        const modifiers =
          allModifierIds.length > 0
            ? await this.prisma.modifier.findMany({
                where: {
                  id: { in: allModifierIds },
                  tenantId,
                  isAvailable: true,
                },
                select: {
                  id: true,
                  name: true,
                  priceAdjustment: true,
                  groupId: true,
                },
              })
            : [];

        const modifierMap = new Map(modifiers.map((m) => [m.id, m]));

        // Validate all modifiers exist
        for (const modifierId of allModifierIds) {
          if (!modifierMap.has(modifierId)) {
            throw new BadRequestException(
              `Modifier ${modifierId} not found or unavailable`,
            );
          }
        }

        // Validate each modifier is allowed on the product the client attached
        // it to. Without this check, a malicious client could attach a $100
        // "add caviar" modifier (defined for a steak) to a $2 drink, since the
        // modifier exists somewhere in the tenant and passes isAvailable. The
        // ProductModifierGroup junction is the source of truth for "which
        // groups apply to which product"; cross-reference each modifier's
        // groupId against that mapping.
        if (allModifierIds.length > 0) {
          const productGroupLinks =
            await this.prisma.productModifierGroup.findMany({
              where: { productId: { in: productIds } },
              select: { productId: true, groupId: true },
            });
          // Map productId → Set<groupId> for O(1) lookup per modifier.
          const allowedGroupsByProduct = new Map<string, Set<string>>();
          for (const link of productGroupLinks) {
            const s =
              allowedGroupsByProduct.get(link.productId) ?? new Set<string>();
            s.add(link.groupId);
            allowedGroupsByProduct.set(link.productId, s);
          }
          for (const item of createOrderDto.items) {
            const allowed =
              allowedGroupsByProduct.get(item.productId) ?? new Set<string>();
            for (const m of item.modifiers ?? []) {
              const modifier = modifierMap.get(m.modifierId);
              if (!modifier) continue; // already caught above
              if (!allowed.has(modifier.groupId)) {
                throw new BadRequestException(
                  `Modifier "${modifier.name}" is not allowed on this product`,
                );
              }
            }
          }
        }

        // M7 — enforce ModifierGroup required / minSelections / maxSelections
        // on the staff POS path, mirroring the customer QR path
        // (customer-orders.service.validateAndCalculateItems). Without this a
        // waiter could ring a steak with no cooking-temperature (required group
        // skipped) or stack a "max 2 sauces" group past its limit — producing
        // ambiguous kitchen tickets / unlimited free extras. Pure shared helper
        // over the eager-loaded product.modifierGroups → group → modifiers{id}.
        for (const item of createOrderDto.items) {
          const product = products.find((p) => p.id === item.productId);
          if (!product) continue; // already caught above
          validateModifierSelections(
            product,
            (item.modifiers ?? []).map((m) => m.modifierId),
          );
        }

        // Build product price map from DB (never trust client-supplied prices)
        const productMap = new Map(products.map((p) => [p.id, p]));

        // Calculate totals with tax. STANDARD items go through the pure
        // OrderPricingCalculator (verbatim math, now campaign-aware). COMBO
        // items explode into a 0₺ parent + qty-1 children carrying the money
        // (spec §2/§4) — priced by buildComboOrderItems below. Children are
        // written in a second, atomic step (they need orderId).
        const now = new Date();
        const standardDtoItems = createOrderDto.items.filter(
          (i) => productMap.get(i.productId)?.productType !== "COMBO",
        );
        const comboDtoItems = createOrderDto.items.filter(
          (i) => productMap.get(i.productId)?.productType === "COMBO",
        );
        const standard = this.pricingCalculator.priceItems(
          standardDtoItems,
          productMap,
          modifierMap,
          this.taxCalculationService,
          now,
        );
        const combo = this.buildComboOrderItems(
          comboDtoItems,
          productMap as any,
          now,
        );
        // Top-level create rows = standard rows + combo parent rows. Combo
        // children are held back for the atomic second write.
        const orderItems = [...standard.orderItems, ...combo.parents];
        const comboChildren = combo.children;
        const round2 = (n: number) => Math.round(n * 100) / 100;
        const totalAmount = round2(standard.totalAmount + combo.totalAmount);
        const totalTaxAmount = round2(
          standard.totalTaxAmount + combo.totalTaxAmount,
        );

        // Cap the discount at the order total — discount > total would mint a
        // negative finalAmount and effectively pay the customer. DTO `@Min(0)`
        // blocks negative discounts but not over-discounts, and a free-form
        // admin field can hit this even on legit flows (typo, copy/paste).
        const requestedDiscount = createOrderDto.discount || 0;
        if (requestedDiscount > totalAmount) {
          throw new BadRequestException(
            `Discount (${requestedDiscount}) cannot exceed order total (${totalAmount}).`,
          );
        }
        const discount = requestedDiscount;
        const finalAmount = totalAmount - discount;

        // Recalculate tax after discount (proportional)
        const discountRatio = totalAmount > 0 ? discount / totalAmount : 0;
        const adjustedTaxAmount =
          Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100;

        // Shared read shape for the created order (both the plain and the
        // combo-atomic write branches return exactly this).
        const orderCreateInclude = {
          orderItems: {
            include: {
              product: {
                select: { id: true, name: true, price: true, image: true },
              },
              modifiers: {
                include: {
                  modifier: {
                    select: { id: true, name: true, priceAdjustment: true },
                  },
                },
              },
            },
          },
          table: { select: { id: true, number: true, section: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        } satisfies Prisma.OrderInclude;

        // Create order with items — wrapped in a retry so two near-simultaneous
        // POSTs that happen to mint the same orderNumber don't both 500 out.
        const createdOrder = await this.createWithOrderNumberRetry(
          async (orderNumber) => {
            const createData: any = {
              orderNumber,
              type: createOrderDto.type,
              status: OrderStatus.PENDING,
              requiresApproval: false, // POS orders don't require approval
              totalAmount,
              discount,
              finalAmount,
              taxAmount: adjustedTaxAmount,
              notes: createOrderDto.notes,
              customerName: createOrderDto.customerName,
              userId,
              tenantId,
              idempotencyKey: createOrderDto.idempotencyKey,
              orderItems: {
                create: orderItems,
              },
            };

            if (createOrderDto.tableId) {
              createData.tableId = createOrderDto.tableId;
            }
            // v3.0.1 audit fix — always stamp branchId from the caller's
            // BranchScope. Pre-fix only the tableId path inherited the
            // branch from the Table row, so tableless/counter/QR-self
            // orders ended up at branchId=null and disappeared from
            // every branchScope()-filtered read (KDS, reports, daily
            // totals).
            //
            // Post-round-2: the cross-branch guard above asserts
            // `table.branchId === scope.branchId` whenever the table's
            // branchId is non-null, so `tableBranchId` and
            // `scope.branchId` are provably equal in that case. The
            // `??` falls through only for legacy single-branch tables
            // whose `branchId` is still NULL (pre-v3 rows that escaped
            // the strict-branch backfill). The variable is kept rather
            // than collapsing to `scope.branchId` to keep the
            // "inherits from the seated table" intent legible — a
            // future audit re-reading this block sees the table-tier
            // first, the scope-tier fallback second.
            createData.branchId = tableBranchId ?? scope.branchId;

            // No combos → single atomic nested create (unchanged path).
            if (comboChildren.length === 0) {
              return this.prisma.order.create({
                data: createData,
                include: orderCreateInclude,
              });
            }

            // Combos present → the qty-1 children need the order's id AND their
            // parent's id, which a single nested create can't wire (orderId is
            // NOT NULL, siblings can't connect to siblings-being-created). Do
            // it atomically: create the order + top-level rows (combo parents
            // carry an explicit id), then createMany the children with both
            // FKs, then re-read the full shape. A P2002 on orderNumber bubbles
            // out of the $transaction and is retried by the wrapper.
            return this.prisma.$transaction(async (tx) => {
              const order = await tx.order.create({ data: createData });
              await tx.orderItem.createMany({
                data: comboChildren.map((c) => ({
                  ...c,
                  orderId: order.id,
                })),
              });
              return tx.order.findUniqueOrThrow({
                where: { id: order.id },
                include: orderCreateInclude,
              });
            });
          },
        );

        // Keep table.status in sync with order presence. updateStatus
        // already flips OCCUPIED on transitions into active states; the
        // create path used to skip this, leaving freshly-created PENDING
        // orders on AVAILABLE tables — a violation of the invariant
        // "table is OCCUPIED iff any active order references it".
        if (createdOrder.tableId) {
          await this.prisma.table.update({
            where: { id: createdOrder.tableId },
            data: { status: TableStatus.OCCUPIED },
          });
        }

        // Build the kitchen ticket snapshot now that the order has its
        // generated orderNumber. The snapshot is written via a separate
        // order.update call because the orderNumber is allocated by the
        // retry helper inside order.create — we can't include the snapshot
        // in the create payload without a chicken-and-egg problem.
        //
        // Note: this is a second query, not atomic with order.create. That
        // matches the existing pattern in this method (stockDeduction, sms
        // notifications also run as separate post-create operations).
        // Fail-soft: a builder error logs and leaves the snapshot null —
        // reprintability is a convenience, not source of truth.
        try {
          const kitchenTicketSnapshot =
            this.receiptSnapshotBuilder.buildKitchenTicketSnapshot({
              order: ReceiptSnapshotBuilder.toBuilderOrder(createdOrder),
            }) as unknown as Prisma.InputJsonValue;
          await this.prisma.order.update({
            where: { id: createdOrder.id },
            data: { kitchenTicketSnapshot },
          });
          (createdOrder as any).kitchenTicketSnapshot = kitchenTicketSnapshot;
        } catch (snapErr) {
          this.logger.warn(
            `Failed to build kitchen ticket snapshot for order ${createdOrder.orderNumber}: ${(snapErr as Error).message}`,
          );
          (createdOrder as any).kitchenTicketSnapshot = null;
        }

        // Emit new order to kitchen via WebSocket
        this.kdsGateway.emitNewOrder(
          tenantId,
          createdOrder.branchId,
          createdOrder,
        );

        // Auto-deduct ingredients if configured (respects deductOnStatus setting)
        if (this.stockDeductionService) {
          try {
            const deductResult =
              await this.stockDeductionService.deductForOrder(
                createdOrder.id,
                tenantId,
                OrderStatus.PENDING,
              );
            if (deductResult?.lowStockAlerts?.length > 0) {
              this.kdsGateway.emitLowStockAlert(
                tenantId,
                createdOrder.branchId,
                deductResult.lowStockAlerts,
              );
            }
          } catch (error: any) {
            this.logger.error(
              `Ingredient deduction failed for order ${createdOrder.orderNumber}: ${error.message}`,
              error.stack,
            );
          }
        }

        // Decrement finished-good (menu-product) stock for stockTracked
        // products. This is the writer the POS currentStock badge / out-of-stock
        // gate depended on — without it the badge never moved after a sale.
        // Best-effort + post-commit: an oversell on a race is logged, never
        // blocks the already-created order (the POS card already gates on
        // currentStock===0, so this only matters under concurrency).
        try {
          await this.deductStockForOrder(createdOrder.id, tenantId);
        } catch (error: any) {
          this.logger.error(
            `Product stock deduction failed for order ${createdOrder.orderNumber}: ${error.message}`,
          );
        }

        addBreadcrumb("Order created successfully", "order", {
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
        });

        // Send SMS to customer if phone available
        if (createdOrder.customerPhone && this.smsNotificationService) {
          this.smsNotificationService.notifyOrderCreated(tenantId, {
            customerPhone: createdOrder.customerPhone,
            orderNumber: createdOrder.orderNumber,
          });
        }

        return createdOrder;
      },
    );
  }

  async findAll(
    scope: BranchScope,
    tableId?: string,
    statuses?: OrderStatus[],
    startDate?: Date,
    endDate?: Date,
    take: number = 100,
    skip: number = 0,
  ) {
    // WHERE assembly (branch-scope + optional tableId/status/date window)
    // moved VERBATIM into the pure buildFindAllWhere builder — no behaviour
    // change, just isolates the read-path shape from the query execution.
    const where = buildFindAllWhere(
      scope,
      tableId,
      statuses,
      startDate,
      endDate,
    );

    const orders = await this.prisma.order.findMany({
      where,
      include: ORDER_DETAIL_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: Math.min(take, 500),
      skip,
    });

    return orders;
  }

  async findOne(scope: BranchScope, id: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        ...branchScope(scope),
      },
      include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  /**
   * Tenant-only order lookup for SYSTEM callers (PaymentsService
   * cross-flow checks, webhook settlement, schedulers). HTTP handlers
   * must use `findOne(scope, id)` — the @CurrentScope() path is the
   * canonical branch-isolation boundary; this method intentionally
   * bypasses it because payment flows can legitimately reach across
   * the branch axis (e.g. a checkout endpoint settling an order whose
   * branch matches the caller's scope already via prior validation).
   *
   * Only call from server-internal code paths. Never expose to an
   * HTTP handler — the lint rule `controller-needs-scope-or-skip` is
   * the runtime gate for that.
   */
  async findOneByTenant(id: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }
    return order;
  }

  async update(scope: BranchScope, id: string, updateOrderDto: UpdateOrderDto) {
    // Check if order exists and belongs to scope
    const order = await this.findOne(scope, id);

    // Don't allow updates to paid or cancelled orders
    if (
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw new BadRequestException("Cannot update paid or cancelled orders");
    }

    const updateData: any = {
      notes: updateOrderDto.notes,
      customerName: updateOrderDto.customerName,
    };

    // Combo children written in the atomic second step of the item rewrite.
    let comboChildren: any[] = [];

    // If items are provided, update the order items
    if (updateOrderDto.items && updateOrderDto.items.length > 0) {
      // Validate all products exist and belong to tenant
      // (Product/Modifier are tenant-scoped catalog rows, not branch-scoped.)
      // Eager-load modifier groups so update() enforces the SAME
      // belongs-to-product + required/min/max rules as createInner / the QR
      // path — previously update() did neither (M7).
      const productIds = updateOrderDto.items.map((item) => item.productId);
      const products = await this.prisma.product.findMany({
        where: {
          id: { in: productIds },
          tenantId: scope.tenantId,
        },
        include: {
          modifierGroups: {
            include: {
              group: {
                include: {
                  modifiers: {
                    where: { isAvailable: true },
                    select: { id: true },
                  },
                },
              },
            },
          },
          // Combo slots so update() can re-explode a combo line (POS reopen +
          // add-items keeps the combo priced correctly instead of rejecting).
          comboGroups: {
            orderBy: { displayOrder: "asc" },
            include: {
              items: {
                orderBy: { displayOrder: "asc" },
                include: {
                  componentProduct: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      taxRate: true,
                      isAvailable: true,
                      campaignPrice: true,
                      campaignStartAt: true,
                      campaignEndAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (products.length !== productIds.length) {
        throw new BadRequestException(
          "One or more products are invalid or do not belong to your tenant",
        );
      }

      // Check product availability
      const unavailableProducts = products.filter((p) => !p.isAvailable);
      if (unavailableProducts.length > 0) {
        throw new BadRequestException(
          `Products not available: ${unavailableProducts.map((p) => p.name).join(", ")}`,
        );
      }

      // Fetch modifiers DB-side too — do NOT trust client-sent prices
      // or IDs. Previously modifiers were silently dropped on update(),
      // so a customer tweak that removed or reordered modifiers left the
      // bill wrong.
      const allModifierIds = updateOrderDto.items.flatMap((item) =>
        (item.modifiers || []).map((m) => m.modifierId),
      );
      const modifiers =
        allModifierIds.length > 0
          ? await this.prisma.modifier.findMany({
              where: {
                id: { in: allModifierIds },
                tenantId: scope.tenantId,
                isAvailable: true,
              },
            })
          : [];
      const modifierMap = new Map(modifiers.map((m) => [m.id, m]));
      for (const modifierId of allModifierIds) {
        if (!modifierMap.has(modifierId)) {
          throw new BadRequestException(
            `Modifier ${modifierId} not found or unavailable`,
          );
        }
      }

      // M7 — update() previously skipped the belongs-to-product cross-reference
      // AND the required/min/max enforcement entirely. Apply the same shared
      // helper as createInner so a PATCH can't smuggle in a foreign modifier,
      // skip a required group, or exceed a group's max.
      for (const item of updateOrderDto.items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) continue; // already caught above
        validateModifierSelections(
          product,
          (item.modifiers ?? []).map((m) => m.modifierId),
        );
      }

      // Build product price map from DB (never trust client-supplied prices)
      const productMap = new Map(products.map((p) => [p.id, p]));

      // Calculate new totals using server-side prices. STANDARD items go
      // through the pure calculator (campaign-aware); COMBO items explode into
      // a 0₺ parent + qty-1 children — same split as createInner so a reopened
      // combo table can be re-saved (add items) without losing/mis-pricing the
      // combo. Children are written in the atomic second step below.
      const now = new Date();
      const standardDtoItems = updateOrderDto.items.filter(
        (i) => (productMap.get(i.productId) as any)?.productType !== "COMBO",
      );
      const comboDtoItems = updateOrderDto.items.filter(
        (i) => (productMap.get(i.productId) as any)?.productType === "COMBO",
      );
      const standard = this.pricingCalculator.priceItems(
        standardDtoItems,
        productMap,
        modifierMap,
        this.taxCalculationService,
        now,
      );
      const combo = this.buildComboOrderItems(
        comboDtoItems as any,
        productMap as any,
        now,
      );
      const orderItems = [...standard.orderItems, ...combo.parents];
      comboChildren = combo.children;
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const totalAmount = round2(standard.totalAmount + combo.totalAmount);
      const totalTaxAmount = round2(
        standard.totalTaxAmount + combo.totalTaxAmount,
      );

      const rawDiscount =
        updateOrderDto.discount !== undefined
          ? updateOrderDto.discount
          : Number(order.discount);
      // Cap discount at totalAmount — same protection as the
      // create() path. Shrinking the item set during update could
      // leave a stored discount > new totalAmount, which would mint
      // a negative finalAmount (we'd be paying the customer).
      const discount = Math.min(rawDiscount, totalAmount);
      const finalAmount = totalAmount - discount;

      // Recalculate tax after discount (proportional)
      const discountRatio = totalAmount > 0 ? discount / totalAmount : 0;
      const adjustedTaxAmount =
        Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100;

      updateData.orderItems = {
        create: orderItems,
      };
      updateData.totalAmount = totalAmount;
      updateData.discount = discount;
      updateData.finalAmount = finalAmount;
      updateData.taxAmount = adjustedTaxAmount;
    } else if (updateOrderDto.discount !== undefined) {
      // Discount-only update: cap the value here (cheap), but defer
      // the allocation + self-pay-intent guards to INSIDE the tx —
      // outside-tx reads can miss a webhook that lands between the
      // check and the write. The tx-scoped guards are in the
      // transaction body below.
      const totalAmountDec = new Prisma.Decimal(order.totalAmount);
      const rawDiscount = new Prisma.Decimal(updateOrderDto.discount);
      const cappedDiscount = rawDiscount.gt(totalAmountDec)
        ? totalAmountDec
        : rawDiscount;
      updateData.discount = cappedDiscount;
      const newFinalAmount = totalAmountDec.sub(cappedDiscount);
      updateData.finalAmount = newFinalAmount;
      // Re-derive the (KDV-inclusive) tax proportionally — the other three
      // money paths (createInner, items-rewrite at 905-908, removeItem) all
      // recompute taxAmount after a discount; the discount-only branch used to
      // leave order.taxAmount stale, so the printed fiş showed KDV for the
      // pre-discount total. taxAmount scales linearly with the discounted
      // total (taxAmount/finalAmount = grossTax/totalAmount is constant), so
      // newTax = currentTax × newFinal/oldFinal — exact even when a discount
      // already existed (a flat (1−ratio) on the stored tax would double-count).
      const oldFinalAmount = new Prisma.Decimal(order.finalAmount);
      updateData.taxAmount = oldFinalAmount.gt(0)
        ? new Prisma.Decimal(order.taxAmount)
            .mul(newFinalAmount)
            .div(oldFinalAmount)
            .toDecimalPlaces(2)
        : new Prisma.Decimal(0);
    }

    // Atomic replace of the item set: a crash between the deleteMany
    // and the nested create previously produced empty orders. Same tx
    // covers the order.update so a validation failure doesn't leave
    // the order without its items.
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // v2.8.94 — SELECT...FOR UPDATE on the order row before any
      // other read inside the txn. Pre-fix the ensureNoInFlightSelfPayIntent
      // check (line 945) and the deleteMany (line 946) had a real but
      // small race window: a customer-self-pay PayTR intent
      // concurrently being created would see no order lock to block on
      // and could land its pendingSelfPayment row between the check and
      // the items deleteMany — the waiter rewrites the cart, the
      // customer's PayTR webhook finalizes against orphan item ids,
      // and the customer reports a phantom charge. The row lock
      // serializes all concurrent waiters and the self-pay creator
      // against the same order.
      await tx.$queryRaw`
        SELECT id FROM orders WHERE id = ${id} AND "tenantId" = ${scope.tenantId} AND "branchId" = ${scope.branchId} FOR UPDATE
      `;
      // Re-verify status inside the transaction: a concurrent cancel /
      // pay between the findOne above and this write could otherwise let
      // us layer new items onto a PAID/CANCELLED order (corrupting the
      // audit trail). The terminal statuses are guarded at line 468 but
      // only against the stale snapshot. Compound scope WHERE also
      // doubles as defense-in-depth against a regression that drops
      // the findOne(scope, id) pre-check.
      const stillEditable = await tx.order.count({
        where: {
          id,
          ...branchScope(scope),
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      if (stillEditable === 0) {
        throw new BadRequestException("Cannot update paid or cancelled orders");
      }
      // Discount-only updates: both the allocation and self-pay
      // guards run INSIDE the tx so a webhook landing between the
      // pre-tx read and the order.update can't slip past. Mirrors
      // the items-rewrite branch below.
      if (updateOrderDto.discount !== undefined && !updateData.orderItems) {
        const allocCount = await tx.orderItemPayment.count({
          where: { tenantId: scope.tenantId, orderItem: { orderId: id } },
        });
        if (allocCount > 0) {
          throw new ConflictException(
            "Cannot change the order discount once any per-item payment has been collected. " +
              "Refund the existing payment(s) first, then re-apply the discount.",
          );
        }
        // A plain (non-per-item) Payment — e.g. a partial cash payment via
        // create() — writes no OrderItemPayment row, so the allocCount guard
        // above misses it. Without this, a discount that drops finalAmount
        // below the amount already collected silently over-charges the
        // customer (order.finalAmount < Σ COMPLETED payments) with no refund.
        const paidAgg = await tx.payment.aggregate({
          where: {
            orderId: id,
            tenantId: scope.tenantId,
            status: "COMPLETED",
          },
          _sum: { amount: true },
        });
        const alreadyPaid = new Prisma.Decimal(paidAgg._sum.amount ?? 0);
        const newFinal = new Prisma.Decimal(updateData.finalAmount as any);
        if (alreadyPaid.gt(0) && newFinal.lt(alreadyPaid)) {
          throw new ConflictException(
            "Cannot lower the order total below the amount already paid. " +
              "Refund the existing payment(s) first, then re-apply the discount.",
          );
        }
        await this.ensureNoInFlightSelfPayIntent(tx, id, scope.tenantId);
      }
      if (updateData.orderItems) {
        // The whole-order rewrite path drops every existing OrderItem
        // and recreates the requested set. If any of the items being
        // dropped has an OrderItemPayment row, the FK Restrict would
        // fire on the deleteMany — and even if the cascade allowed it,
        // a customer who already paid for their share would lose the
        // audit trail of what they bought.
        //
        // For surgical changes (waiter wants to remove ONE unpaid item
        // from a table where other customers already paid) use the
        // dedicated `DELETE /orders/:orderId/items/:itemId` endpoint
        // which preserves untouched allocations.
        const paidItemCount = await tx.orderItemPayment.count({
          where: { tenantId: scope.tenantId, orderItem: { orderId: id } },
        });
        if (paidItemCount > 0) {
          throw new ConflictException(
            "Cannot rewrite the full item set when partial per-item payments exist. " +
              "Use DELETE /orders/:orderId/items/:itemId to drop a single unpaid item, " +
              "or refund the payment(s) first.",
          );
        }
        // Block when a customer is mid-PayTR on this order — the
        // intent's itemsByOrder JSON snapshot references the
        // current OrderItem ids; deleteMany would orphan them and
        // the webhook would fail with "item no longer exists" AFTER
        // PayTR already charged the card.
        await this.ensureNoInFlightSelfPayIntent(tx, id, scope.tenantId);
        await tx.orderItem.deleteMany({ where: { orderId: id } });
      }
      const updateInclude = {
        orderItems: {
          include: {
            product: {
              select: { id: true, name: true, price: true, image: true },
            },
          },
        },
        table: { select: { id: true, number: true, section: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      } satisfies Prisma.OrderInclude;

      const updated = await tx.order.update({
        where: { id },
        data: updateData,
        include: updateInclude,
      });

      // Combo children reference the (now-created) parent + the order, so they
      // are written in the same atomic tx AFTER the parents exist, then the
      // order is re-read with the full response shape.
      if (comboChildren.length > 0) {
        await tx.orderItem.createMany({
          data: comboChildren.map((c) => ({ ...c, orderId: id })),
        });
        return tx.order.findUniqueOrThrow({
          where: { id },
          include: updateInclude,
        });
      }
      return updated;
    });

    // Always emit to kitchen via WebSocket when order is updated
    // This ensures KDS updates even when only discount/notes/customerName change
    this.kdsGateway.emitOrderUpdated(
      scope.tenantId,
      updatedOrder.branchId,
      updatedOrder,
    );

    // Mesh-side consumers (kds-routing, webhooks-outbound) see the change via
    // the outbox. Distinct event type so consumers can opt into "any update"
    // vs. "completion" vs. "cancellation" without parsing payload bodies.
    this.emitOrderEvent("order.updated.v1", updatedOrder);

    return updatedOrder;
  }

  async updateStatus(
    scope: BranchScope,
    id: string,
    updateStatusDto: UpdateOrderStatusDto,
  ) {
    // Use transaction to prevent race conditions on status transitions
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Check if order exists and belongs to scope (tenant + branch)
      const order = await tx.order.findFirst({
        where: { id, ...branchScope(scope) },
        include: {
          orderItems: { include: { product: true } },
          table: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      // Prevent status updates for orders awaiting approval (must use approve endpoint)
      if (
        order.requiresApproval &&
        order.status === OrderStatus.PENDING_APPROVAL
      ) {
        throw new BadRequestException(
          "Order requires approval before status can be changed. Please approve the order first.",
        );
      }

      // Validate state transition using state machine (STRICT mode)
      validateTransition(order.status as OrderStatus, updateStatusDto.status);

      // Block CANCELLED if there are any per-item payments. A CANCELLED
      // order with active OrderItemPayment rows leaves the customer who
      // already paid for their share without a refund trail — refund
      // the payment(s) explicitly instead, which also frees the items.
      if (updateStatusDto.status === OrderStatus.CANCELLED) {
        const paidItemCount = await tx.orderItemPayment.count({
          where: { tenantId: scope.tenantId, orderItem: { orderId: id } },
        });
        if (paidItemCount > 0) {
          throw new ConflictException(
            "Cannot cancel an order with partial per-item payments. Refund the corresponding payment(s) first.",
          );
        }
      }

      // Build update data with status timestamps
      const statusUpdateData: any = { status: updateStatusDto.status };
      if (updateStatusDto.status === OrderStatus.PREPARING)
        statusUpdateData.preparingAt = new Date();
      if (updateStatusDto.status === OrderStatus.READY)
        statusUpdateData.readyAt = new Date();
      if (updateStatusDto.status === OrderStatus.CANCELLED)
        statusUpdateData.cancelledAt = new Date();

      // Conditional write: include the observed `order.status` in the
      // where filter so two concurrent transitions can't both pass the
      // (stale) validateTransition above and both write. Mirrors the
      // race-safe pattern in customers/loyalty.service.ts:50-107.
      const writeResult = await tx.order.updateMany({
        where: { id, status: order.status },
        data: statusUpdateData,
      });
      if (writeResult.count === 0) {
        throw new BadRequestException(
          `Order state changed mid-flight; please retry. Expected ${order.status}, found something else.`,
        );
      }
      const updated = await tx.order.findUniqueOrThrow({
        where: { id },
        include: {
          orderItems: { include: { product: true } },
          table: true,
        },
      });

      // Ensure table status is synced with order status
      if (updated.tableId) {
        const activeStatuses = [
          OrderStatus.PENDING,
          OrderStatus.PREPARING,
          OrderStatus.READY,
          OrderStatus.SERVED,
        ];

        if (activeStatuses.includes(updateStatusDto.status as OrderStatus)) {
          await tx.table.update({
            where: { id: updated.tableId },
            data: { status: TableStatus.OCCUPIED },
          });
        } else if (
          updateStatusDto.status === OrderStatus.PAID ||
          updateStatusDto.status === OrderStatus.CANCELLED
        ) {
          const activeOrdersCount = await tx.order.count({
            where: {
              tableId: updated.tableId,
              id: { not: id },
              status: { in: activeStatuses },
            },
          });

          if (activeOrdersCount === 0) {
            await tx.table.update({
              where: { id: updated.tableId },
              data: { status: TableStatus.AVAILABLE },
            });
          }
        }
      }

      return updated;
    });

    // Reverse finished-good (Product.currentStock) deductions on cancellation —
    // symmetric with deductStockForOrder so a cancelled stockTracked sale
    // restores its units (idempotent; no-op when nothing was deducted).
    if (updateStatusDto.status === OrderStatus.CANCELLED) {
      try {
        await this.reverseProductStockForOrder(id, scope.tenantId);
      } catch (error: any) {
        this.logger.error(
          `Product stock reversal failed for cancelled order ${id}: ${error.message}`,
        );
      }
    }

    // Reverse ingredient deductions on cancellation
    if (
      updateStatusDto.status === OrderStatus.CANCELLED &&
      this.stockDeductionService
    ) {
      try {
        await this.stockDeductionService.reverseForOrder(id, scope.tenantId);
      } catch (error: any) {
        this.logger.error(
          `CRITICAL: Stock reversal failed for cancelled order ${id}. Manual stock adjustment may be needed. Error: ${error.message}`,
          error.stack,
        );
        this.kdsGateway.emitStockReversalFailed(
          scope.tenantId,
          updatedOrder.branchId,
          {
            orderNumber: updatedOrder.orderNumber,
            message: `Stock reversal failed for order ${updatedOrder.orderNumber}. Please verify inventory.`,
          },
        );
      }
    }

    // Auto-deduct ingredients on status change (respects deductOnStatus setting)
    if (
      this.stockDeductionService &&
      updateStatusDto.status !== OrderStatus.CANCELLED
    ) {
      try {
        const deductResult = await this.stockDeductionService.deductForOrder(
          id,
          scope.tenantId,
          updateStatusDto.status,
        );
        if (deductResult?.lowStockAlerts?.length > 0) {
          this.kdsGateway.emitLowStockAlert(
            scope.tenantId,
            updatedOrder.branchId,
            deductResult.lowStockAlerts,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Ingredient deduction failed for order ${id} on status ${updateStatusDto.status}: ${error.message}`,
          error.stack,
        );
      }
    }

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(
      scope.tenantId,
      updatedOrder.branchId,
      id,
      updateStatusDto.status,
    );

    // Sync status to delivery platform (if applicable)
    this.deliveryStatusSync
      ?.syncStatusToPlatform(id, updateStatusDto.status)
      .catch((err) => {
        this.logger.error(
          `Delivery platform sync failed for order ${id}: ${err.message}`,
        );
      });

    // Send SMS to customer on key status changes
    if (updatedOrder.customerPhone && this.smsNotificationService) {
      if (updateStatusDto.status === OrderStatus.PREPARING) {
        this.smsNotificationService.notifyOrderPreparing(scope.tenantId, {
          customerPhone: updatedOrder.customerPhone,
          orderNumber: updatedOrder.orderNumber,
        });
      } else if (updateStatusDto.status === OrderStatus.READY) {
        this.smsNotificationService.notifyOrderReady(scope.tenantId, {
          customerPhone: updatedOrder.customerPhone,
          orderNumber: updatedOrder.orderNumber,
        });
      } else if (updateStatusDto.status === OrderStatus.CANCELLED) {
        this.smsNotificationService.notifyOrderCancelled(scope.tenantId, {
          customerPhone: updatedOrder.customerPhone,
          orderNumber: updatedOrder.orderNumber,
        });
      }
    }

    // Outbox emit with the matching event type so kds-routing can clear the
    // KDS screen on completion / cancellation. The mesh consumer subscribes
    // to all three (created/updated/completed/cancelled) and dispatches a
    // `clear_order` command on the terminal transitions.
    // PAID and SERVED are the two "terminal" non-cancel statuses: PAID is
    // cashier-side closure, SERVED is kitchen-side. Both translate to
    // "completed" on the mesh because that's when the KDS clear_order
    // command should fire.
    const status = updateStatusDto.status as OrderStatus;
    const eventType =
      status === OrderStatus.PAID || status === OrderStatus.SERVED
        ? "order.completed.v1"
        : status === OrderStatus.CANCELLED
          ? "order.cancelled.v1"
          : "order.updated.v1";
    this.emitOrderEvent(eventType as any, updatedOrder);

    return updatedOrder;
  }

  async remove(scope: BranchScope, id: string) {
    // Check if order exists and belongs to scope
    const order = await this.findOne(scope, id);

    // Only allow deletion of pending or cancelled orders
    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "Can only delete pending or cancelled orders",
      );
    }

    // Compound WHERE: scope (tenantId, branchId) IDOR guard + status
    // still in the delete-eligible set. If a concurrent state change
    // (a waiter moves the order to PREPARING between our findOne and
    // this delete) the count=0 result tells us to refuse the delete
    // rather than dropping a now-active kitchen order on the floor.
    const result = await this.prisma.order.deleteMany({
      where: {
        id,
        ...branchScope(scope),
        status: { in: [OrderStatus.PENDING, OrderStatus.CANCELLED] },
      },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        "Order status changed concurrently — cannot delete.",
      );
    }
    return { id };
  }

  /**
   * Remove a single OrderItem from an open order — used when a waiter
   * needs to cancel ONE customer's unpaid line without touching the
   * other customers' already-recorded per-item payments.
   *
   * Rules:
   *  - Order must be open (not PAID / CANCELLED / requiresApproval pending).
   *  - The target item must have zero COMPLETED OrderItemPayment rows. If
   *    even one unit has been paid for, refund first.
   *  - On success, order totals (totalAmount / finalAmount / taxAmount)
   *    are recomputed from the surviving items so the rest of the bill
   *    settles cleanly. Discount stays put.
   */
  async removeItem(scope: BranchScope, orderId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, ...branchScope(scope) },
        include: { orderItems: true },
      });
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      if (
        order.status === OrderStatus.PAID ||
        order.status === OrderStatus.CANCELLED
      ) {
        throw new BadRequestException(
          "Cannot modify a paid or cancelled order",
        );
      }
      if (
        order.requiresApproval &&
        order.status === OrderStatus.PENDING_APPROVAL
      ) {
        throw new BadRequestException(
          "Order requires approval before items can be modified.",
        );
      }

      const item = order.orderItems.find((i) => i.id === itemId);
      if (!item) {
        throw new NotFoundException(`Item ${itemId} not found on this order`);
      }

      // Combo integrity: a combo CHILD can't be removed alone (it would leave a
      // combo missing a component, silently sold below package price). Remove
      // the whole combo via its 0₺ parent instead. Removing the PARENT
      // cascade-deletes its children (self-relation onDelete: Cascade), so the
      // set actually removed is {parent} ∪ {its children} — the total recompute
      // MUST exclude all of them (the pre-fix `filter(i.id !== itemId)` still
      // counted the cascaded children → a ghost total charging a combo with no
      // backing rows).
      if ((item as any).parentOrderItemId) {
        throw new BadRequestException(
          "Kombo bileşeni tek başına kaldırılamaz — komboyu (ana satırı) kaldırın",
        );
      }
      const comboChildIds = order.orderItems
        .filter((i) => (i as any).parentOrderItemId === itemId)
        .map((i) => i.id);
      const removedIds = new Set<string>([itemId, ...comboChildIds]);

      // Last-item guard, combo-aware: refuse if removing this (combo or single)
      // line would leave the order with zero items — cancel it instead.
      if (order.orderItems.every((i) => removedIds.has(i.id))) {
        throw new BadRequestException(
          "Cannot remove the last item from an order; cancel the order instead.",
        );
      }

      const allocations = await tx.orderItemPayment.count({
        where: { orderItemId: { in: [...removedIds] } },
      });
      if (allocations > 0) {
        throw new ConflictException(
          "This item has been partially paid for. Refund the corresponding payment(s) first.",
        );
      }

      // Also block when any removed item is reserved by a PENDING self-pay
      // intent — deleting it would orphan the intent's itemsByOrder snapshot.
      for (const rid of removedIds) {
        await this.ensureNoInFlightSelfPayIntent(
          tx,
          orderId,
          scope.tenantId,
          rid,
        );
      }

      // Delete the parent — the cascade removes its children in the same tx.
      await tx.orderItem.delete({ where: { id: itemId } });

      // Recompute totals from the surviving items (EXCLUDING the cascaded combo
      // children) so the order math stays self-consistent.
      const remaining = order.orderItems.filter((i) => !removedIds.has(i.id));
      const newTotal = remaining.reduce<Prisma.Decimal>(
        (s, i) => s.add(new Prisma.Decimal(i.subtotal)),
        new Prisma.Decimal(0),
      );
      const grossTax = remaining.reduce<Prisma.Decimal>(
        (s, i) => s.add(new Prisma.Decimal(i.taxAmount)),
        new Prisma.Decimal(0),
      );
      const discount = new Prisma.Decimal(order.discount);
      const cappedDiscount = discount.gt(newTotal) ? newTotal : discount;
      const newFinal = newTotal.sub(cappedDiscount);
      const discountRatio = newTotal.gt(0)
        ? cappedDiscount.div(newTotal)
        : new Prisma.Decimal(0);
      const adjustedTax = grossTax
        .mul(new Prisma.Decimal(1).sub(discountRatio))
        .toDecimalPlaces(2);

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal,
          discount: cappedDiscount,
          finalAmount: newFinal,
          taxAmount: adjustedTax,
        },
        include: { orderItems: { include: { product: true } } },
      });

      return updated;
    });
  }

  // The StockMovement.reason marker that ties an OUT movement to its order.
  // StockMovement has no orderId column, so reverseProductStockForOrder keys
  // both its "did we deduct?" lookup and its idempotency on these strings.
  private static productDeductReason(orderNumber: string) {
    return `Order ${orderNumber}`;
  }
  private static productReverseReason(orderNumber: string) {
    return `Order ${orderNumber} reversal`;
  }

  async deductStockForOrder(orderId: string, tenantId: string) {
    // System path — tenant-only (called from background jobs, settlement
    // flows where no BranchScope exists; the order's own branchId
    // propagates to the StockMovement.create below).
    const order = await this.findOneByTenant(orderId, tenantId);
    const deductReason = OrdersService.productDeductReason(order.orderNumber);

    return this.prisma.$transaction(async (tx) => {
      // Aggregate quantity per product FIRST. The idempotency marker is keyed
      // (order, product), so an order with two lines of the same product — the
      // combo's cola child + a standalone cola, say — must be summed into one
      // deduction. Iterating per-item skipped the second line entirely (its
      // OUT marker already existed), silently undercounting stock. Summing
      // keeps the (order,product) key AND deducts the true total.
      const qtyByProduct = new Map<string, number>();
      for (const item of order.orderItems) {
        qtyByProduct.set(
          item.productId,
          (qtyByProduct.get(item.productId) ?? 0) + Number(item.quantity),
        );
      }

      for (const [productId, totalQty] of qtyByProduct) {
        const product = await tx.product.findUnique({
          where: { id: productId },
        });
        if (!product || !product.stockTracked) continue;

        // Idempotency: one OUT marker per (order, product) — if it exists this
        // product is already counted (re-finalize, approve-after-create, retry).
        const alreadyDeducted = await tx.stockMovement.findFirst({
          where: {
            productId: product.id,
            tenantId,
            type: StockMovementType.OUT,
            reason: deductReason,
          },
          select: { id: true },
        });
        if (alreadyDeducted) continue;

        // v2.8.98 — currentStock is Decimal; route through Prisma.Decimal so
        // fractional units (kg cuts, pours) compose correctly.
        const cur = new Prisma.Decimal(product.currentStock);
        const raw = cur.sub(totalQty);
        // Best-effort: NEVER throw (the caller runs this post-commit and must
        // not roll back a real sale) and NEVER write negative stock — floor at
        // 0 and log an oversell.
        const newStock = raw.lt(0) ? new Prisma.Decimal(0) : raw;
        // Record the amount that ACTUALLY left stock (cur − newStock), not the
        // requested totalQty. On an oversell the two differ: we floor stock at
        // 0 but only `cur` units physically existed. Recording the real
        // decrement keeps the ledger honest AND makes the reversal symmetric —
        // reverseProductStockForOrder credits back exactly THIS movement's
        // quantity, so cancelling an oversold order can't mint phantom stock
        // above the pre-sale level. (Non-oversell: removed === totalQty, so
        // behaviour is unchanged.) Int column → round the (integer-in-practice)
        // decrement.
        const removed = Math.max(0, Math.round(Number(cur.sub(newStock))));
        if (raw.lt(0)) {
          this.logger.warn(
            `Oversell on order ${order.orderNumber}: product ${product.id} qty ${totalQty} > stock ${product.currentStock} — flooring to 0 (removed ${removed})`,
          );
        }

        await tx.product.update({
          where: { id: product.id },
          data: { currentStock: newStock as any, isAvailable: newStock.gt(0) },
        });

        // v3.0.0 — branchId is NOT NULL on StockMovement; inherit from the
        // originating order. order.userId is null for customer/QR/delivery
        // orders (StockMovement.userId is nullable for exactly that case).
        await tx.stockMovement.create({
          data: {
            type: StockMovementType.OUT,
            quantity: removed,
            reason: deductReason,
            productId: product.id,
            userId: order.userId ?? null,
            tenantId: order.tenantId,
            branchId: order.branchId,
          },
        });
      }
    });
  }

  /**
   * Compensating reverse of deductStockForOrder — restores finished-good
   * Product.currentStock when an order is cancelled/refunded, mirroring the
   * ingredient subsystem's reverseForOrder. Idempotent (a reversal IN marker
   * per order+product) so cancel + refund can't double-credit, and only
   * reverses products that were actually deducted for THIS order.
   */
  async reverseProductStockForOrder(orderId: string, tenantId: string) {
    const order = await this.findOneByTenant(orderId, tenantId);
    const deductReason = OrdersService.productDeductReason(order.orderNumber);
    const reverseReason = OrdersService.productReverseReason(order.orderNumber);

    // Serializable: the two reverse callers (updateStatus→CANCELLED and the
    // refund→CANCELLED path) can fire concurrently for the same order. Under
    // READ COMMITTED both could pass the findFirst "already-reversed?" check
    // and double-credit. Serializable makes the loser fail (P2034) — swallowed
    // by the best-effort caller — so exactly one reversal IN is written.
    return this.prisma.$transaction(
      async (tx) => {
        // Aggregate per product — symmetric with deductStockForOrder. An order
        // with two lines of the same product deducted ONE summed OUT marker, so
        // the reversal must credit that same summed quantity ONCE, not just the
        // first line's quantity.
        const qtyByProduct = new Map<string, number>();
        for (const item of order.orderItems) {
          qtyByProduct.set(
            item.productId,
            (qtyByProduct.get(item.productId) ?? 0) + Number(item.quantity),
          );
        }

        for (const [productId] of qtyByProduct) {
          const product = await tx.product.findUnique({
            where: { id: productId },
          });
          if (!product || !product.stockTracked) continue;

          // Only reverse what we deducted, and only once. Credit back EXACTLY
          // the OUT movement's recorded quantity (the amount that actually left
          // stock), NOT the order's requested quantity — otherwise cancelling
          // an oversold order would restore more than was ever removed and mint
          // phantom stock. Non-oversell: recorded == requested, so unchanged.
          const deducted = await tx.stockMovement.findFirst({
            where: {
              productId: product.id,
              tenantId,
              type: StockMovementType.OUT,
              reason: deductReason,
            },
            select: { id: true, quantity: true },
          });
          if (!deducted) continue;
          const alreadyReversed = await tx.stockMovement.findFirst({
            where: {
              productId: product.id,
              tenantId,
              type: StockMovementType.IN,
              reason: reverseReason,
            },
            select: { id: true },
          });
          if (alreadyReversed) continue;

          const creditQty = deducted.quantity;
          const newStock = new Prisma.Decimal(product.currentStock).add(
            creditQty,
          );
          await tx.product.update({
            where: { id: product.id },
            data: {
              currentStock: newStock as any,
              isAvailable: newStock.gt(0),
            },
          });
          await tx.stockMovement.create({
            data: {
              type: StockMovementType.IN,
              quantity: creditQty,
              reason: reverseReason,
              productId: product.id,
              userId: order.userId ?? null,
              tenantId: order.tenantId,
              branchId: order.branchId,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async approveOrder(scope: BranchScope, orderId: string) {
    const tenantId = scope.tenantId;
    const userId = scope.userId;
    // Find the order
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...branchScope(scope),
      },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: {
              include: {
                modifier: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (order.status !== OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException("Order is not pending approval");
    }

    // Compound WHERE on the original PENDING_APPROVAL status + scope.
    // Without it, two waiters racing Approve vs Reject from two tablets
    // could each pass the status check above against PENDING_APPROVAL,
    // then the loser (say, Reject which sets CANCELLED) writes first and
    // the winner's Approve overwrites — landing the order at PENDING
    // with cancelledAt set from the reject path. Corrupt state. v3.0.0
    // adds branchId to the compound so a cross-branch coercion of
    // orderId also fails the claim.
    const claim = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        ...branchScope(scope),
        status: OrderStatus.PENDING_APPROVAL,
      },
      data: {
        status: OrderStatus.PENDING,
        requiresApproval: false,
        approvedAt: new Date(),
        approvedById: userId,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Order status changed concurrently — refresh and retry.",
      );
    }
    const updatedOrder = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: {
              include: {
                modifier: {
                  include: {
                    group: true,
                  },
                },
              },
            },
          },
        },
        table: true,
        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Mark table as occupied if this order has a table
    if (updatedOrder.tableId) {
      await this.prisma.table.update({
        where: { id: updatedOrder.tableId },
        data: { status: TableStatus.OCCUPIED },
      });
    }

    // Decrement finished-good (Product.currentStock) for stockTracked products
    // on the QR/customer self-order channel — these orders are created via
    // CustomerOrdersService (not OrdersService.create, so the create-path
    // deduct never ran) and only reach a deductable state at approval. POS
    // orders are created directly as PENDING and never pass through here, so
    // there is no double-deduction; deductStockForOrder is idempotent anyway.
    // Best-effort: an inventory hiccup must never block the approval.
    try {
      await this.deductStockForOrder(orderId, tenantId);
    } catch (error: any) {
      this.logger.error(
        `Product stock deduction failed on approval for order ${orderId}: ${error.message}`,
      );
    }

    // Emit WebSocket events for real-time updates
    // Emit as new order for kitchen and POS systems
    this.kdsGateway.emitNewOrder(tenantId, updatedOrder.branchId, updatedOrder);
    // Also emit update event for any listening clients
    this.kdsGateway.emitOrderUpdated(
      tenantId,
      updatedOrder.branchId,
      updatedOrder,
    );

    // CRITICAL: Notify customer if this is a QR menu order
    if (updatedOrder.sessionId) {
      this.kdsGateway.emitCustomerOrderApproved(
        updatedOrder.sessionId,
        updatedOrder,
      );
    }

    // Sync approval to delivery platform (accepts the order on the platform)
    this.deliveryStatusSync
      ?.syncStatusToPlatform(orderId, OrderStatus.PENDING)
      .catch((err) => {
        this.logger.error(
          `Delivery platform sync failed for order ${orderId}: ${err.message}`,
        );
      });

    // Send SMS to customer
    if (updatedOrder.customerPhone && this.smsNotificationService) {
      this.smsNotificationService.notifyOrderApproved(tenantId, {
        customerPhone: updatedOrder.customerPhone,
        orderNumber: updatedOrder.orderNumber,
      });
    }

    return updatedOrder;
  }

  /**
   * Sync all table statuses based on their active orders.
   * Tables with active orders (PENDING, PREPARING, READY, SERVED) should be OCCUPIED.
   * Tables with no active orders should be AVAILABLE (unless RESERVED).
   */
  async syncTableStatuses(scope: BranchScope) {
    const tenantId = scope.tenantId;
    const activeStatuses = [
      OrderStatus.PENDING,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.SERVED,
    ];

    // v3.0.0 — sync is now branch-scoped: an ADMIN/MANAGER kicking sync
    // for branch A only sees branch A tables and branch A active orders.
    // Pre-v3 this was tenant-wide; an admin clicking "sync" from one
    // branch would cascade into recomputing every branch's tables.
    const tables = await this.prisma.table.findMany({
      where: { ...branchScope(scope) },
      select: { id: true, number: true, status: true },
    });

    // Single aggregation query: count active orders per table (eliminates N+1)
    const activeOrderCounts = await this.prisma.order.groupBy({
      by: ["tableId"],
      where: {
        ...branchScope(scope),
        status: { in: activeStatuses },
        tableId: { not: null },
      },
      _count: { id: true },
    });

    const activeCountMap = new Map(
      activeOrderCounts.map((r) => [r.tableId, r._count.id]),
    );

    const updates: {
      tableId: string;
      tableNumber: string;
      oldStatus: string;
      newStatus: string;
    }[] = [];

    for (const table of tables) {
      // Skip reserved tables
      if (table.status === TableStatus.RESERVED) {
        continue;
      }

      const activeCount = activeCountMap.get(table.id) || 0;
      const expectedStatus =
        activeCount > 0 ? TableStatus.OCCUPIED : TableStatus.AVAILABLE;

      if (table.status !== expectedStatus) {
        await this.prisma.table.update({
          where: { id: table.id },
          data: { status: expectedStatus },
        });

        updates.push({
          tableId: table.id,
          tableNumber: table.number,
          oldStatus: table.status,
          newStatus: expectedStatus,
        });
      }
    }

    return {
      message: `Synced ${updates.length} table(s)`,
      updates,
    };
  }

  /**
   * Refuses to open a walk-in order on a table whose next reservation
   * (CONFIRMED or SEATED) is either active right now or starts within
   * the next {@link RESERVATION_HOLD_WINDOW_MINUTES} minutes.
   *
   * Date math note: reservations store `date` as a Postgres DATE and
   * `startTime`/`endTime` as HH:mm strings. We can't filter the
   * combined timestamp at the DB layer without a join+cast, so the
   * query pulls today's + tomorrow's CONFIRMED/SEATED rows for the
   * table and the comparison happens in JS. The result set is tiny
   * (one table × at most a handful of bookings per day) so this stays
   * O(small) regardless of overall reservation volume.
   */
  private async assertNoReservationOverlap(
    tenantId: string,
    tableId: string,
  ): Promise<void> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const candidates = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        tableId,
        date: { in: [today, tomorrow] },
        status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.SEATED] },
      },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        customerName: true,
      },
    });

    const windowEnd = new Date(
      now.getTime() + RESERVATION_HOLD_WINDOW_MINUTES * 60_000,
    );
    for (const r of candidates) {
      const [sh, sm] = r.startTime.split(":").map(Number);
      const [eh, em] = r.endTime.split(":").map(Number);
      const start = new Date(r.date);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(r.date);
      end.setHours(eh, em, 0, 0);

      // Currently in-window OR starts soon. The "ends after now" guard
      // skips reservations whose window has already closed but the
      // status hasn't been bumped to NO_SHOW yet — a stale CONFIRMED
      // shouldn't block service for the next sitting.
      if (end > now && start <= windowEnd) {
        throw new BadRequestException(
          `Bu masa için ${r.startTime} saatinde ${r.customerName} adına rezervasyon var. ` +
            `Sipariş açmadan önce rezervasyonu "seat" edin ya da iptal edin.`,
        );
      }
    }
  }
}
