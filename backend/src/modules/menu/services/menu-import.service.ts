import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { PrismaService } from "../../../prisma/prisma.service";
import { CategoriesService } from "./categories.service";
import { ProductsService } from "./products.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { MenuAiQuotaService } from "./menu-ai-quota.service";
import { isUnlimited } from "../../../common/constants/subscription-plans.const";
import {
  CommitMenuImportDto,
  MenuImportCategoryDraftDto,
} from "../dto/menu-import.dto";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

// The model is instructed to return ONLY this JSON. Kept tight so the review
// grid can trust the shape; anything else is normalised/dropped on parse.
const EXTRACTION_PROMPT = `You are digitising a restaurant's paper/printed menu from the attached photo(s).

Extract EVERY menu item you can read into JSON with this EXACT shape:
{
  "categories": [
    {
      "name": "<section heading, e.g. Başlangıçlar / Ana Yemekler / İçecekler>",
      "products": [
        { "name": "<item name>", "description": "<short description or empty>", "price": <number>, "taxRate": <0|1|10|20 or omit> }
      ]
    }
  ]
}

Rules:
- Group items under the section heading they appear beneath. If there is no heading, use "Menü".
- price MUST be a number in the menu's currency, digits only (strip ₺/TL/$/€ and thousands separators). If a price is unreadable, use 0.
- Keep the item's original language; do NOT translate.
- Omit taxRate unless the menu clearly states a KDV/VAT rate.
- Do NOT invent items. Only include what is visibly on the menu.
- Return ONLY the JSON object, no prose, no markdown fences.`;

export interface CommitSummary {
  categoriesCreated: number;
  categoriesMatched: number;
  productsCreated: number;
  failures: { category: string; product: string; reason: string }[];
}

@Injectable()
export class MenuImportService {
  private readonly logger = new Logger(MenuImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
    private readonly entitlements: EntitlementService,
    private readonly quota: MenuAiQuotaService,
  ) {}

  /** Whether the AI menu-import feature is wired (an API key is present). */
  isConfigured(): boolean {
    return !!this.config.get<string>("ANTHROPIC_API_KEY");
  }

  /**
   * Send the uploaded menu photo(s) to Claude vision and parse the returned
   * draft. Pure read — persists nothing. The operator reviews/edits the draft
   * before commit().
   *
   * Metered: each parse is a real Anthropic vision call (up to 10×8MB
   * images), so it consumes one unit of the tenant's monthly PHOTO
   * allowance — the feature flag alone would leave the spend unbounded. A
   * failed call refunds the claim.
   */
  async parseMenuPhotos(
    tenantId: string,
    images: { buffer: Buffer; mimetype: string }[],
  ): Promise<CommitMenuImportDto> {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // Feature ships INERT until a key is configured — a clear, actionable
      // error rather than a 500 from the HTTP call.
      throw new ServiceUnavailableException(
        "AI menu import is not configured (ANTHROPIC_API_KEY missing). Set the key to enable photo digitisation.",
      );
    }
    if (!images.length) {
      throw new BadRequestException("At least one menu photo is required");
    }
    const usageId = await this.quota.claim(tenantId, "PHOTO", 1);
    await this.quota
      .attachJob(usageId, `menu-import:${usageId}`)
      .catch(() => undefined);

    const imageBlocks = images.map((img) => {
      const mediaType = SUPPORTED_IMAGE_TYPES.includes(img.mimetype)
        ? img.mimetype
        : "image/jpeg";
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType,
          data: img.buffer.toString("base64"),
        },
      };
    });

    const model =
      this.config.get<string>("MENU_IMPORT_MODEL") || "claude-sonnet-5";

    let text: string;
    try {
      const res = await axios.post(
        ANTHROPIC_URL,
        {
          model,
          max_tokens: 8000,
          messages: [
            {
              role: "user",
              content: [
                ...imageBlocks,
                { type: "text", text: EXTRACTION_PROMPT },
              ],
            },
          ],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 120_000,
        },
      );
      text = (res.data?.content ?? [])
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    } catch (err: any) {
      // Failed vision call — refund the claim.
      await this.quota.voidUsage(usageId).catch(() => undefined);
      const detail = err?.response?.data?.error?.message ?? err?.message;
      this.logger.error(`Anthropic menu-parse failed: ${detail}`);
      throw new ServiceUnavailableException(
        "Menu digitisation service is temporarily unavailable — try again.",
      );
    }

    try {
      return this.normaliseDraft(text);
    } catch (err) {
      // The model answered but with an unusable draft — the user got
      // nothing, so give the unit back.
      await this.quota.voidUsage(usageId).catch(() => undefined);
      throw err;
    }
  }

  /** Robustly parse + clamp the model's JSON into the commit DTO shape. */
  private normaliseDraft(raw: string): CommitMenuImportDto {
    // Strip accidental markdown fences and locate the JSON object.
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new ServiceUnavailableException(
        "Could not read the menu from the photo — try a clearer, well-lit image.",
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new ServiceUnavailableException(
        "Could not read the menu from the photo — try a clearer, well-lit image.",
      );
    }

    const validTax = new Set([0, 1, 10, 20]);
    const categories: MenuImportCategoryDraftDto[] = Array.isArray(
      parsed?.categories,
    )
      ? parsed.categories
          .map((c: any) => ({
            name:
              String(c?.name ?? "")
                .trim()
                .slice(0, 200) || "Menü",
            products: Array.isArray(c?.products)
              ? c.products
                  .map((p: any) => {
                    const price = Number(p?.price);
                    return {
                      name: String(p?.name ?? "")
                        .trim()
                        .slice(0, 200),
                      description: p?.description
                        ? String(p.description).trim().slice(0, 5000)
                        : undefined,
                      price:
                        Number.isFinite(price) && price >= 0
                          ? Math.round(price * 100) / 100
                          : 0,
                      taxRate: validTax.has(Number(p?.taxRate))
                        ? Number(p.taxRate)
                        : undefined,
                    };
                  })
                  .filter((p: any) => p.name.length > 0)
              : [],
          }))
          .filter((c: any) => c.products.length > 0)
      : [];

    if (!categories.length) {
      throw new ServiceUnavailableException(
        "No menu items were found in the photo — try a clearer image.",
      );
    }
    return { categories };
  }

  /**
   * Persist the operator-reviewed draft: match/create categories, then create
   * products. NOT one big transaction on purpose — a partial import (with a
   * per-item failure report) is better UX for a bulk paper-menu import than an
   * all-or-nothing rollback. Reuses CategoriesService/ProductsService so every
   * validation + side effect is identical to manual creation.
   */
  async commitDraft(
    dto: CommitMenuImportDto,
    tenantId: string,
  ): Promise<CommitSummary> {
    const totalProducts = dto.categories.reduce(
      (n, c) => n + c.products.length,
      0,
    );

    // Batch plan-limit check up front (parity with @CheckLimit, but for the
    // whole import). Reject before creating anything if it would blow the cap.
    const set = await this.entitlements.getForTenant(tenantId, null);
    await this.assertWithinLimit(
      tenantId,
      "product",
      set.limits?.["limit.maxProducts"],
      totalProducts,
    );

    // Existing categories the import may reuse (case-insensitive by name).
    const existing = await this.prisma.category.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });
    const byName = new Map(
      existing.map((c) => [c.name.trim().toLowerCase(), c.id]),
    );
    const newCategoryCount = dto.categories.filter(
      (c) => !byName.has(c.name.trim().toLowerCase()),
    ).length;
    await this.assertWithinLimit(
      tenantId,
      "category",
      set.limits?.["limit.maxCategories"],
      newCategoryCount,
    );

    const summary: CommitSummary = {
      categoriesCreated: 0,
      categoriesMatched: 0,
      productsCreated: 0,
      failures: [],
    };

    for (let i = 0; i < dto.categories.length; i++) {
      const cat = dto.categories[i];
      const key = cat.name.trim().toLowerCase();
      let categoryId = byName.get(key);
      if (categoryId) {
        summary.categoriesMatched++;
      } else {
        try {
          const created = await this.categories.create(
            { name: cat.name, displayOrder: i },
            tenantId,
          );
          categoryId = created.id;
          byName.set(key, categoryId);
          summary.categoriesCreated++;
        } catch (err: any) {
          for (const p of cat.products) {
            summary.failures.push({
              category: cat.name,
              product: p.name,
              reason: `category create failed: ${err?.message ?? "unknown"}`,
            });
          }
          continue;
        }
      }

      for (const p of cat.products) {
        try {
          await this.products.create(
            {
              name: p.name,
              description: p.description,
              price: p.price,
              taxRate: p.taxRate ?? 10,
              categoryId,
            } as any,
            tenantId,
          );
          summary.productsCreated++;
        } catch (err: any) {
          summary.failures.push({
            category: cat.name,
            product: p.name,
            reason: err?.message ?? "unknown",
          });
        }
      }
    }

    return summary;
  }

  private async assertWithinLimit(
    tenantId: string,
    resource: "product" | "category",
    limit: number | undefined,
    toCreate: number,
  ): Promise<void> {
    if (limit === undefined || isUnlimited(limit)) return;
    const current =
      resource === "product"
        ? await this.prisma.product.count({ where: { tenantId } })
        : await this.prisma.category.count({ where: { tenantId } });
    if (current + toCreate > limit) {
      throw new BadRequestException(
        `This import would exceed your plan's ${resource} limit ` +
          `(${current}/${limit} used, importing ${toCreate}). ` +
          `Remove some items or upgrade your plan.`,
      );
    }
  }
}
