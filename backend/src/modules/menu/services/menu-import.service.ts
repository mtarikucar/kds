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
  MenuImportProductDraftDto,
} from "../dto/menu-import.dto";
import { foldMenuKey } from "./menu-key-fold";
import { RequestContext } from "../../../common/context/request-context";
import { resolveCountryProfile } from "../../../common/country/country.service";

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
  productsUpdated: number;
  productsSkipped: number;
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

    let text: string;
    try {
      text = await this.askClaude(imageBlocks, EXTRACTION_PROMPT);
    } catch (err) {
      // Failed vision call — refund the claim.
      await this.quota.voidUsage(usageId).catch(() => undefined);
      throw err;
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

  /** Text (a page, a chunk of one) → draft. Not metered — the caller meters. */
  async parseTextToDraft(text: string): Promise<CommitMenuImportDto> {
    const answer = await this.askClaude(
      [{ type: "text", text }],
      EXTRACTION_PROMPT,
    );
    return this.normaliseDraft(answer, "source");
  }

  /** A PDF (or any Claude-supported document) → draft. Not metered. */
  async parseDocumentToDraft(
    bytes: Buffer,
    mediaType: string,
  ): Promise<CommitMenuImportDto> {
    const answer = await this.askClaude(
      [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: mediaType,
            data: bytes.toString("base64"),
          },
        },
      ],
      EXTRACTION_PROMPT,
    );
    return this.normaliseDraft(answer, "source");
  }

  /** Header + sample rows → which column is which. Not metered. */
  async parseColumnMap(
    sample: string,
    prompt: string,
  ): Promise<Record<string, string | null>> {
    const answer = await this.askClaude(
      [{ type: "text", text: sample }],
      prompt,
    );
    const cleaned = answer.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new BadRequestException("could not read the column mapping");
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new BadRequestException("could not read the column mapping");
    }
  }

  /**
   * Single Claude transport for every menu source. Content blocks differ per
   * source (image / document / text); everything else — model, headers,
   * timeout, how the answer's text parts are joined — is identical, so it
   * lives here once.
   *
   * Deliberately does NOT touch the quota: the caller claims before and
   * refunds after, because only the caller knows how many units the whole
   * operation cost (a chunked import claims N up front).
   */
  private async askClaude(blocks: unknown[], prompt: string): Promise<string> {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "AI menu import is not configured (ANTHROPIC_API_KEY missing).",
      );
    }
    const model =
      this.config.get<string>("MENU_IMPORT_MODEL") || "claude-sonnet-5";
    try {
      const res = await axios.post(
        ANTHROPIC_URL,
        {
          model,
          max_tokens: 8000,
          messages: [
            {
              role: "user",
              content: [...blocks, { type: "text", text: prompt }],
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
      return (res.data?.content ?? [])
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message ?? err?.message;
      this.logger.error(`Anthropic call failed: ${detail}`);
      throw new ServiceUnavailableException(
        "Menu digitisation service is temporarily unavailable — try again.",
      );
    }
  }

  /**
   * Robustly parse + clamp the model's JSON into the commit DTO shape.
   *
   * `source` picks the wording of the two failure messages below: the
   * default "photo" advice ("try a clearer, well-lit image") is right for
   * parseMenuPhotos, but nonsensical for a link/file/text import — those
   * pass "source" instead so an operator who pasted a URL is never told to
   * take a better picture.
   */
  private normaliseDraft(
    raw: string,
    source: "photo" | "source" = "photo",
  ): CommitMenuImportDto {
    const unreadableMessage =
      source === "photo"
        ? "Could not read the menu from the photo — try a clearer, well-lit image."
        : "Could not read a menu from that source — check the file or link and try again.";
    const emptyMessage =
      source === "photo"
        ? "No menu items were found in the photo — try a clearer image."
        : "No menu items were found at that source.";

    // Strip accidental markdown fences and locate the JSON object.
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new ServiceUnavailableException(unreadableMessage);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new ServiceUnavailableException(unreadableMessage);
    }

    // Country-scoped, not a fixed TR band — a UZ tenant's photo/text import
    // can carry the model's read of a 12% QQS or 6% catering line, neither
    // of which is in Turkey's 0/1/10/20. This runs inside the same request
    // that uploaded the source, so the ambient country is already resolved.
    const validTax = new Set(
      resolveCountryProfile(RequestContext.get()?.countryCode).taxRates,
    );
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
      throw new ServiceUnavailableException(emptyMessage);
    }
    return { categories };
  }

  /**
   * Mark the draft rows that already exist, so the review grid can offer a
   * choice instead of silently doubling the menu.
   *
   * Matching is scoped to the category, not the whole menu: "Ayran" can
   * legitimately live in both İçecekler and Menüler and those are two
   * different products. A draft category the tenant does not have yet can
   * therefore never collide.
   *
   * Deliberately does NOT pick a winner when a fold key is ambiguous — the
   * tenants this feature exists for are exactly the ones whose menu already
   * got doubled by the old unconditional-CREATE behaviour, so two
   * same-named products in one category is the expected, not the edge,
   * case. Ambiguous rows come back with no `existingProductId` (an
   * `ambiguous: true` marker instead, for the grid to surface) rather than
   * a nondeterministically-chosen one.
   */
  async annotateConflicts(
    draft: CommitMenuImportDto,
    tenantId: string,
  ): Promise<CommitMenuImportDto> {
    // Product has no deletedAt column (hard-deletes only) — filtering on it
    // would throw a Prisma validation error at runtime.
    const existing = await this.prisma.product.findMany({
      where: { tenantId },
      // Deterministic order: with none, Postgres is free to return two
      // same-named-in-one-category products in a different order on every
      // call, and the "last one wins" index below would then point
      // UPDATE_PRICE at a different twin each time it runs.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        price: true,
        category: { select: { name: true } },
      },
    });

    const key = (cat: string, name: string) =>
      `${foldMenuKey(cat)} ${foldMenuKey(name)}`;

    const index = new Map<string, { id: string; price: number }>();
    const ambiguousKeys = new Set<string>();
    for (const p of existing) {
      if (!p.category?.name) continue;
      const k = key(p.category.name, p.name);
      if (index.has(k)) {
        // Product has no unique constraint on (categoryId, name) — two
        // existing rows already share this fold key. Do not silently pick
        // one; leave it for the operator to resolve by hand.
        ambiguousKeys.add(k);
        continue;
      }
      index.set(k, { id: p.id, price: Number(p.price) });
    }

    // A draft row can itself repeat a (category, name) key — a duplicated
    // OCR read is the common case. Only the first occurrence claims the
    // match; a second occurrence claiming the same existing product would
    // otherwise race UPDATE_PRICE against itself and double-count as two
    // updates for one product touched.
    const claimed = new Set<string>();
    return {
      categories: draft.categories.map((c) => ({
        ...c,
        products: c.products.map((p) => {
          const k = key(c.name, p.name);
          if (ambiguousKeys.has(k) || claimed.has(k)) {
            // Strip any existingProductId the incoming draft already
            // carried (a re-annotated draft, or a stale grid edit) — an
            // ambiguous key must never leave with an id attached, or
            // commit would honour it as a confident match.
            return { ...p, ambiguous: true, existingProductId: undefined };
          }
          const hit = index.get(k);
          if (!hit) return p;
          claimed.add(k);
          return {
            ...p,
            existingProductId: hit.id,
            existingPrice: hit.price,
            onConflict: "SKIP" as const,
          };
        }),
      })),
    } as CommitMenuImportDto;
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
    // Only rows that will actually CREATE a product count against the plan
    // limit — a SKIP, UPDATE_PRICE, or unresolved-ambiguous row touches (or
    // refuses to touch) an existing product, it does not add one. Shares
    // resolveRowAction with the commit loop below so the two can never
    // disagree about which rows create.
    const totalProducts = dto.categories.reduce(
      (n, c) =>
        n +
        c.products.filter((p) => this.resolveRowAction(p) === "CREATE").length,
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
    const byName = new Map(existing.map((c) => [foldMenuKey(c.name), c.id]));
    const newCategoryCount = dto.categories.filter(
      (c) => !byName.has(foldMenuKey(c.name)),
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
      productsUpdated: 0,
      productsSkipped: 0,
      failures: [],
    };

    // Products already repriced by an earlier row in THIS commit call. A
    // crafted body (commit is callable directly, without going through
    // annotateConflicts first) can still name the same existingProductId
    // twice; without this, both rows would "succeed" and productsUpdated
    // would claim two updates for one product actually touched.
    const touchedProductIds = new Set<string>();

    for (let i = 0; i < dto.categories.length; i++) {
      const cat = dto.categories[i];
      const key = foldMenuKey(cat.name);
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
        const action = this.resolveRowAction(p);

        if (action === "AMBIGUOUS") {
          // annotateConflicts withheld existingProductId on purpose — this
          // row's (category, name) matched more than one existing product
          // (or another row in this same draft already claimed the only
          // match) and the server refused to guess which one. Defaulting
          // to CREATE here would add a THIRD copy to a menu that is
          // already doubled — exactly the population this feature exists
          // to help. Fail instead; the operator's explicit CREATE stays
          // the escape hatch for "yes, really add another".
          summary.failures.push({
            category: cat.name,
            product: p.name,
            reason:
              "this row matches more than one existing product in this " +
              "category — resolve manually, or choose Create to add another",
          });
          continue;
        }

        if (action === "SKIP") {
          summary.productsSkipped++;
          continue;
        }

        if (action === "UPDATE_PRICE") {
          // A price of 0 is never a real quote — parsing/normalisation
          // coerces an unreadable cell to 0, and today only the SKIP
          // default and the operator's attention stand between a
          // badly-parsed price and a real, already-selling product being
          // silently zeroed out. Refuse. A brand-new product created at 0
          // stays allowed — that is a visible new row the operator can
          // fix, not a silent edit to something already live.
          if (p.price === 0) {
            summary.failures.push({
              category: cat.name,
              product: p.name,
              reason: "price could not be read — refusing to update to 0",
            });
            continue;
          }

          if (touchedProductIds.has(p.existingProductId!)) {
            summary.failures.push({
              category: cat.name,
              product: p.name,
              reason: "already updated by another row in this import",
            });
            continue;
          }

          try {
            // ProductsService.update already calls findOne(id, tenantId),
            // which enforces tenant ownership and would throw a 404 for a
            // foreign id — that would abort the whole import. Checking
            // ownership AND identity here first turns both into a per-row
            // failure the operator can see, instead of a thrown 404 (or,
            // worse, a silent write to the wrong product) that aborts or
            // corrupts the rest of the import. Identity is re-derived the
            // same way annotateConflicts computed it — folded (category
            // name, product name) — so a row whose name or category was
            // edited in the review grid, or a crafted existingProductId
            // that actually belongs to a different row, no longer
            // silently reprices whatever that id currently points to.
            const owned = await this.prisma.product.findFirst({
              where: { id: p.existingProductId, tenantId },
              select: {
                id: true,
                name: true,
                category: { select: { name: true } },
              },
            });
            if (!owned || !owned.category) {
              summary.failures.push({
                category: cat.name,
                product: p.name,
                reason: "product not found",
              });
              continue;
            }
            const stillMatches =
              foldMenuKey(owned.category.name) === foldMenuKey(cat.name) &&
              foldMenuKey(owned.name) === foldMenuKey(p.name);
            if (!stillMatches) {
              summary.failures.push({
                category: cat.name,
                product: p.name,
                reason: "row no longer matches that product",
              });
              continue;
            }
            await this.products.update(
              p.existingProductId!,
              { price: p.price } as any,
              tenantId,
            );
            touchedProductIds.add(p.existingProductId!);
            summary.productsUpdated++;
          } catch (err: any) {
            summary.failures.push({
              category: cat.name,
              product: p.name,
              reason: err?.message ?? "unknown",
            });
          }
          continue;
        }

        try {
          await this.products.create(
            {
              name: p.name,
              description: p.description,
              price: p.price,
              // Country-scoped default, not a fixed 10 — a UZ tenant's row
              // that omitted taxRate must default to UZ's own 12, not
              // Turkey's 10 (which is not even a valid UZ rate).
              taxRate:
                p.taxRate ??
                resolveCountryProfile(RequestContext.get()?.countryCode)
                  .defaultTaxRate,
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

  /**
   * What commitDraft will do with a single draft row. Shared by the
   * plan-limit pre-check and the commit loop itself so the two can never
   * disagree about which rows actually create a product.
   *
   * `ambiguous` is checked before `existingProductId`: annotateConflicts
   * never emits both together (it strips existingProductId on an
   * ambiguous row), but a crafted body could send both, and an ambiguous
   * row must never be trusted to SKIP/UPDATE_PRICE via a stale id — only
   * an explicit onConflict: "CREATE" overrides it.
   */
  private resolveRowAction(
    p: MenuImportProductDraftDto,
  ): "SKIP" | "UPDATE_PRICE" | "CREATE" | "AMBIGUOUS" {
    if (p.ambiguous) {
      return p.onConflict === "CREATE" ? "CREATE" : "AMBIGUOUS";
    }
    return p.existingProductId ? (p.onConflict ?? "SKIP") : "CREATE";
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
      // The free baseline sets maxProducts/maxCategories to -1, so this is
      // unreachable unless a capability has been suppressed for one tenant.
      // There is no plan to upgrade to; the answer is support, not checkout.
      throw new BadRequestException(
        `This import would exceed the ${resource} limit on your account ` +
          `(${current}/${limit} used, importing ${toCreate}). ` +
          `Remove some items, or contact support — ${resource}s are ` +
          `normally unlimited on the free core.`,
      );
    }
  }
}
