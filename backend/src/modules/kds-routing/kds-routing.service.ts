import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommandQueueService } from '../device-mesh/command-queue.service';
import { DomainEventBus } from '../outbox/domain-event-bus.service';

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
    this.bus.on('order.created.v1', (e) => this.onOrderEvent(e, 'show_order'));
    this.bus.on('order.updated.v1', (e) => this.onOrderEvent(e, 'show_order'));
    this.bus.on('order.completed.v1', (e) => this.onOrderEvent(e, 'clear_order'));
    this.bus.on('order.cancelled.v1', (e) => this.onOrderEvent(e, 'clear_order'));
  }

  /**
   * Generic order-event handler. Looks up KDS screens that should see this
   * order (by branch when present; fallback: every KDS screen for the tenant)
   * and enqueues commands. Idempotency key includes the event id so retries
   * from the outbox worker don't duplicate commands.
   */
  private async onOrderEvent(event: { id: string; payload: any; tenantId: string | null }, kind: 'show_order' | 'clear_order'): Promise<void> {
    try {
      const p = event.payload as { orderId?: string; tenantId?: string; branchId?: string };
      const tenantId = p.tenantId ?? event.tenantId;
      if (!tenantId || !p.orderId) return;

      const devices = await this.prisma.device.findMany({
        where: {
          tenantId,
          kind: 'kds_screen',
          status: { in: ['online', 'offline', 'paired'] },
          ...(p.branchId ? { branchId: p.branchId } : {}),
        },
        select: { id: true },
      });
      if (devices.length === 0) return;

      for (const d of devices) {
        await this.commands.enqueue(tenantId, d.id, {
          kind,
          payload: { orderId: p.orderId },
          priority: kind === 'show_order' ? 5 : 3,
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
