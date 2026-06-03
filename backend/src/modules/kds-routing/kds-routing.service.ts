import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CommandQueueService } from "../device-mesh/command-queue.service";
import { DomainEventBus } from "../outbox/domain-event-bus.service";

/**
 * Routes Order events into the Device Mesh as `show_order` commands on
 * paired KDS screens.
 *
 * Why a separate module from the existing kds/ Socket.IO gateway:
 * - The existing gateway serves the browser-based KDS UI today and
 *   has live customers; we don't refactor it here.
 * - The mesh-aware path covers Tauri kiosk apps, vendor-supplied KDS
 *   devices, and future partner hardware that authenticate via the
 *   Device Mesh token rather than user JWT.
 *
 * Routing rule today: every KDS device on the order's branch receives a
 * `show_order` command. Per-station routing (bar vs grill vs dessert)
 * lands when product-level station tagging is added — until then a
 * single KDS station per branch is the operational default.
 */
@Injectable()
export class KdsRoutingService implements OnModuleInit {
  private readonly logger = new Logger(KdsRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
    private readonly commands: CommandQueueService,
  ) {}

  onModuleInit(): void {
    this.bus.on("order.created.v1", (e) => this.onOrderEvent(e, "show_order"));
    this.bus.on("order.updated.v1", (e) => this.onOrderEvent(e, "show_order"));
    this.bus.on("order.completed.v1", (e) =>
      this.onOrderEvent(e, "clear_order"),
    );
    this.bus.on("order.cancelled.v1", (e) =>
      this.onOrderEvent(e, "clear_order"),
    );
  }

  /**
   * Generic order-event handler. Looks up KDS screens that should see this
   * order (by branch when present; fallback: every KDS screen for the tenant)
   * and enqueues commands. Idempotency key includes the event id so retries
   * from the outbox worker don't duplicate commands.
   */
  private async onOrderEvent(
    event: { id: string; payload: any; tenantId: string | null },
    kind: "show_order" | "clear_order",
  ): Promise<void> {
    try {
      const p = event.payload as {
        orderId?: string;
        tenantId?: string;
        branchId?: string;
      };

      // Tenant-scope precedence — the outbox envelope's tenantId is the
      // authoritative source (the publisher writes both the column and
      // the payload, and the worker uses the column for sharded
      // delivery). The previous shape preferred `payload.tenantId`
      // first, so a publisher bug that serialised the wrong tenantId
      // into the payload could fan KDS commands out to a foreign
      // tenant's screens.
      //
      // If both are present AND disagree, that's a publisher bug —
      // log it and refuse to dispatch. Silently picking one of them
      // would hide the bug.
      const tenantId = event.tenantId ?? p.tenantId;
      if (!tenantId || !p.orderId) return;
      if (event.tenantId && p.tenantId && event.tenantId !== p.tenantId) {
        this.logger.error(
          `Tenant mismatch on event ${event.id}: envelope=${event.tenantId} ` +
            `payload=${p.tenantId} — refusing to dispatch (publisher bug).`,
        );
        return;
      }

      // Per-event fan-out cap. A legitimate restaurant has 1-10 KDS
      // screens; a runaway provisioning bug (or a malicious admin) could
      // create thousands and turn every order event into an N-statement
      // enqueue burst. 50 is generous for the largest real chain
      // footprint and bounded enough that one bad row can't starve the
      // command-queue worker for the rest of the tenant.
      const devices = await this.prisma.device.findMany({
        where: {
          tenantId,
          kind: "kds_screen",
          status: { in: ["online", "offline", "paired"] },
          ...(p.branchId ? { branchId: p.branchId } : {}),
        },
        select: { id: true },
        take: 50,
      });
      if (devices.length === 0) return;

      // v2.8.98 — same-order debounce for show_order. Pre-fix two
      // rapid-fire outbox events for the same order (created then
      // updated within seconds of each other — a normal cart edit
      // pattern) produced two distinct show_order commands per device,
      // each with its own outbox-event idempotency key. The KDS screen
      // briefly flickered the order twice, and the network/queue did
      // 2× the work. Now: if any non-terminal show_order for this
      // (orderId, deviceId) was queued in the last 5s, skip the new
      // one. The original outbox event's payload-vs-DB consistency is
      // still guaranteed by the projector reading current state.
      const RECENT_WINDOW_MS = 5_000;
      const recentCutoff = new Date(Date.now() - RECENT_WINDOW_MS);
      let recentByDevice = new Set<string>();
      if (kind === "show_order") {
        const recent = await this.prisma.deviceCommand.findMany({
          where: {
            tenantId,
            kind: "show_order",
            deviceId: { in: devices.map((d) => d.id) },
            status: { in: ["queued", "inflight"] },
            createdAt: { gte: recentCutoff },
            payload: { path: ["orderId"], equals: p.orderId } as any,
          },
          select: { deviceId: true },
        });
        // Defensive: a mock or in-flight DB error could return
        // undefined; the dedup is opt-in optimisation, not load-bearing.
        recentByDevice = new Set((recent ?? []).map((r) => r.deviceId));
      }

      for (const d of devices) {
        if (kind === "show_order" && recentByDevice.has(d.id)) continue;
        await this.commands.enqueue(tenantId, d.id, {
          kind,
          payload: { orderId: p.orderId },
          priority: kind === "show_order" ? 5 : 3,
          // Idempotency includes the outbox event id so a retried delivery
          // collapses onto the same command row.
          idempotencyKey: `${event.id}:${d.id}:${kind}`,
        });
      }
    } catch (e) {
      this.logger.warn(`KDS routing failed: ${(e as Error).message}`);
      throw e; // bubble back to the outbox worker for retry
    }
  }
}
