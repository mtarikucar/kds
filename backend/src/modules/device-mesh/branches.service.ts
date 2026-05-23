import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOrThrow(tenantId: string, id: string) {
    // Compound WHERE rather than findUnique + manual !== check — same
    // defense-in-depth rationale as iter-9/12/33/34's write-path sweeps.
    // The previous shape returns the row from a find-by-id step before
    // the tenant guard, so a future refactor that extracts the find
    // into a helper would silently leak a cross-tenant row's contents.
    const row = await this.prisma.branch.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Branch not found');
    return row;
  }

  /** Tenant-scoped "main" branch — convenience for legacy callers. */
  async defaultFor(tenantId: string) {
    return this.prisma.branch.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    tenantId: string,
    input: { name?: string; code?: string; timezone?: string; address?: Record<string, unknown> },
  ) {
    return this.prisma.branch.create({
      data: {
        tenantId,
        name: input.name ?? 'New Branch',
        code: input.code ?? null,
        timezone: input.timezone ?? 'UTC',
        address: (input.address ?? null) as any,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: { name?: string; code?: string; timezone?: string; address?: Record<string, unknown>; status?: string },
  ) {
    await this.findOrThrow(tenantId, id);
    if (input.status && !['active', 'suspended', 'archived'].includes(input.status)) {
      throw new BadRequestException(`Invalid status: ${input.status}`);
    }
    return this.prisma.branch.update({
      where: { id },
      data: {
        name: input.name,
        code: input.code,
        timezone: input.timezone,
        address: input.address as any,
        status: input.status,
      },
    });
  }

  async archive(tenantId: string, id: string) {
    // Soft delete — preserves device/order history that references the branch.
    return this.update(tenantId, id, { status: 'archived' });
  }
}
