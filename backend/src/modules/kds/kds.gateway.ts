import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as Sentry from "@sentry/node";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRole } from "../../common/constants/roles.enum";
import { BranchGuard } from "../auth/guards/branch.guard";

/**
 * Single realtime bus for kitchen, POS, personnel and customer events.
 *
 * v3.0.0 room layout (per tenantId, per branchId):
 * - kitchen-${tenantId}-${branchId}   — KITCHEN, ADMIN, MANAGER on the active branch
 * - pos-${tenantId}-${branchId}       — WAITER, COURIER, ADMIN, MANAGER on the active branch
 * - personnel-${tenantId}-${branchId} — ADMIN, MANAGER attendance/swap on the active branch
 * - customer-session-${sessionId}     — one customer per room
 *
 * Branch isolation is load-bearing. A WAITER pinned to branch A who
 * receives a kitchen event for branch B is a leakage — the audit's
 * High finding #3. Every emit is scoped to (tenantId, branchId), and
 * the connection handshake reads `auth.branchId` and validates it
 * with the same `BranchGuard.canAccessBranchStatic` predicate the HTTP
 * layer uses.
 *
 * ADMIN/MANAGER may emit a `switchBranch` event to move rooms without
 * reconnecting. WAITER/KITCHEN/COURIER are pinned to their primary
 * branch and any switch attempt is refused.
 *
 * Staff sockets must present a `type: 'user'` main-app JWT (HS256).
 * Marketing and superadmin tokens are rejected by the type check,
 * matching JwtStrategy's policy. Customer sockets present a session
 * id bound to a live CustomerSession row.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    // `.split(',').map(trim)` so an env value like
    // `https://a.com, https://b.com` (with a leading space on the
    // second entry) still matches — bare split keeps the space and
    // silently fails the origin check.
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["http://localhost:5173"],
    credentials: true,
  },
  namespace: "/kds",
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(KdsGateway.name);

  // In-memory last-activity cache to debounce writes to CustomerSession on
  // reconnect storms. Keyed by sessionId → epoch millis. A single-replica
  // optimization; acceptable to reset on restart.
  //
  // Iter-81: cleaned on disconnect + hard size cap so the map can't
  // grow unboundedly. Pre-iter-81 every customer connect added a key
  // and handleDisconnect was a pure logger — for 1000 sessions/day
  // × 30 days that's 30K stale entries per replica, all carrying
  // 32-byte sessionId keys plus a number. Small per-entry footprint
  // but the leak was structural.
  private readonly customerActivityLastWrite = new Map<string, number>();
  private static readonly ACTIVITY_DEBOUNCE_MS = 60_000;
  private static readonly ACTIVITY_MAP_HARD_CAP = 10_000;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(" ")[1];
      const sessionId =
        client.handshake.auth.sessionId || client.handshake.query.sessionId;

      if (token) {
        const authed = await this.tryStaffAuth(client, token);
        if (authed) return;
        // fall through — staff auth failed, customer session may still be valid
      }

      if (sessionId) {
        const authed = await this.tryCustomerAuth(client, String(sessionId));
        if (authed) return;
      }

      this.logger.warn(`Client ${client.id} rejected: no valid authentication`);
      client.disconnect();
    } catch (error: any) {
      // Log AND report: previously any unexpected throw here (DB connection
      // blip, JWT library regression, undefined property access) showed up
      // only as a terse "authentication error: ..." warn line with no stack,
      // making post-mortems guesswork. Sentry keeps the full trace so we can
      // tell a bad token apart from a Prisma outage.
      this.logger.warn(
        `Client ${client.id} authentication error: ${error.message}`,
      );
      Sentry.captureException(error, {
        tags: { source: "kds-gateway", phase: "handleConnection" },
        extra: { socketId: client.id },
      });
      client.disconnect();
    }
  }

  private async tryStaffAuth(client: Socket, token: string): Promise<boolean> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, { algorithms: ["HS256"] });
    } catch (err: any) {
      this.logger.warn(
        `Staff JWT verify failed for ${client.id}: ${err.message}`,
      );
      return false;
    }

    // Reject non-main-app tokens. Marketing + superadmin realms sign tokens
    // with type='marketing' / 'superadmin' against the shared secret; without
    // this check they would silently authenticate into the tenant realtime
    // stream. JwtStrategy applies the same policy for HTTP (jwt.strategy.ts).
    if (payload.type && payload.type !== "user") {
      this.logger.warn(
        `Staff JWT rejected for ${client.id}: unsupported token type '${payload.type}'`,
      );
      return false;
    }

    const tenantId = payload.tenantId;
    const role = payload.role as UserRole | undefined;
    if (!tenantId || !role) {
      this.logger.warn(
        `Staff JWT rejected for ${client.id}: missing tenantId/role`,
      );
      return false;
    }

    // v3.0.0 — branch identity is required for staff sockets. The
    // client passes `auth.branchId` at connect time (set by
    // frontend/src/lib/socket.ts from useBranchScopeStore). We
    // validate against the JWT's primaryBranchId/allowedBranchIds
    // using the same predicate BranchGuard uses for HTTP — so a
    // WAITER who tries to listen for branch B's kitchen feed gets
    // refused at the same layer as their HTTP attempt would be.
    const branchId =
      typeof client.handshake.auth?.branchId === "string"
        ? client.handshake.auth.branchId
        : "";
    const primaryBranchId: string | null = payload.primaryBranchId ?? null;
    const allowedBranchIds: string[] = Array.isArray(payload.allowedBranchIds)
      ? payload.allowedBranchIds
      : [];
    if (
      !branchId ||
      !BranchGuard.canAccessBranchStatic(
        role,
        branchId,
        primaryBranchId,
        allowedBranchIds,
      )
    ) {
      this.logger.warn(
        `Staff JWT rejected for ${client.id}: missing or unauthorized branchId (role=${role}, requested=${branchId})`,
      );
      return false;
    }

    client.data.userId = payload.sub;
    client.data.tenantId = tenantId;
    client.data.branchId = branchId;
    client.data.primaryBranchId = primaryBranchId;
    client.data.allowedBranchIds = allowedBranchIds;
    client.data.role = role;
    client.data.userType = "staff";
    client.data.tokenExp = payload.exp;

    // Auto-disconnect at JWT expiry so a long-running KDS terminal that
    // hasn't refreshed its token can't keep streaming kitchen events
    // forever. The frontend retries with the new token on reconnect.
    if (payload.exp && typeof payload.exp === "number") {
      const msToExpiry = payload.exp * 1000 - Date.now();
      if (msToExpiry > 0 && msToExpiry < 0x7fffffff) {
        setTimeout(() => {
          if (client.connected) {
            this.logger.log(
              `Staff client ${client.id} token expired; disconnecting.`,
            );
            client.disconnect(true);
          }
        }, msToExpiry).unref?.();
      }
    }

    // Role-based room membership — sockets receive only the events relevant
    // to their role instead of every kitchen + POS event regardless of job.
    const isKitchenRole = role === UserRole.KITCHEN;
    const isPosRole = role === UserRole.WAITER || role === UserRole.COURIER;
    const isManagerRole = role === UserRole.ADMIN || role === UserRole.MANAGER;

    if (isKitchenRole || isManagerRole) {
      client.join(`kitchen-${tenantId}-${branchId}`);
    }
    if (isPosRole || isManagerRole) {
      client.join(`pos-${tenantId}-${branchId}`);
    }
    if (isManagerRole) {
      client.join(`personnel-${tenantId}-${branchId}`);
    }

    this.logger.log(
      `Staff ${client.id} connected (user=${payload.sub}, role=${role}, tenant=${tenantId}, branch=${branchId})`,
    );
    return true;
  }

  /**
   * Switch the active branch on a live staff socket.
   *
   * The SPA emits `switchBranch` when the BranchPicker mutates
   * useBranchScopeStore.branchId. The server validates against the
   * JWT's allow-list (same predicate as connect-time) and atomically
   * moves the socket between rooms. Returning {ok:false} lets the
   * client surface a UX error without reconnecting; an ok=true ack
   * tells the SPA the cache invalidation it kicked off in parallel
   * will see fresh data on the next mount.
   */
  @SubscribeMessage("switchBranch")
  async handleSwitchBranch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { branchId?: string },
  ): Promise<{ ok: boolean; code?: string }> {
    const target = String(payload?.branchId ?? "");
    if (client.data?.userType !== "staff") {
      return { ok: false, code: "NOT_STAFF" };
    }
    const role = client.data.role as UserRole;
    const tenantId = client.data.tenantId as string;
    const primaryBranchId = (client.data.primaryBranchId ?? null) as
      | string
      | null;
    const allowedBranchIds = (client.data.allowedBranchIds ?? []) as string[];
    if (
      !BranchGuard.canAccessBranchStatic(
        role,
        target,
        primaryBranchId,
        allowedBranchIds,
      )
    ) {
      return { ok: false, code: "FORBIDDEN" };
    }

    const prev = client.data.branchId as string;
    if (prev === target) return { ok: true };

    // Move rooms — leave the previous (tenantId, prev) trio, join the
    // new (tenantId, target) trio. Role-based membership stays the
    // same; only the branch suffix changes.
    const isKitchenRole = role === UserRole.KITCHEN;
    const isPosRole = role === UserRole.WAITER || role === UserRole.COURIER;
    const isManagerRole = role === UserRole.ADMIN || role === UserRole.MANAGER;
    if (isKitchenRole || isManagerRole) {
      client.leave(`kitchen-${tenantId}-${prev}`);
      client.join(`kitchen-${tenantId}-${target}`);
    }
    if (isPosRole || isManagerRole) {
      client.leave(`pos-${tenantId}-${prev}`);
      client.join(`pos-${tenantId}-${target}`);
    }
    if (isManagerRole) {
      client.leave(`personnel-${tenantId}-${prev}`);
      client.join(`personnel-${tenantId}-${target}`);
    }
    client.data.branchId = target;
    this.logger.log(
      `Staff ${client.id} switched branch ${prev} → ${target} (tenant=${tenantId})`,
    );
    return { ok: true };
  }

  private async tryCustomerAuth(
    client: Socket,
    sessionId: string,
  ): Promise<boolean> {
    const session = await this.prisma.customerSession.findUnique({
      where: { sessionId },
      select: {
        sessionId: true,
        tenantId: true,
        customerId: true,
        isActive: true,
        expiresAt: true,
      },
    });

    if (!session) {
      this.logger.warn(`Customer session rejected for ${client.id}: not found`);
      return false;
    }
    if (!session.isActive || new Date() > session.expiresAt) {
      this.logger.warn(
        `Customer session rejected for ${client.id}: expired/inactive`,
      );
      return false;
    }

    client.data.sessionId = session.sessionId;
    client.data.tenantId = session.tenantId;
    client.data.customerId = session.customerId;
    client.data.userType = "customer";
    client.data.sessionExpiresAt = session.expiresAt;

    client.join(`customer-session-${session.sessionId}`);

    // Mirror the staff JWT-exp timer below: a customer that connected
    // with 5 minutes left on their session must NOT keep receiving the
    // tenant's realtime events for hours afterward. Without this they
    // do — the expiry check above only fires at connect time. The
    // ceiling at 0x7fffffff is Node's max setTimeout ms (~24.8d).
    // `.unref()` keeps the timer from holding the process alive.
    const msToExpiry = session.expiresAt.getTime() - Date.now();
    if (msToExpiry > 0 && msToExpiry < 0x7fffffff) {
      setTimeout(() => {
        if (client.connected) {
          this.logger.log(
            `Customer client ${client.id} session expired; disconnecting (session=${session.sessionId}).`,
          );
          client.disconnect(true);
        }
      }, msToExpiry).unref?.();
    }

    // Debounce lastActivity writes: a flaky mobile network reconnecting every
    // few seconds would otherwise hammer the DB. At most one write per minute
    // per session (in-process; acceptable staleness for presence tracking).
    const now = Date.now();
    const lastWrite =
      this.customerActivityLastWrite.get(session.sessionId) ?? 0;
    if (now - lastWrite > KdsGateway.ACTIVITY_DEBOUNCE_MS) {
      // Iter-81 cap-aware write. If the map is at the cap we evict the
      // oldest insertion-ordered entry first — Maps preserve insertion
      // order in JS, so the first key returned by keys() is the oldest
      // session that wrote. handleDisconnect normally clears entries
      // before they get here; this is the safety net for connect-only
      // sockets (a customer that connects, does nothing for 60s, and
      // disconnects without the gateway noticing — rare but possible
      // on long mobile-network timeouts).
      if (
        this.customerActivityLastWrite.size >= KdsGateway.ACTIVITY_MAP_HARD_CAP
      ) {
        const oldest = this.customerActivityLastWrite.keys().next().value;
        if (oldest) this.customerActivityLastWrite.delete(oldest);
      }
      this.customerActivityLastWrite.set(session.sessionId, now);
      this.prisma.customerSession
        .update({
          where: { sessionId: session.sessionId },
          data: { lastActivity: new Date() },
        })
        .catch((err) =>
          this.logger.warn(
            `customerSession.lastActivity update failed (${session.sessionId}): ${err.message}`,
          ),
        );
    }

    this.logger.log(
      `Customer ${client.id} connected (session=${session.sessionId}, customer=${session.customerId ?? "anonymous"})`,
    );
    return true;
  }

  handleDisconnect(client: Socket) {
    // Iter-81: free the per-session activity-debounce map entry on
    // disconnect. Pre-iter-81 this was a pure logger and the map grew
    // by one entry per customer connect across the lifetime of the
    // replica.
    const sessionId: string | undefined = client.data?.sessionId;
    if (sessionId) this.customerActivityLastWrite.delete(sessionId);
    this.logger.log(`Client ${client.id} disconnected`);
  }

  // NOTE: `join-kitchen` / `join-pos` inbound handlers were removed. Room
  // membership is fully determined at connect time based on the JWT role so
  // that a customer-session socket cannot elevate into staff rooms by emitting
  // a bare message.

  // ========================================
  // ORDER EVENTS
  // ========================================

  private toOrderEvent(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      table: order.table,
      userId: order.userId,
      user: order.user,
      sessionId: order.sessionId,
      customerPhone: order.customerPhone,
      type: order.type,
      customerName: order.customerName,
      status: order.status,
      requiresApproval: order.requiresApproval,
      totalAmount: order.totalAmount,
      discount: order.discount,
      finalAmount: order.finalAmount,
      notes: order.notes,
      orderItems: order.orderItems,
      payments: order.payments || [],
      approvedAt: order.approvedAt,
      approvedById: order.approvedById,
      approvedBy: order.approvedBy,
      source: order.source || null,
      externalOrderId: order.externalOrderId || null,
      tenantId: order.tenantId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  emitNewOrder(tenantId: string, branchId: string, order: any) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("order:new", this.toOrderEvent(order));
    this.logger.debug(
      `order:new ${order.orderNumber} → kitchen/pos-${tenantId}`,
    );
  }

  emitOrderUpdated(tenantId: string, branchId: string, order: any) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("order:updated", this.toOrderEvent(order));
    this.logger.debug(
      `order:updated ${order.orderNumber} → kitchen/pos-${tenantId}`,
    );
  }

  /**
   * Notify POS clients that a payment was just booked. Drives the
   * Tauri auto-print + cash-drawer path for non-waiter-initiated
   * payments (customer self-pay via PayTR webhook, refund flow,
   * write-off). The waiter UI's own createPayment mutation already
   * has an onSuccess that fires print locally — this event covers
   * the case where the originating actor isn't a logged-in POS user.
   *
   * Payload includes the receiptSnapshot so the listening tablet can
   * print without fetching anything further; method drives the
   * cash-drawer decision.
   */
  emitPaymentSuccess(
    tenantId: string,
    branchId: string,
    payment: {
      id: string;
      orderId: string;
      amount: any;
      method: string;
      receiptSnapshot: any;
    },
    initiatedByUserId?: string | null,
  ) {
    this.server.to(`pos-${tenantId}-${branchId}`).emit("payment:success", {
      paymentId: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      amount: payment.amount,
      receiptSnapshot: payment.receiptSnapshot,
      // The initiator's userId (null for webhook / customer self-pay).
      // Clients echo their own userId and skip the auto-print branch
      // when this matches — their createPayment mutation's onSuccess
      // already fired a local print, so a second print on the same
      // tablet would duplicate the fiş and pop the cash drawer twice.
      initiatedByUserId: initiatedByUserId ?? null,
      timestamp: new Date(),
    });
    this.logger.debug(`payment:success ${payment.id} → pos-${tenantId}`);
  }

  emitOrderStatusChange(
    tenantId: string,
    branchId: string,
    orderId: string,
    status: string,
  ) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("order:status-changed", { orderId, status, timestamp: new Date() });
    this.logger.debug(`order:status-changed ${orderId} → ${status}`);
  }

  emitOrderItemStatusChange(
    tenantId: string,
    branchId: string,
    orderItemId: string,
    status: string,
  ) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("order:item-status-changed", {
        orderItemId,
        status,
        timestamp: new Date(),
      });
    this.logger.debug(`order:item-status-changed ${orderItemId} → ${status}`);
  }

  emitTableMerge(
    tenantId: string,
    branchId: string,
    payload: { groupId: string; tableNumbers: any[] },
  ) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("table:merged", payload);
    this.logger.debug(
      `table:merged group=${payload.groupId} → kitchen/pos-${tenantId}`,
    );
  }

  emitTableUnmerge(
    tenantId: string,
    branchId: string,
    payload: { tableNumber: any; groupId: string },
  ) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("table:unmerged", payload);
    this.logger.debug(
      `table:unmerged table=${payload.tableNumber} → kitchen/pos-${tenantId}`,
    );
  }

  // ========================================
  // CUSTOMER-SPECIFIC EVENTS
  // ========================================

  emitToCustomerSession(sessionId: string, event: string, data: any) {
    this.server.to(`customer-session-${sessionId}`).emit(event, data);
    this.logger.debug(`${event} → customer-session-${sessionId}`);
  }

  emitCustomerOrderCreated(sessionId: string, order: any) {
    this.emitToCustomerSession(sessionId, "customer:order-created", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      finalAmount: order.finalAmount,
      requiresApproval: order.requiresApproval,
      items: order.orderItems,
      createdAt: order.createdAt,
    });
  }

  emitCustomerOrderApproved(sessionId: string, order: any) {
    this.emitToCustomerSession(sessionId, "customer:order-approved", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      approvedAt: order.approvedAt,
    });
  }

  emitCustomerOrderStatusUpdate(sessionId: string, order: any) {
    this.emitToCustomerSession(sessionId, "customer:order-status-updated", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      timestamp: new Date(),
    });
  }

  emitLoyaltyPointsEarned(
    sessionId: string,
    customerId: string,
    points: number,
    newBalance: number,
  ) {
    this.emitToCustomerSession(sessionId, "customer:loyalty-earned", {
      customerId,
      pointsEarned: points,
      newBalance,
      timestamp: new Date(),
    });
  }

  emitNewOrderWithCustomer(
    tenantId: string,
    branchId: string,
    order: any,
    sessionId?: string,
  ) {
    this.emitNewOrder(tenantId, branchId, order);
    if (sessionId) this.emitCustomerOrderCreated(sessionId, order);
  }

  emitOrderStatusChangeWithCustomer(
    tenantId: string,
    branchId: string,
    orderId: string,
    status: string,
    sessionId?: string,
  ) {
    this.emitOrderStatusChange(tenantId, branchId, orderId, status);
    if (sessionId) {
      this.emitToCustomerSession(sessionId, "customer:order-status-updated", {
        orderId,
        status,
        timestamp: new Date(),
      });
    }
  }

  // ========================================
  // TABLE TRANSFER EVENTS
  // ========================================

  emitTableTransfer(
    tenantId: string,
    branchId: string,
    data: {
      sourceTableId: string;
      targetTableId: string;
      sourceTableNumber: string;
      targetTableNumber: string;
      orders: any[];
      transferredCount: number;
    },
  ) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("table:orders-transferred", { ...data, timestamp: new Date() });
    this.logger.debug(
      `table:orders-transferred ${data.transferredCount} order(s) ${data.sourceTableNumber}->${data.targetTableNumber}`,
    );
  }

  // ========================================
  // BILL REQUEST EVENTS (POS only)
  // ========================================

  emitBillRequest(tenantId: string, branchId: string, billRequest: any) {
    this.server.to(`pos-${tenantId}-${branchId}`).emit("bill-request:new", {
      id: billRequest.id,
      tableId: billRequest.tableId,
      table: billRequest.table,
      sessionId: billRequest.sessionId,
      status: billRequest.status,
      createdAt: billRequest.createdAt,
      timestamp: new Date(),
    });
  }

  emitBillRequestUpdated(tenantId: string, branchId: string, billRequest: any) {
    this.server.to(`pos-${tenantId}-${branchId}`).emit("bill-request:updated", {
      id: billRequest.id,
      tableId: billRequest.tableId,
      table: billRequest.table,
      sessionId: billRequest.sessionId,
      status: billRequest.status,
      acknowledgedById: billRequest.acknowledgedById,
      acknowledgedBy: billRequest.acknowledgedBy,
      acknowledgedAt: billRequest.acknowledgedAt,
      completedAt: billRequest.completedAt,
      createdAt: billRequest.createdAt,
      timestamp: new Date(),
    });
  }

  // ========================================
  // WAITER REQUEST EVENTS (POS only)
  // ========================================

  emitWaiterRequest(tenantId: string, branchId: string, waiterRequest: any) {
    this.server.to(`pos-${tenantId}-${branchId}`).emit("waiter-request:new", {
      id: waiterRequest.id,
      tableId: waiterRequest.tableId,
      table: waiterRequest.table,
      sessionId: waiterRequest.sessionId,
      message: waiterRequest.message,
      status: waiterRequest.status,
      createdAt: waiterRequest.createdAt,
      timestamp: new Date(),
    });
  }

  emitWaiterRequestUpdated(
    tenantId: string,
    branchId: string,
    waiterRequest: any,
  ) {
    this.server
      .to(`pos-${tenantId}-${branchId}`)
      .emit("waiter-request:updated", {
        id: waiterRequest.id,
        tableId: waiterRequest.tableId,
        table: waiterRequest.table,
        sessionId: waiterRequest.sessionId,
        message: waiterRequest.message,
        status: waiterRequest.status,
        acknowledgedById: waiterRequest.acknowledgedById,
        acknowledgedBy: waiterRequest.acknowledgedBy,
        acknowledgedAt: waiterRequest.acknowledgedAt,
        completedAt: waiterRequest.completedAt,
        createdAt: waiterRequest.createdAt,
        timestamp: new Date(),
      });
  }

  // ========================================
  // PERSONNEL MANAGEMENT EVENTS (ADMIN/MANAGER only)
  // ========================================

  emitAttendanceUpdate(tenantId: string, branchId: string, data: any) {
    this.server
      .to(`personnel-${tenantId}-${branchId}`)
      .emit("personnel:attendance-update", { ...data, timestamp: new Date() });
  }

  emitSwapRequestUpdate(tenantId: string, branchId: string, data: any) {
    this.server
      .to(`personnel-${tenantId}-${branchId}`)
      .emit("personnel:swap-request-update", {
        ...data,
        timestamp: new Date(),
      });
  }

  // ========================================
  // STOCK ALERT EVENTS
  // ========================================

  emitLowStockAlert(tenantId: string, branchId: string, items: string[]) {
    this.server
      .to(`kitchen-${tenantId}-${branchId}`)
      .to(`pos-${tenantId}-${branchId}`)
      .emit("stock:low-stock-alert", { items, timestamp: new Date() });
    this.logger.debug(
      `stock:low-stock-alert ${items.length} items → kitchen/pos-${tenantId}`,
    );
  }
}
