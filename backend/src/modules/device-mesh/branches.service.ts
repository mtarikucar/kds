import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Branch CRUD. Each tenant is guaranteed (via migration backfill) to have
 * at least one branch, named "Main" by default. Features that haven't yet
 * adopted branch-scoping keep operating on the tenant level — this service
 * exists so multi-branch chains can be modelled cleanly when downstream
 * modules adopt branchId.
 */
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
