import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { MenuSourceFetcher } from "./menu-source-fetcher.service";
import { MenuImportService } from "./menu-import.service";
import { MenuAiQuotaService } from "./menu-ai-quota.service";
import { sniffSourceKind } from "./menu-source-sniff";
import { chunkMenuText, mergeDrafts } from "./menu-text-chunker";
import {
  guessColumnMap,
  rowsToDraft,
  type ColumnMap,
} from "./menu-tabular-mapper";
import { foldMenuKey } from "./menu-key-fold";
import { CommitMenuImportDto } from "../dto/menu-import.dto";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { EntitlementOfferResolver } from "../../entitlements/entitlement-offer.resolver";
import {
  EntitlementRequiredException,
  OfferSummary,
} from "../../entitlements/entitlement-required.exception";
import { hasFeature } from "../../entitlements/entitlement-engine";
import { PlanFeature } from "../../../common/constants/subscription.enum";

const COLUMN_MAP_PROMPT = `You are mapping a spreadsheet's columns onto a restaurant menu import.

Return ONLY this JSON, using the EXACT header strings from the input:
{ "name": "<header holding the item name>",
  "price": "<header holding the price>",
  "category": "<header holding the section/category, or null>",
  "description": "<header holding the description, or null>",
  "taxRate": "<header holding the KDV/VAT rate, or null>" }

Rules:
- name and price are REQUIRED. If you cannot identify both, return {"name": null, "price": null}.
- Use null, not an empty string, for a column that is not present.
- Return ONLY the JSON object, no prose, no markdown fences.`;

// Sample rows sent to the model for column mapping are capped at 5 rows
// (below), but a single cell can carry a whole paragraph-length
// description. Truncate each cell before joining so a wide sheet with long
// text columns cannot blow the prompt up unboundedly.
const SAMPLE_CELL_MAX_CHARS = 80;

// Identical to what `@RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)`
// resolves to (see requires-feature.decorator.ts) — built the same way so
// the two can never drift.
const AI_FEATURE_KEY = `feature.${PlanFeature.AI_CONTENT_GENERATION}`;

/**
 * Turns "a link or a file" into the same draft the photo importer produces.
 *
 * The routing rule that matters: structured sources (CSV/XLSX) never reach
 * the model row by row. Only the header row plus a few samples go, and only
 * to learn which column is which — the rows themselves are mapped locally.
 * That is both cheaper and more accurate than asking a model to retype
 * several hundred prices.
 *
 * The AI entitlement gate lives HERE, not on the controller route, for the
 * same reason: a recognised-header CSV/XLSX never calls the model, so
 * gating the whole endpoint on `AI_CONTENT_GENERATION` would block a tenant
 * from the same free bulk-entry capability BulkAddModal already gets
 * ungated — just because they used a spreadsheet instead of typing. Only
 * the three paths that actually spend a model call (PDF, HTML/text, and
 * the unrecognised-header column-map fallback) assert it, each before any
 * credit is claimed.
 */
@Injectable()
export class MenuSourceService {
  private readonly logger = new Logger(MenuSourceService.name);

  constructor(
    private readonly fetcher: MenuSourceFetcher,
    private readonly importSvc: MenuImportService,
    private readonly quota: MenuAiQuotaService,
    // Required: the AI gate must never silently fail open — same stance
    // BranchesService takes on its own EntitlementService dependency.
    private readonly entitlements: EntitlementService,
    // Optional — without it the gate still DENIES, it just cannot name the
    // product to buy (see EntitlementGuard's identical comment).
    @Optional() private readonly offers?: EntitlementOfferResolver,
  ) {}

  async parseSource(
    tenantId: string,
    input: {
      url?: string;
      file?: { buffer: Buffer; mimetype: string; originalname: string };
    },
    // Threaded through to the entitlement check the same way
    // EntitlementGuard reads it: `req.scope?.branchId ?? null`. A grant can
    // be branch-scoped (superadmin comp with a branchId — see comp.dto.ts),
    // so hardcoding null here would 403 a tenant the guard-gated photo
    // `parse` endpoint correctly allows at that branch.
    branchId: string | null = null,
  ): Promise<CommitMenuImportDto> {
    if (!input.url && !input.file) {
      throw new BadRequestException("a url or file is required");
    }

    const source = input.file
      ? {
          bytes: input.file.buffer,
          contentType: input.file.mimetype,
          filename: input.file.originalname,
        }
      : await this.fetcher.fetch(input.url!);

    const kind = sniffSourceKind(
      source.bytes,
      source.contentType,
      source.filename,
    );

    switch (kind) {
      case "csv":
        return this.fromRows(tenantId, this.readCsv(source.bytes), branchId);
      case "xlsx":
        return this.fromRows(
          tenantId,
          await this.readXlsx(source.bytes),
          branchId,
        );
      case "pdf":
        await this.assertAiEntitlement(tenantId, branchId);
        return this.metered(tenantId, 1, () =>
          this.importSvc.parseDocumentToDraft(source.bytes, "application/pdf"),
        );
      case "html":
      default:
        return this.fromText(
          tenantId,
          htmlToText(source.bytes.toString("utf8")),
          branchId,
        );
    }
  }

  /** Long text → chunked model calls → merged draft. One unit per chunk. */
  private async fromText(
    tenantId: string,
    text: string,
    branchId: string | null,
  ): Promise<CommitMenuImportDto> {
    await this.assertAiEntitlement(tenantId, branchId);
    if (!text.trim()) {
      throw new BadRequestException("nothing readable at that link");
    }
    let chunks: string[];
    try {
      chunks = chunkMenuText(text);
    } catch {
      throw new BadRequestException(
        "that source is too long to import in one go — try a single menu page",
      );
    }
    return this.metered(tenantId, chunks.length, async () => {
      const drafts: CommitMenuImportDto[] = [];
      for (const chunk of chunks) {
        drafts.push(await this.importSvc.parseTextToDraft(chunk));
      }
      return mergeDrafts(drafts);
    });
  }

  /** Header + rows → column map (local, or one small model call) → draft. */
  private async fromRows(
    tenantId: string,
    table: string[][],
    branchId: string | null,
  ): Promise<CommitMenuImportDto> {
    if (table.length < 2) {
      throw new BadRequestException("that file has no data rows");
    }
    const [headers, ...rows] = table;

    const localMap = guessColumnMap(headers);
    if (localMap) {
      return this.draftFromRows(headers, rows, localMap);
    }

    // Headers we do not recognise — spend exactly one unit asking which
    // column is which, then map every row locally. Everything that could
    // make the answer worthless — a header name the model invented that
    // does not actually exist in this sheet, or a mapping that ends up
    // matching zero rows — is validated INSIDE metered(), so a bad answer
    // refunds the claim instead of silently billing for an empty draft.
    await this.assertAiEntitlement(tenantId, branchId);
    return this.metered(tenantId, 1, async () => {
      const sample = [headers, ...rows.slice(0, 5)]
        .map((r) => r.map(truncateForSample).join(" | "))
        .join("\n");
      const answer = await this.importSvc.parseColumnMap(
        sample,
        COLUMN_MAP_PROMPT,
      );
      const map = this.resolveColumnMap(answer, headers);
      return this.draftFromRows(headers, rows, map);
    });
  }

  /**
   * Match the model's answer back onto the sheet's REAL header strings. A
   * model echoing "Ürün Adı" back as "ürün adı" or "Urun Adi" (case and
   * diacritic drift) is normal — fold both sides with foldMenuKey so that
   * still resolves. A name the model names that is not actually one of the
   * headers must not be trusted at face value: rowsToDraft's `idx()` would
   * silently return -1 for it, and every row would come back skipped —
   * an empty draft the operator still paid for.
   */
  private resolveColumnMap(
    answer: Record<string, string | null> | undefined,
    headers: string[],
  ): ColumnMap {
    const byFold = new Map(headers.map((h) => [foldMenuKey(h), h]));
    const resolve = (v?: string | null): string | undefined =>
      v ? byFold.get(foldMenuKey(v)) : undefined;

    const name = resolve(answer?.name);
    const price = resolve(answer?.price);
    if (!name || !price) {
      throw new BadRequestException(
        "could not tell which columns hold the item name and price",
      );
    }
    return {
      name,
      price,
      category: resolve(answer?.category),
      description: resolve(answer?.description),
      taxRate: resolve(answer?.taxRate),
    };
  }

  /**
   * Map every row locally and refuse a result with no products, rather than
   * resolving a silently-empty draft — on the metered path that emptiness
   * is exactly what must trigger a refund, not a "successful" 0-item import.
   */
  private draftFromRows(
    headers: string[],
    rows: string[][],
    map: ColumnMap,
  ): CommitMenuImportDto {
    const draft = rowsToDraft(headers, rows, map);
    const productCount = draft.categories.reduce(
      (n, c) => n + c.products.length,
      0,
    );
    if (!productCount) {
      throw new BadRequestException(
        "could not match any rows to the identified name/price columns",
      );
    }
    return draft;
  }

  /** csvToRows, translating a raw csv-parse error into an actionable 400. */
  private readCsv(bytes: Buffer): string[][] {
    try {
      return csvToRows(bytes);
    } catch (err: any) {
      this.logger.warn(`menu source CSV parse failed: ${err?.message ?? err}`);
      throw new BadRequestException(
        "that CSV could not be read — check for an unmatched quote",
      );
    }
  }

  /** xlsxToRows, translating a raw exceljs error into an actionable 400. */
  private async readXlsx(bytes: Buffer): Promise<string[][]> {
    try {
      return await xlsxToRows(bytes);
    } catch (err: any) {
      this.logger.warn(`menu source XLSX parse failed: ${err?.message ?? err}`);
      throw new BadRequestException(
        "that spreadsheet could not be read — it may be corrupted or not a real .xlsx file",
      );
    }
  }

  /**
   * Same 403 shape `EntitlementGuard` builds for `@RequiresFeature` — a
   * hand-rolled duplicate rather than a shared call, matching the existing
   * precedent (BranchesService.create's branch-cap check) for asserting an
   * entitlement from inside a service instead of a route guard. Kept in
   * lock-step with the guard's `deny()`: same offer-resolution best-effort
   * (never let a catalog hiccup turn a clean 403 into a 500), same
   * license-vs-product distinction, and — like the guard reading
   * `req.scope?.branchId ?? null` — the SAME branch scope the caller
   * resolved. A grant can be branch-scoped (superadmin comp accepts a
   * branchId), so a hardcoded `null` here would 403 a tenant at a branch
   * the decorator-gated photo `parse` endpoint correctly allows.
   */
  private async assertAiEntitlement(
    tenantId: string,
    branchId: string | null,
  ): Promise<void> {
    const set = await this.entitlements.getForTenant(tenantId, branchId);
    if (hasFeature(set, AI_FEATURE_KEY)) return;

    const licensed = set.features?.["feature.license"] === true;
    let offer: OfferSummary | null = null;
    let reason: "not_owned" | "lapsed" = "not_owned";
    try {
      offer = (await this.offers?.forKey(tenantId, AI_FEATURE_KEY)) ?? null;
      if (!licensed && offer?.kind !== "license") {
        offer = (await this.offers?.licenceOffer(tenantId)) ?? offer;
      }
      reason = (await this.offers?.reasonFor(tenantId, offer)) ?? "not_owned";
    } catch {
      // Never let offer resolution turn a clean 403 into a 500.
    }
    throw new EntitlementRequiredException({
      requirement: { type: "feature", key: AI_FEATURE_KEY },
      offer,
      licenseRequired: !licensed,
      reason,
    });
  }

  /**
   * Claim up front, refund the whole claim on any failure. The operator got
   * nothing, so they pay nothing — same contract parseMenuPhotos honours.
   */
  private async metered<T>(
    tenantId: string,
    units: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const usageId = await this.quota.claim(tenantId, "PHOTO", units);
    await this.quota
      .attachJob(usageId, `menu-source:${usageId}`)
      .catch(() => undefined);
    try {
      return await fn();
    } catch (err) {
      await this.quota.voidUsage(usageId).catch(() => undefined);
      throw err;
    }
  }
}

function truncateForSample(cell: string): string {
  return cell.length > SAMPLE_CELL_MAX_CHARS
    ? `${cell.slice(0, SAMPLE_CELL_MAX_CHARS)}…`
    : cell;
}

/** Reduce an HTML document to the text a human would read off the page. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

const DELIMITER_CANDIDATES = [";", ",", "\t"] as const;

/**
 * csv-parse's `delimiter` option accepts an array, but that does NOT mean
 * "try each one and see" — it means "treat every one of these as a
 * delimiter, simultaneously". A semicolon-delimited Turkish export whose
 * prices use a decimal comma ("180,50") then gets shredded on both
 * characters at once: "Fiyat" turns into two fields, "180" and "50", and
 * every field after it shifts — which is exactly the shape Excel writes
 * under a Turkish locale, not a rare edge case for this product.
 *
 * So the delimiter is sniffed from the header line ourselves — whichever
 * of `;`, `,`, `\t` appears most often outside quotes — and only that one
 * character is handed to csv-parse.
 */
export function sniffCsvDelimiter(headerLine: string): string {
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      if (inQuotes && headerLine[i + 1] === '"') {
        i++; // escaped "" inside a quoted field — not a close-quote
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best: string = ",";
  let bestCount = 0;
  for (const c of DELIMITER_CANDIDATES) {
    if (counts[c] > bestCount) {
      bestCount = counts[c];
      best = c;
    }
  }
  return best; // "," when every candidate's count is zero (single column).
}

/**
 * The first line of the file, unless it's blank — a real export can carry
 * one or more leading blank lines before the actual header row, and
 * sniffing an empty string always falls back to "," (the single-column
 * fallback), which would silently reproduce the original bug on exactly
 * the semicolon files this function exists to fix.
 */
function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim().length > 0) return line;
  }
  return "";
}

export function csvToRows(bytes: Buffer): string[][] {
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  const delimiter = sniffCsvDelimiter(firstNonEmptyLine(text));
  return parseCsv(text, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
}

export async function xlsxToRows(bytes: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as any);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    // exceljs pads index 0 and hands back a SPARSE array: a blank spacer
    // column is a genuine hole, not a defined `undefined`. `.map()` and
    // `.filter()` silently skip holes (so a `v == null` guard never even
    // runs on them), which both drops the column and can leave `undefined`
    // reaching code downstream that assumes a string. Walk it by index
    // instead so every column position — hole or not — becomes an
    // explicit, defined "" .
    const cells: string[] = [];
    for (let i = 1; i < values.length; i++) {
      cells.push(cellValueToString(values[i]));
    }
    out.push(cells);
  });
  return out;
}

/**
 * exceljs hands back the RAW stored shape of a cell, not a display string.
 * Plain numbers and strings come through as-is, but:
 *   - a partially-formatted cell is `{ richText: [{ text, font }, ...] }`
 *   - a formula is `{ formula, result }`, and `result` itself can be an
 *     error object `{ error: "#DIV/0!" }` instead of a value
 *   - a hyperlink is `{ text, hyperlink }`
 *   - a date is a `Date` instance
 * `String(cell)` on any of the object shapes above yields the useless
 * `"[object Object]"` — which a price column then reads as 0 (a free
 * product, via parsePrice's `[^\d.,-]` strip) and a name column imports
 * literally.
 */
function cellValueToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text?: unknown }[])
        .map((run) => (run?.text == null ? "" : String(run.text)))
        .join("");
    }
    if ("result" in obj) {
      const result = obj.result;
      const isError =
        result != null &&
        typeof result === "object" &&
        "error" in (result as Record<string, unknown>);
      return isError ? "" : cellValueToString(result);
    }
    if ("text" in obj) return String((obj as any).text ?? "");
    return "";
  }
  return String(v);
}
