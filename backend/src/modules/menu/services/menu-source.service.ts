import { BadRequestException, Injectable, Logger } from "@nestjs/common";
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

/**
 * Turns "a link or a file" into the same draft the photo importer produces.
 *
 * The routing rule that matters: structured sources (CSV/XLSX) never reach
 * the model row by row. Only the header row plus a few samples go, and only
 * to learn which column is which — the rows themselves are mapped locally.
 * That is both cheaper and more accurate than asking a model to retype
 * several hundred prices.
 */
@Injectable()
export class MenuSourceService {
  private readonly logger = new Logger(MenuSourceService.name);

  constructor(
    private readonly fetcher: MenuSourceFetcher,
    private readonly importSvc: MenuImportService,
    private readonly quota: MenuAiQuotaService,
  ) {}

  async parseSource(
    tenantId: string,
    input: {
      url?: string;
      file?: { buffer: Buffer; mimetype: string; originalname: string };
    },
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
        return this.fromRows(tenantId, this.readCsv(source.bytes));
      case "xlsx":
        return this.fromRows(tenantId, await this.readXlsx(source.bytes));
      case "pdf":
        return this.metered(tenantId, 1, () =>
          this.importSvc.parseDocumentToDraft(source.bytes, "application/pdf"),
        );
      case "html":
      default:
        return this.fromText(
          tenantId,
          htmlToText(source.bytes.toString("utf8")),
        );
    }
  }

  /** Long text → chunked model calls → merged draft. One unit per chunk. */
  private async fromText(
    tenantId: string,
    text: string,
  ): Promise<CommitMenuImportDto> {
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

export function csvToRows(bytes: Buffer): string[][] {
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  // Let csv-parse work out , vs ; vs tab — Turkish exports use ; routinely.
  return parseCsv(text, {
    delimiter: [",", ";", "\t"],
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
