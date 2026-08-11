import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAddOnDto, UpdateAddOnDto } from "./dto/addon.dto";
import { CatalogRowShape, validateCatalogRow } from "./catalog-validation";

/**
 * Catalog management for marketplace add-ons.
 *
 * This is the super-admin face of the add-on system — it owns the
 * MarketplaceAddOn rows that the TenantMarketplaceService later instantiates
 * into TenantAddOn pivots. Catalog rows can be in three states:
 *   draft     — admin can edit freely; not visible in tenant marketplace
 *   published — visible and purchasable
 *   archived  — already-purchased tenants keep their entitlement; new
 *               purchases blocked. Equivalent to soft-delete.
 *
 * v3.3.0 REVERSED the previous "keep the catalog permissive" policy. That was
 * defensible while the catalog was a 14-row seed file edited by developers;
 * with à-la-carte it is the only thing between a superadmin's JSON blob and
 * what a paying tenant receives, and the permissive policy had already cost
 * money twice (`limit.branches` sold a branch cap that never rose;
 * `limit.kdsScreens`/`kdsStations`/`tablets` are granted by published rows and
 * read by nothing). Every write now goes through `validateCatalogRow`.
 */
@Injectable()
export class AddOnCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters?: { status?: string; kind?: string }) {
    return this.prisma.marketplaceAddOn.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.kind ? { kind: filters.kind } : {}),
      },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
  }

  /** Public storefront — returns only published rows, fields trimmed for UI. */
  async listPublic() {
    const rows = await this.prisma.marketplaceAddOn.findMany({
      where: { status: "published" },
      orderBy: [{ sortOrder: "asc" }, { kind: "asc" }, { name: "asc" }],
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      kind: r.kind,
      billing: r.billing,
      priceCents: r.priceCents,
      currency: r.currency,
      deps: r.deps,
      requiresLicense: r.requiresLicense,
      creditKind: r.creditKind,
      creditUnits: r.creditUnits,
      maxQuantity: r.maxQuantity,
      sortOrder: r.sortOrder,
      i18n: r.i18n,
    }));
  }

  async findByCodeOrThrow(code: string) {
    const row = await this.prisma.marketplaceAddOn.findUnique({
      where: { code },
    });
    if (!row) throw new NotFoundException(`Add-on not found: ${code}`);
    return row;
  }

  /**
   * Reject a row that would take money and grant nothing. Reports EVERY
   * problem at once so the admin UI can show them in a single pass.
   */
  private assertValid(row: CatalogRowShape) {
    const problems = validateCatalogRow(row);
    if (problems.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Invalid catalog product",
        errorCode: "CATALOG_INVALID",
        message: problems,
      });
    }
  }

  async create(dto: CreateAddOnDto) {
    this.assertValid({
      code: dto.code,
      kind: dto.kind,
      billing: dto.billing,
      priceCents: dto.priceCents,
      status: dto.status ?? "draft",
      grants: dto.grants ?? {},
      deps: dto.deps ?? [],
      requiresLicense: dto.requiresLicense ?? true,
      creditKind: dto.creditKind,
      creditUnits: dto.creditUnits,
      maxQuantity: dto.maxQuantity,
    });
    try {
      return await this.prisma.marketplaceAddOn.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          kind: dto.kind,
          billing: dto.billing,
          priceCents: dto.priceCents,
          currency: dto.currency ?? "TRY",
          grants: dto.grants as any,
          deps: dto.deps ?? [],
          status: dto.status ?? "draft",
          requiresLicense: dto.requiresLicense ?? true,
          creditKind: dto.creditKind ?? null,
          creditUnits: dto.creditUnits ?? null,
          maxQuantity: dto.maxQuantity ?? null,
          sortOrder: dto.sortOrder ?? 0,
          i18n: (dto.i18n ?? undefined) as any,
          ...(dto.commissionRate != null
            ? { commissionRate: dto.commissionRate }
            : {}),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException(`Add-on code already exists: ${dto.code}`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateAddOnDto) {
    const exists = await this.prisma.marketplaceAddOn.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException("Add-on not found");

    // PATCH semantics: validate the row as it will look AFTER the merge, not
    // just the fields being sent. Validating the delta alone would let
    // "change kind to credit" through while creditKind stays null.
    const merged: CatalogRowShape = {
      code: exists.code,
      kind: dto.kind ?? exists.kind,
      billing: dto.billing ?? exists.billing,
      priceCents: dto.priceCents ?? exists.priceCents,
      status: dto.status ?? exists.status,
      grants: (dto.grants ?? (exists.grants as any) ?? {}) as Record<
        string,
        unknown
      >,
      deps: dto.deps ?? exists.deps,
      requiresLicense: dto.requiresLicense ?? exists.requiresLicense,
      creditKind: dto.creditKind ?? exists.creditKind,
      creditUnits: dto.creditUnits ?? exists.creditUnits,
      maxQuantity: dto.maxQuantity ?? exists.maxQuantity,
    };
    this.assertValid(merged);

    return this.prisma.marketplaceAddOn.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        kind: dto.kind,
        billing: dto.billing,
        priceCents: dto.priceCents,
        currency: dto.currency,
        grants: dto.grants as any,
        deps: dto.deps,
        status: dto.status,
        requiresLicense: dto.requiresLicense,
        creditKind: dto.creditKind,
        creditUnits: dto.creditUnits,
        maxQuantity: dto.maxQuantity,
        sortOrder: dto.sortOrder,
        i18n: (dto.i18n ?? undefined) as any,
        ...(dto.commissionRate != null
          ? { commissionRate: dto.commissionRate }
          : {}),
      },
    });
  }

  /**
   * Soft-delete. Bypasses assertValid deliberately: a row may have become
   * invalid under newer rules (a legacy `kind`, a dead grant key) and
   * retiring it must never be blocked by the very problem being retired.
   */
  async archive(id: string) {
    const exists = await this.prisma.marketplaceAddOn.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException("Add-on not found");
    return this.prisma.marketplaceAddOn.update({
      where: { id },
      data: { status: "archived" },
    });
  }

  /**
   * Verify dependency strings resolve to existing catalog rows. Returns an
   * array of "missing dep" strings; an empty array means the deps are
   * satisfiable (independent of the asking tenant — that check lives in
   * TenantMarketplaceService).
   *
   * v3.3.0 dropped the `plan:<NAME>` form. Plans are retired, so such a dep
   * could never be satisfied and would 400 every purchase of the product
   * carrying it. `validateCatalogRow` rejects it at write time; this method
   * no longer resolves it at all.
   */
  async resolveDeps(deps: string[]): Promise<string[]> {
    const missing: string[] = [];
    if (deps.length > 0) {
      const found = await this.prisma.marketplaceAddOn.findMany({
        where: { code: { in: deps } },
        select: { code: true },
      });
      const have = new Set(found.map((r) => r.code));
      for (const c of deps) if (!have.has(c)) missing.push(c);
    }
    if (missing.length > 0) {
      throw new BadRequestException(`Unresolved deps: ${missing.join(", ")}`);
    }
    return missing;
  }
}
