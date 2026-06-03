import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAddOnDto, UpdateAddOnDto } from "./dto/addon.dto";

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
 * The service deliberately does NOT validate that `grants` keys match the
 * entitlement key namespace ("feature.*", "limit.*", "integration.*").
 * Those validations live in the projector, where they are coupled to the
 * engine's actual fold rules. Keeping the catalog permissive lets us
 * roll out new key prefixes without redeploying this service.
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
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
  }

  /** Public marketplace — returns only published rows, fields trimmed for UI. */
  async listPublic() {
    const rows = await this.prisma.marketplaceAddOn.findMany({
      where: { status: "published" },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
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
    }));
  }

  async findByCodeOrThrow(code: string) {
    const row = await this.prisma.marketplaceAddOn.findUnique({
      where: { code },
    });
    if (!row) throw new NotFoundException(`Add-on not found: ${code}`);
    return row;
  }

  async create(dto: CreateAddOnDto) {
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
      },
    });
  }

  async archive(id: string) {
    return this.update(id, { status: "archived" });
  }

  /**
   * Verify dependency strings resolve to existing things. Returns an array
   * of "missing dep" strings; an empty array means the deps are satisfiable
   * (independent of the asking tenant — that check lives in TenantMarketplace).
   */
  async resolveDeps(deps: string[]): Promise<string[]> {
    const missing: string[] = [];
    const addonCodes = deps.filter((d) => !d.startsWith("plan:"));
    const planNames = deps
      .filter((d) => d.startsWith("plan:"))
      .map((d) => d.slice("plan:".length));

    if (addonCodes.length > 0) {
      const found = await this.prisma.marketplaceAddOn.findMany({
        where: { code: { in: addonCodes } },
        select: { code: true },
      });
      const have = new Set(found.map((r) => r.code));
      for (const c of addonCodes) if (!have.has(c)) missing.push(c);
    }
    if (planNames.length > 0) {
      const found = await this.prisma.subscriptionPlan.findMany({
        where: { name: { in: planNames } },
        select: { name: true },
      });
      const have = new Set(found.map((r) => r.name));
      for (const n of planNames) if (!have.has(n)) missing.push(`plan:${n}`);
    }
    if (missing.length > 0) {
      throw new BadRequestException(`Unresolved deps: ${missing.join(", ")}`);
    }
    return missing;
  }
}
