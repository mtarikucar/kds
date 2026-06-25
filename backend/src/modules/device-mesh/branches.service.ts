import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DeviceService } from "./device.service";
import { BranchGuard } from "../auth/guards/branch.guard";

/** The caller's branch-access context (role + allow-list) for hub scoping. */
export interface BranchAccess {
  role: string;
  primaryBranchId: string | null;
  allowedBranchIds: readonly string[];
}

/**
 * Branch CRUD. Each tenant is guaranteed (via migration backfill) to have
 * at least one branch, named "Main" by default. Features that haven't yet
 * adopted branch-scoping keep operating on the tenant level — this service
 * exists so multi-branch chains can be modelled cleanly when downstream
 * modules adopt branchId.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DeviceService,
  ) {}

  list(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
  }

  async findOrThrow(tenantId: string, id: string) {
    // Compound WHERE rather than findUnique + manual !== check — same
    // defense-in-depth rationale as iter-9/12/33/34's write-path sweeps.
    // The previous shape returns the row from a find-by-id step before
    // the tenant guard, so a future refactor that extracts the find
    // into a helper would silently leak a cross-tenant row's contents.
    const row = await this.prisma.branch.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Branch not found");
    return row;
  }

  /** Tenant-scoped "main" branch — convenience for legacy callers. */
  async defaultFor(tenantId: string) {
    return this.prisma.branch.findFirst({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(
    tenantId: string,
    input: {
      name?: string;
      code?: string;
      timezone?: string;
      address?: Record<string, unknown>;
    },
  ) {
    return this.prisma.branch.create({
      data: {
        tenantId,
        name: input.name ?? "New Branch",
        code: input.code ?? null,
        timezone: input.timezone ?? "UTC",
        address: (input.address ?? null) as any,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      name?: string;
      code?: string;
      timezone?: string;
      address?: Record<string, unknown>;
      status?: string;
    },
  ) {
    await this.findOrThrow(tenantId, id);
    if (
      input.status &&
      !["active", "suspended", "archived"].includes(input.status)
    ) {
      throw new BadRequestException(`Invalid status: ${input.status}`);
    }
    // Compound WHERE (B41-B45 pattern, iter-31 onward). findOrThrow above
    // already proves ownership, but the surrounding codebase enforces
    // tenant scope at the query layer too so a future refactor that
    // drops the pre-check can't leak into a cross-tenant rename, status
    // flip, or timezone change. Surfacing count=0 as NotFoundException
    // also closes a TOCTOU window where the row is archived between
    // the findOrThrow read and the write.
    const claim = await this.prisma.branch.updateMany({
      where: { id, tenantId },
      data: {
        name: input.name,
        code: input.code,
        timezone: input.timezone,
        address: input.address as any,
        status: input.status,
      },
    });
    if (claim.count === 0) throw new NotFoundException("Branch not found");
    return this.prisma.branch.findFirstOrThrow({ where: { id, tenantId } });
  }

  async archive(tenantId: string, id: string) {
    // Soft delete — preserves device/order history that references the branch.
    return this.update(tenantId, id, { status: "archived" });
  }

  /**
   * Branch hub overview: every branch (HQ/Merkez first) with its live device
   * tallies (real online/total + pending pairings) and bridge count, in ONE
   * call (no N+1). Powers the branch cards on the consolidated hub.
   */
  async overview(tenantId: string, access: BranchAccess) {
    const all = await this.prisma.branch.findMany({
      where: { tenantId },
      orderBy: [{ isHeadquarters: "desc" }, { createdAt: "asc" }],
    });
    // Branch-restricted MANAGERs only see their assigned branches' inventory
    // (ADMIN with an empty allow-list = tenant-wide wildcard). Mirrors the
    // /v1/branches/visible filter so the hub never leaks unassigned-branch
    // device/bridge inventory.
    const branches = all.filter((b) =>
      BranchGuard.canAccessBranchStatic(
        access.role,
        b.id,
        access.primaryBranchId,
        access.allowedBranchIds,
      ),
    );
    const counts = await this.devices.countsByBranch(tenantId);
    const bridgeRows = await this.prisma.localBridgeAgent.groupBy({
      by: ["branchId"],
      where: { tenantId, status: { not: "retired" } },
      _count: { _all: true },
    });
    const bridgesByBranch: Record<string, number> = {};
    for (const r of bridgeRows) bridgesByBranch[r.branchId] = r._count._all;
    return branches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      timezone: b.timezone,
      status: b.status,
      isHeadquarters: b.isHeadquarters,
      createdAt: b.createdAt,
      devices: counts[b.id] ?? { total: 0, online: 0, pending: 0 },
      bridges: bridgesByBranch[b.id] ?? 0,
    }));
  }

  /**
   * A branch's local-network topology ("şube içi ağ"): its bridges with the
   * devices behind each, plus the cloud-direct devices (no bridge). Retired
   * rows excluded. The acting tenant must own the branch (findOrThrow → 404).
   */
  async network(tenantId: string, branchId: string, access: BranchAccess) {
    // A branch-restricted MANAGER must not read an unassigned branch's network
    // inventory (serials/hostnames/agent versions). 404 (not 403) so we don't
    // leak which branch ids exist. ADMIN empty allow-list = wildcard.
    if (
      !BranchGuard.canAccessBranchStatic(
        access.role,
        branchId,
        access.primaryBranchId,
        access.allowedBranchIds,
      )
    ) {
      throw new NotFoundException("Branch not found");
    }
    await this.findOrThrow(tenantId, branchId);
    const bridges = await this.prisma.localBridgeAgent.findMany({
      where: { tenantId, branchId, status: { not: "retired" } },
      select: {
        id: true,
        hostname: true,
        productSku: true,
        status: true,
        agentVersion: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const devices = await this.prisma.device.findMany({
      where: { tenantId, branchId, status: { not: "retired" } },
      select: {
        id: true,
        kind: true,
        status: true,
        bridgeId: true,
        serial: true,
        model: true,
        lastSeenAt: true,
      },
      orderBy: [{ bridgeId: "asc" }, { kind: "asc" }],
    });
    const behind: Record<string, typeof devices> = {};
    const cloudDirect: typeof devices = [];
    for (const d of devices) {
      if (d.bridgeId) (behind[d.bridgeId] ??= []).push(d);
      else cloudDirect.push(d);
    }
    return {
      bridges: bridges.map((br) => ({ ...br, devices: behind[br.id] ?? [] })),
      cloudDirect,
    };
  }
}
