import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { PosSettingsService } from "../../pos-settings/pos-settings.service";
import { KdsGateway } from "../../kds/kds.gateway";
import { CustomersService } from "../../customers/customers.service";
import { CustomerSessionService } from "../../customers/customer-session.service";
import { StockDeductionService } from "../../stock-management/services/stock-deduction.service";
import { OutboxService } from "../../outbox/outbox.service";
import { captureSwallowedEmit } from "../../../common/observability/capture-swallowed-emit";
import { toIntCents } from "../../../common/money/to-int-cents";
import { CreateCustomerOrderDto } from "../dto/create-customer-order.dto";
import {
  CreateBillRequestDto,
  CreateWaiterRequestDto,
} from "../dto/waiter-request.dto";
import {
  OrderStatus,
  OrderType,
} from "../../../common/constants/order-status.enum";
import {
  isLocationWithinRange,
  isValidCoordinates,
} from "../../../common/utils/geolocation.util";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

@Injectable()
export class CustomerOrdersService {
  private readonly logger = new Logger(CustomerOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private posSettingsService: PosSettingsService,
    private kdsGateway: KdsGateway,
    private customersService: CustomersService,
    private customerSessionService: CustomerSessionService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
    // OutboxModule is @Global. Optional so unit tests construct the service
    // bare; when absent the durable emit no-ops and only the live kdsGateway
    // broadcast fires (the pre-v3 behaviour).
    @Optional()
    private outbox?: OutboxService,
  ) {}

  /**
   * Durable order.created.v1 emit for a customer (QR) order. Customer orders
   * are created directly here (not via OrdersService), so without this they
   * fire ONLY the ephemeral kdsGateway broadcast — missing both replay and
   * the kds-routing physical-device fan-out that normal orders get. Best-effort
   * (matches OrdersService.emitOrderEvent): the live UI broadcast is the
   * fast-path; this is the durable backstop.
   */
  private emitOrderCreated(order: any): void {
    if (!this.outbox) return;
    this.outbox
      .append({
        type: "order.created.v1",
        tenantId: order?.tenantId,
        payload: {
          orderId: order?.id,
          tenantId: order?.tenantId,
          branchId: order?.branchId ?? null,
          tableId: order?.tableId ?? null,
          status: order?.status,
          totalCents: toIntCents(order?.finalAmount),
        },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "customer-orders",
          op: "order.created.v1",
        }),
      );
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(4).toString("hex").toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  // ========================================
  // CUSTOMER ORDERS
  // ========================================

  async createOrder(dto: CreateCustomerOrderDto) {
    // tenantId is resolved from the server-trusted session record, never
    // from the request body — mirrors the customer-public controller fix.
    const session = await this.customerSessionService.requireSession(
      dto.sessionId,
    );
    const tenantId = session.tenantId;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        locationRadius: true,
        status: true,
      },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");
    if (tenant.status !== "ACTIVE")
      throw new ForbiddenException("Tenant is not active");

    const posSettings = await this.posSettingsService.findByTenant(tenantId);
    if (!posSettings.enableCustomerOrdering) {
      throw new ForbiddenException(
        "Customer ordering is currently disabled. Please contact staff to place your order.",
      );
    }

    if (isValidCoordinates(tenant.latitude, tenant.longitude)) {
      if (!isValidCoordinates(dto.latitude, dto.longitude)) {
        throw new BadRequestException(
          "Konum bilgisi gerekli. Lütfen tarayıcı konum iznini etkinleştirin.",
        );
      }
      const locationCheck = isLocationWithinRange(
        dto.latitude!,
        dto.longitude!,
        tenant.latitude!,
        tenant.longitude!,
        tenant.locationRadius,
      );
      if (!locationCheck.isWithinRange) {
        throw new BadRequestException(
          `Sipariş vermek için restoran konumunda olmanız gerekiyor. Mevcut mesafe: ${locationCheck.distance}m (maksimum: ${tenant.locationRadius}m)`,
        );
      }
    }

    // v3.0.0 — every Order is branch-scoped. With a tableId we read
    // table.branchId; for tableless mode we fall back to the tenant's
    // first active branch (the "main counter" for single-branch
    // tenants; multi-branch tenants who enable tableless mode in
    // practice configure one specific branch per QR menu URL).
    let orderType: OrderType;
    let branchId: string;
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
        select: { id: true, branchId: true },
      });
      if (!table) throw new NotFoundException("Table not found");
      orderType = dto.type || OrderType.DINE_IN;
      branchId = table.branchId;
    } else {
      if (!posSettings.enableTablelessMode) {
        throw new BadRequestException(
          "Tableless ordering is not enabled. Please scan a table QR code to place your order.",
        );
      }
      orderType = dto.type || OrderType.COUNTER;
      const mainBranch = await this.prisma.branch.findFirst({
        where: { tenantId, status: "active" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!mainBranch) {
        throw new BadRequestException(
          "Tenant has no active branch — cannot accept tableless orders.",
        );
      }
      branchId = mainBranch.id;
    }

    const validatedItems = await this.validateAndCalculateItems(
      dto.items,
      tenantId,
    );

    const totalAmount = validatedItems.reduce<Prisma.Decimal>(
      (sum, i) => sum.add(i.itemTotal),
      new Prisma.Decimal(0),
    );
    const discount = new Prisma.Decimal(0);
    const finalAmount = totalAmount.sub(discount);

    let customerId: string | null = null;
    if (dto.customerPhone) {
      const customer = await this.customersService.findOrCreateByPhone(
        dto.customerPhone,
        tenantId,
      );
      customerId = customer.id;
    }

    const maxAttempts = 3;
    let lastErr: unknown;
    let createdOrder;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const orderNumber = this.generateOrderNumber();
      try {
        createdOrder = await this.prisma.order.create({
          data: {
            orderNumber,
            tenantId,
            branchId,
            tableId: dto.tableId || null,
            sessionId: dto.sessionId,
            customerPhone: dto.customerPhone,
            customerId,
            status: OrderStatus.PENDING_APPROVAL,
            requiresApproval: true,
            type: orderType,
            totalAmount,
            discount,
            finalAmount,
            notes: dto.notes,
            orderItems: {
              create: validatedItems.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                modifierTotal: item.modifierTotal,
                subtotal: item.itemTotal,
                notes: item.notes,
                status: "PENDING",
                modifiers: {
                  create: item.modifiers.map((mod) => ({
                    modifierId: mod.modifierId,
                    quantity: mod.quantity,
                    priceAdjustment: mod.priceAdjustment,
                  })),
                },
              })),
            },
          },
          include: {
            orderItems: {
              include: {
                product: true,
                modifiers: {
                  include: { modifier: { include: { group: true } } },
                },
              },
            },
            table: true,
          },
        });
        break;
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
    if (!createdOrder) {
      this.logger.error(`Order number allocation failed: ${lastErr}`);
      throw new ConflictException(
        "Could not allocate an order number — please retry",
      );
    }

    // Durable backstop first (replay + kds-routing device fan-out), then the
    // ephemeral live-UI broadcast.
    this.emitOrderCreated(createdOrder);
    this.kdsGateway.emitNewOrderWithCustomer(
      tenantId,
      createdOrder,
      dto.sessionId,
    );

    // Customer orders start in PENDING_APPROVAL — stock is not deducted until
    // staff approve via OrdersService.approveOrder. We still emit a low-stock
    // signal if the tenant has configured deduction at an earlier status.
    if (this.stockDeductionService) {
      try {
        const deductResult = await this.stockDeductionService.deductForOrder(
          createdOrder.id,
          tenantId,
          OrderStatus.PENDING_APPROVAL,
        );
        if (deductResult?.lowStockAlerts?.length) {
          this.kdsGateway.emitLowStockAlert(
            tenantId,
            branchId,
            deductResult.lowStockAlerts,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Stock deduction (PENDING_APPROVAL) failed for order ${createdOrder.orderNumber}: ${err.message}`,
          err.stack,
        );
      }
    }

    return createdOrder;
  }

  async getSessionOrders(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    return this.prisma.order.findMany({
      where: { sessionId, tenantId: session.tenantId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: { include: { group: true } } } },
          },
        },
        table: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getOrderById(orderId: string, sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, sessionId, tenantId: session.tenantId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: { include: { group: true } } } },
          },
        },
        table: true,
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  // ========================================
  // WAITER REQUESTS
  // ========================================

  async createWaiterRequest(dto: CreateWaiterRequestDto) {
    const session = await this.customerSessionService.requireSession(
      dto.sessionId,
    );
    const tenantId = session.tenantId;

    // v3.0.0 — derive branchId from the table the request is bound
    // to (always set in the QR-scan flow). If a future caller lands
    // here without a tableId the request would be ambiguous between
    // multiple branches, so we refuse rather than silently picking
    // one — keeps the WaiterRequest stream branch-correct.
    let branchId: string;
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
        select: { id: true, branchId: true },
      });
      if (!table) throw new NotFoundException("Table not found");
      branchId = table.branchId;
    } else {
      throw new BadRequestException(
        "tableId is required to call a waiter — request is otherwise ambiguous across branches.",
      );
    }

    // Dedup. The earlier version ANDed `status active` with `createdAt
    // recent`, which broke the common case: a still-PENDING waiter
    // request older than 60s would fail the AND, and the next customer
    // tap would create a SECOND active row — the POS tray ended up with
    // two open requests for the same table and the staff acknowledged
    // both. Switch to OR so:
    //   - any PENDING/ACKNOWLEDGED row dedupes regardless of age, AND
    //   - any row (incl. COMPLETED) in the last 60s also dedupes,
    //     throttling re-requests right after a waiter just finished one.
    // Mirrors createBillRequest below.
    const oneMinAgo = new Date(Date.now() - 60_000);
    const existing = await this.prisma.waiterRequest.findFirst({
      where: {
        sessionId: dto.sessionId,
        tenantId,
        OR: [
          { status: { in: ["PENDING", "ACKNOWLEDGED"] } },
          { createdAt: { gte: oneMinAgo } },
        ],
      },
      include: { table: true },
    });
    if (existing) return existing;

    // v2.8.98 — wrap the create in a P2002 catch. The partial unique
    // index `waiter_requests_session_active_uniq` (sessionId, tenantId)
    // WHERE status='PENDING' closes the last race window that the
    // findFirst+create pair leaves open: two customer taps landing
    // millisecond-apart both pass the pre-check, both call .create(),
    // and the DB index rejects the loser. Return the winner's row so
    // the caller still gets a 200.
    let waiterRequest;
    try {
      waiterRequest = await this.prisma.waiterRequest.create({
        data: {
          tenantId,
          branchId,
          tableId: dto.tableId || null,
          sessionId: dto.sessionId,
          message: dto.message,
          status: "PENDING",
        },
        include: { table: true },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const winner = await this.prisma.waiterRequest.findFirst({
          where: { sessionId: dto.sessionId, tenantId, status: "PENDING" },
          include: { table: true },
        });
        if (winner) return winner;
      }
      throw err;
    }

    this.kdsGateway.emitWaiterRequest(
      tenantId,
      waiterRequest.branchId,
      waiterRequest,
    );
    return waiterRequest;
  }

  async getSessionWaiterRequests(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    return this.prisma.waiterRequest.findMany({
      where: { sessionId, tenantId: session.tenantId },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getActiveWaiterRequests(scope: BranchScope) {
    // Iter-86: cap matches the per-session listings above (50 is plenty
    // for any single dashboard tick on an event-night tenant; 200 here
    // gives headroom for a large chain summary while still bounding
    // the payload + PII surface).
    //
    // v3 branch-scope: fence on (tenantId, branchId) — a previous
    // tenant-only filter leaked every branch's active requests into
    // each branch dashboard.
    return this.prisma.waiterRequest.findMany({
      where: {
        ...branchScope(scope),
        status: { in: ["PENDING", "ACKNOWLEDGED"] },
      },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  }

  async acknowledgeWaiterRequest(
    id: string,
    userId: string,
    scope: BranchScope,
  ) {
    // v3 branch-scope: the updateMany fence is (id, tenantId, branchId)
    // so a request id belonging to another branch is never acted on —
    // updateMany simply matches zero rows and we surface the same
    // "not found" error a stranger id would get.
    const result = await this.prisma.waiterRequest.updateMany({
      where: { id, ...branchScope(scope), status: "PENDING" },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        "Waiter request not found or already acknowledged",
      );
    }
    const updated = await this.prisma.waiterRequest.findFirstOrThrow({
      where: { id, ...branchScope(scope) },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    this.kdsGateway.emitWaiterRequestUpdated(
      scope.tenantId,
      updated.branchId,
      updated,
    );
    return updated;
  }

  async completeWaiterRequest(id: string, userId: string, scope: BranchScope) {
    // v3 branch-scope: every read/write below is fenced on
    // (tenantId, branchId) so a cross-branch id is treated as not found.
    const request = await this.prisma.waiterRequest.findFirst({
      where: { id, ...branchScope(scope) },
    });
    if (!request) throw new NotFoundException("Waiter request not found");
    if (request.status === "COMPLETED") {
      throw new BadRequestException("Waiter request is already completed");
    }

    // Iter-86: complete with TWO disjoint updateMany predicates so a
    // race between the findFirst snapshot above and the write below
    // cannot corrupt the acknowledger audit trail.
    //
    // Pre-fix shape used a single `acknowledgedById: request.ack || userId`
    // — if a concurrent acknowledgeWaiterRequest call landed between
    // the read and the write, our null snapshot OR'd to userId,
    // overwriting the actual acknowledger's id with the completer's.
    // The row then claimed "acknowledged by the completer" forever
    // even though the real acknowledger was someone else.
    //
    // Both updateMany calls scope to a STATUS predicate, so they
    // never both match. The whole pair runs inside one $transaction
    // — racer either sees PENDING (branch 1 wins) or ACKNOWLEDGED
    // (branch 2 wins, preserves existing ack metadata) but never
    // overwrites a non-null acknowledger.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Branch 1: row was still PENDING — complete + stamp the ack
      // metadata from this user (the completer is implicitly also
      // the acknowledger when nobody acknowledged separately).
      const fromPending = await tx.waiterRequest.updateMany({
        where: { id, ...branchScope(scope), status: "PENDING" },
        data: {
          status: "COMPLETED",
          completedAt: now,
          acknowledgedById: userId,
          acknowledgedAt: now,
        },
      });
      if (fromPending.count === 1) return;

      // Branch 2: someone already acknowledged — just close it. Do
      // NOT touch acknowledgedById / acknowledgedAt; that is the
      // load-bearing change.
      const fromAcked = await tx.waiterRequest.updateMany({
        where: { id, ...branchScope(scope), status: "ACKNOWLEDGED" },
        data: { status: "COMPLETED", completedAt: now },
      });
      if (fromAcked.count !== 1) {
        throw new BadRequestException(
          "Waiter request not found or already completed",
        );
      }
    });

    const updated = await this.prisma.waiterRequest.findFirstOrThrow({
      where: { id, ...branchScope(scope) },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    this.kdsGateway.emitWaiterRequestUpdated(
      scope.tenantId,
      updated.branchId,
      updated,
    );
    return updated;
  }

  // ========================================
  // BILL REQUESTS
  // ========================================

  async createBillRequest(dto: CreateBillRequestDto) {
    const session = await this.customerSessionService.requireSession(
      dto.sessionId,
    );
    const tenantId = session.tenantId;

    let branchId: string;
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId },
        select: { id: true, branchId: true },
      });
      if (!table) throw new NotFoundException("Table not found");
      branchId = table.branchId;
    } else {
      throw new BadRequestException(
        "tableId is required to request the bill — request is otherwise ambiguous across branches.",
      );
    }

    // Coalesce: returning a PENDING/ACKNOWLEDGED row covers the common
    // "waiter hasn't gotten to me yet" case (ANY age — a slow staff
    // member shouldn't open the door to dup rows). The second OR clause
    // catches the "immediately after COMPLETED" tap-spam case with a
    // 60s throttle window. createWaiterRequest above uses the same
    // shape — see the comment block there for the bug that motivated
    // OR over AND.
    const oneMinAgo = new Date(Date.now() - 60_000);
    const existing = await this.prisma.billRequest.findFirst({
      where: {
        sessionId: dto.sessionId,
        tenantId,
        OR: [
          { status: { in: ["PENDING", "ACKNOWLEDGED"] } },
          { createdAt: { gte: oneMinAgo } },
        ],
      },
      include: { table: true },
    });
    if (existing) return existing;

    // v2.8.98 — see createWaiterRequest above; same partial-unique
    // race close (bill_requests_session_active_uniq).
    let billRequest;
    try {
      billRequest = await this.prisma.billRequest.create({
        data: {
          tenantId,
          branchId,
          tableId: dto.tableId || null,
          sessionId: dto.sessionId,
          status: "PENDING",
        },
        include: { table: true },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const winner = await this.prisma.billRequest.findFirst({
          where: { sessionId: dto.sessionId, tenantId, status: "PENDING" },
          include: { table: true },
        });
        if (winner) return winner;
      }
      throw err;
    }

    this.kdsGateway.emitBillRequest(
      tenantId,
      billRequest.branchId,
      billRequest,
    );
    return billRequest;
  }

  async getSessionBillRequests(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);
    return this.prisma.billRequest.findMany({
      where: { sessionId, tenantId: session.tenantId },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getActiveBillRequests(scope: BranchScope) {
    // Iter-86: same cap rationale as getActiveWaiterRequests above.
    // v3 branch-scope: fence on (tenantId, branchId) — same cross-branch
    // leak close as getActiveWaiterRequests.
    return this.prisma.billRequest.findMany({
      where: {
        ...branchScope(scope),
        status: { in: ["PENDING", "ACKNOWLEDGED"] },
      },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  }

  async acknowledgeBillRequest(id: string, userId: string, scope: BranchScope) {
    // v3 branch-scope: (id, tenantId, branchId) fence — a cross-branch
    // id matches zero rows and surfaces "not found".
    const result = await this.prisma.billRequest.updateMany({
      where: { id, ...branchScope(scope), status: "PENDING" },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        "Bill request not found or already acknowledged",
      );
    }
    const updated = await this.prisma.billRequest.findFirstOrThrow({
      where: { id, ...branchScope(scope) },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    this.kdsGateway.emitBillRequestUpdated(
      scope.tenantId,
      updated.branchId,
      updated,
    );
    return updated;
  }

  async completeBillRequest(id: string, userId: string, scope: BranchScope) {
    // v3 branch-scope: every read/write fenced on (tenantId, branchId).
    const request = await this.prisma.billRequest.findFirst({
      where: { id, ...branchScope(scope) },
    });
    if (!request) throw new NotFoundException("Bill request not found");
    if (request.status === "COMPLETED") {
      throw new BadRequestException("Bill request is already completed");
    }

    // Iter-86: same TOCTOU fix as completeWaiterRequest above. Split
    // into two status-scoped updateMany calls inside a transaction so
    // a concurrent acknowledge cannot have its acknowledger id
    // overwritten by the completer.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const fromPending = await tx.billRequest.updateMany({
        where: { id, ...branchScope(scope), status: "PENDING" },
        data: {
          status: "COMPLETED",
          completedAt: now,
          acknowledgedById: userId,
          acknowledgedAt: now,
        },
      });
      if (fromPending.count === 1) return;

      const fromAcked = await tx.billRequest.updateMany({
        where: { id, ...branchScope(scope), status: "ACKNOWLEDGED" },
        data: { status: "COMPLETED", completedAt: now },
      });
      if (fromAcked.count !== 1) {
        throw new BadRequestException(
          "Bill request not found or already completed",
        );
      }
    });
    const updated = await this.prisma.billRequest.findFirstOrThrow({
      where: { id, ...branchScope(scope) },
      include: {
        table: true,
        acknowledgedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    this.kdsGateway.emitBillRequestUpdated(
      scope.tenantId,
      updated.branchId,
      updated,
    );
    return updated;
  }

  // ========================================
  // HELPERS
  // ========================================

  private async validateAndCalculateItems(
    items: CreateCustomerOrderDto["items"],
    tenantId: string,
  ) {
    const productIds = items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, isAvailable: true },
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
      },
    });

    // Set-based check catches both "unknown product" and "duplicated productId"
    // more correctly than length equality.
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException(
        "One or more products are invalid or unavailable",
      );
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) continue;

      const itemModifierIds = (item.modifiers || []).map((m) => m.modifierId);
      for (const pmg of product.modifierGroups) {
        const group = pmg.group;
        if (!group.isActive) continue;
        const groupModifierIds = group.modifiers.map((m) => m.id);
        const selectedCount = itemModifierIds.filter((id) =>
          groupModifierIds.includes(id),
        ).length;
        if (group.isRequired || group.minSelections > 0) {
          const minRequired = group.isRequired
            ? Math.max(1, group.minSelections)
            : group.minSelections;
          if (selectedCount < minRequired) {
            throw new BadRequestException(
              `Product "${product.name}" requires at least ${minRequired} selection(s) from "${group.displayName}"`,
            );
          }
        }
        // Upper bound too — a 0-priced "extra sauce" entry shouldn't be
        // selectable 100 times just because only `minSelections` was
        // enforced. `maxSelections <= 0` means "no upper bound".
        if (group.maxSelections > 0 && selectedCount > group.maxSelections) {
          throw new BadRequestException(
            `Product "${product.name}" allows at most ${group.maxSelections} selection(s) from "${group.displayName}"`,
          );
        }
      }
    }

    const allModifierIds = items.flatMap((i) =>
      (i.modifiers || []).map((m) => m.modifierId),
    );
    const modifiers =
      allModifierIds.length > 0
        ? await this.prisma.modifier.findMany({
            where: { id: { in: allModifierIds }, tenantId, isAvailable: true },
            select: { id: true, priceAdjustment: true },
          })
        : [];
    const modifierMap = new Map(modifiers.map((m) => [m.id, m]));

    return items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product)
        throw new BadRequestException(`Product ${item.productId} not found`);

      const unitPrice = new Prisma.Decimal(product.price);
      const quantity = new Prisma.Decimal(item.quantity);
      let modifierTotal = new Prisma.Decimal(0);

      const validatedModifiers = (item.modifiers || []).map((mod) => {
        const modifier = modifierMap.get(mod.modifierId);
        if (!modifier) {
          throw new BadRequestException(`Modifier ${mod.modifierId} not found`);
        }
        const priceAdjustment = new Prisma.Decimal(modifier.priceAdjustment);
        modifierTotal = modifierTotal.add(priceAdjustment.mul(mod.quantity));
        return {
          modifierId: mod.modifierId,
          quantity: mod.quantity,
          priceAdjustment,
        };
      });

      const itemTotal = unitPrice.add(modifierTotal).mul(quantity);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        modifierTotal,
        itemTotal,
        notes: item.notes,
        modifiers: validatedModifiers,
      };
    });
  }
}
