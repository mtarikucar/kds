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
        return this.fromRows(tenantId, csvToRows(source.bytes));
      case "xlsx":
        return this.fromRows(tenantId, await xlsxToRows(source.bytes));
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

    let map = guessColumnMap(headers);
    if (!map) {
      // Headers we do not recognise — spend exactly one unit asking which
      // column is which, then map every row locally.
      map = await this.metered(tenantId, 1, async () => {
        const sample = [headers, ...rows.slice(0, 5)]
          .map((r) => r.join(" | "))
          .join("\n");
        const answer = await this.importSvc.parseColumnMap(
          sample,
          COLUMN_MAP_PROMPT,
        );
        if (!answer?.name || !answer?.price) {
          throw new BadRequestException(
            "could not tell which columns hold the item name and price",
          );
        }
        const resolved: ColumnMap = {
          name: answer.name,
          price: answer.price,
          category: answer.category ?? undefined,
          description: answer.description ?? undefined,
          taxRate: answer.taxRate ?? undefined,
        };
        return resolved;
      });
    }
    return rowsToDraft(headers, rows, map);
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
    const values = row.values as any[];
    // exceljs pads index 0; drop it and stringify each cell.
    out.push(
      values
        .slice(1)
        .map((v) => (v == null ? "" : String(v?.text ?? v?.result ?? v))),
    );
  });
  return out;
}
