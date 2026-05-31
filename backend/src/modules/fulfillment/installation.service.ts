import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * Installation request lifecycle:
 *   requested -> scheduled -> in_progress -> done
 *               └→ cancelled / no_show
 *
 * Scheduling for MVP is a flat date + free-form notes. Phase 11 brings a
 * partner-technician calendar with real availability.
 */
@Injectable()
export class InstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    tenantId: string,
    input: { branchId?: string; hwOrderId?: string; preferredDates?: Date[]; notes?: string },
  ) {
    const row = await this.prisma.installationRequest.create({
      data: {
        id: uuidv7(),
        tenantId,
        branchId: input.branchId,
        hwOrderId: input.hwOrderId,
        preferredDates: input.preferredDates ?? [],
        notes: input.notes,
        status: 'requested',
      },
    });
    await this.outbox
      .append({
        type: 'installation.requested.v1',
        tenantId,
        payload: { requestId: row.id, branchId: input.branchId, hwOrderId: input.hwOrderId },
      })
      .catch(() => undefined);
    return row;
  }

  async schedule(tenantId: string, requestId: string, scheduledFor: Date, assignedTo?: string) {
    const row = await this.prisma.installationRequest.findFirst({
      where: { id: requestId, tenantId },
    });
    if (!row) throw new NotFoundException('Installation request not found');
    if (!['requested', 'scheduled'].includes(row.status)) {
      throw new BadRequestException(`Cannot schedule from status=${row.status}`);
    }
    // Atomic claim on (tenantId, status). Two parallel schedule() calls
    // both pass the findUnique + status check, then race on the write;
    // without this WHERE the second call silently overwrites the first
    // call's scheduledFor + assignedTo. updateMany with the status set
    // gate means only one wins; the loser surfaces as a conflict the
    // operator can retry.
    const claim = await this.prisma.installationRequest.updateMany({
      where: {
        id: requestId,
        tenantId,
        status: { in: ['requested', 'scheduled'] },
      },
      data: { status: 'scheduled', scheduledFor, assignedTo },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Installation request status changed concurrently — refresh and retry.');
    }
    // v2.8.94 — compound-WHERE re-fetch matches the upstream claim.
    const updated = await this.prisma.installationRequest.findFirstOrThrow({ where: { id: requestId, tenantId } });
    await this.outbox
      .append({
        type: 'installation.scheduled.v1',
        tenantId,
        payload: { requestId, scheduledFor, assignedTo },
      })
      .catch(() => undefined);
    return updated;
  }

  async complete(tenantId: string, requestId: string, notes?: string) {
    const row = await this.prisma.installationRequest.findFirst({
      where: { id: requestId, tenantId },
    });
    if (!row) throw new NotFoundException('Installation request not found');
    // Block re-completion (idempotency) and cross-tenant writes in one
    // compound WHERE. status:not_in for terminal states is the canonical
    // re-completion guard; without it a second complete() call would
    // overwrite completedAt with a later timestamp.
    const claim = await this.prisma.installationRequest.updateMany({
      where: {
        id: requestId,
        tenantId,
        status: { notIn: ['done', 'cancelled'] },
      },
      data: { status: 'done', completedAt: new Date(), notes: notes ?? row.notes },
    });
    if (claim.count === 0) {
      throw new BadRequestException(`Cannot complete from status=${row.status}`);
    }
    const updated = await this.prisma.installationRequest.findFirstOrThrow({ where: { id: requestId, tenantId } });
    await this.outbox
      .append({
        type: 'installation.completed.v1',
        tenantId,
        payload: { requestId },
      })
      .catch(() => undefined);
    return updated;
  }

  async list(tenantId: string, status?: string) {
    return this.prisma.installationRequest.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * SuperAdmin-side cancel. Allowed from any non-terminal state. Uses the
   * same updateMany + status-gate pattern as schedule/complete so two
   * concurrent operators can't both flip a row.
   */
  async cancel(requestId: string, reason?: string) {
    const row = await this.prisma.installationRequest.findUnique({ where: { id: requestId } });
    if (!row) throw new NotFoundException('Installation request not found');
    const claim = await this.prisma.installationRequest.updateMany({
      where: { id: requestId, status: { notIn: ['done', 'cancelled'] } },
      data: {
        status: 'cancelled',
        notes: reason ? `${row.notes ?? ''}\n[cancelled] ${reason}`.trim() : row.notes,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(`Cannot cancel from status=${row.status}`);
    }
    // SuperAdmin path — row.tenantId already proven by the findUnique
    // above. Use it to maintain the same compound-WHERE re-fetch shape.
    const updated = await this.prisma.installationRequest.findFirstOrThrow({
      where: { id: requestId, tenantId: row.tenantId },
    });
    await this.outbox
      .append({
        type: 'installation.cancelled.v1',
        tenantId: row.tenantId,
        payload: { requestId, reason },
      })
      .catch(() => undefined);
    return updated;
  }

  /**
   * SuperAdmin-side wrappers that look up the row to derive tenantId,
   * then delegate to the tenant-scoped methods. Keeps the lifecycle
   * checks + status gates in one place while giving ops a clean
   * "I only know the request id" entry point.
   */
  async scheduleByOps(requestId: string, scheduledFor: Date, assignedTo?: string) {
    const row = await this.prisma.installationRequest.findUnique({
      where: { id: requestId },
      select: { tenantId: true },
    });
    if (!row) throw new NotFoundException('Installation request not found');
    return this.schedule(row.tenantId, requestId, scheduledFor, assignedTo);
  }

  async completeByOps(requestId: string, notes?: string) {
    const row = await this.prisma.installationRequest.findUnique({
      where: { id: requestId },
      select: { tenantId: true },
    });
    if (!row) throw new NotFoundException('Installation request not found');
    return this.complete(row.tenantId, requestId, notes);
  }

  /** SuperAdmin-side list across all tenants for the ops queue. */
  async listAll(status?: string, assignedTo?: string) {
    return this.prisma.installationRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(assignedTo ? { assignedTo } : {}),
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }
}
