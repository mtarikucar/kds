import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";

/**
 * Warranty bookkeeping. One row per (product, serial). Created automatically
 * by the provisioning saga at hardware-order delivery; claims are appended
 * via this service as JSONB objects on the row.
 *
 * Claim storage is intentionally a JSONB array on the row instead of a
 * separate table — the volume per warranty is small (single digits), the
 * read pattern is "show me the claim history for this serial", and we avoid
 * a join for the most common UI query.
 */
@Injectable()
export class WarrantyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Create a warranty row, typically called from the delivered-saga. */
  async createForSerial(
    tenantId: string,
    input: {
      productId: string;
      serial: string;
      warrantyMonths: number;
      deviceId?: string;
    },
  ) {
    const start = new Date();
    const end = new Date(
      start.getTime() + input.warrantyMonths * 30 * 24 * 3600 * 1000,
    );
    const row = await this.prisma.warranty.create({
      data: {
        id: uuidv7(),
        tenantId,
        productId: input.productId,
        serial: input.serial,
        deviceId: input.deviceId,
        startAt: start,
        endAt: end,
        status: "active",
      },
    });
    await this.outbox
      .append({
        type: "warranty.created.v1",
        tenantId,
        payload: {
          warrantyId: row.id,
          productId: input.productId,
          serial: input.serial,
          endAt: end,
        },
      })
      .catch(() => undefined);
    return row;
  }

  async fileClaim(
    tenantId: string,
    warrantyId: string,
    input: {
      issue: string;
      severity?: "low" | "medium" | "high";
      description?: string;
    },
  ) {
    const row = await this.prisma.warranty.findFirst({
      where: { id: warrantyId, tenantId },
    });
    if (!row) throw new NotFoundException("Warranty not found");
    if (row.status !== "active")
      throw new BadRequestException(`Warranty status=${row.status}`);

    const claim = {
      id: uuidv7(),
      date: new Date().toISOString(),
      issue: input.issue,
      severity: input.severity ?? "medium",
      description: input.description,
      status: "open",
    };
    // Compound WHERE (B41-B45 pattern). The findFirst above already
    // proves ownership, but a future refactor that hoists the
    // early-return or condenses the txn shouldn't get to silently leak
    // into a cross-tenant claim push. updateMany with (id, tenantId)
    // and an explicit count check guards the write surface too.
    const updateRes = await this.prisma.warranty.updateMany({
      where: { id: row.id, tenantId },
      data: { claims: { push: claim as any } },
    });
    if (updateRes.count === 0) {
      throw new NotFoundException("Warranty not found");
    }
    const updated = await this.prisma.warranty.findUniqueOrThrow({
      where: { id: row.id },
    });
    await this.outbox
      .append({
        type: "warranty.claim.filed.v1",
        tenantId,
        payload: { warrantyId, claimId: claim.id, issue: input.issue },
      })
      .catch(() => undefined);
    return updated;
  }

  /** Sweeper: flip expired warranties to status='expired'. */
  async sweepExpired() {
    const now = new Date();
    const res = await this.prisma.warranty.updateMany({
      where: { status: "active", endAt: { lt: now } },
      data: { status: "expired" },
    });
    return res.count;
  }
}
