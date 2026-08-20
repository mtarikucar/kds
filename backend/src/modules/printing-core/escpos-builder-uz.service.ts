import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import * as iconv from "iconv-lite";
import type {
  ReceiptSnapshotV1,
  KitchenTicketSnapshotV1,
} from "../orders/services/receipt-snapshot.builder";
import {
  EscPosArtifact,
  EscPosBuilder,
  EscPosCommandPayload,
  EscPosDrawerCommand,
  EscPosJob,
  EscPosPrintCommand,
  EscPosReceiptOptions,
} from "./escpos.types";
import { EscPosBuilderRegistry } from "./escpos-builder.registry";
import {
  formatMoneyNumber,
  asciiCurrencySuffix,
} from "../../common/country/money-format";

// ──────────────────────────────────────────────────────────────────────────
// UZ ESC/POS byte builder (Task 13). Registers as "escpos-uz" — a SEPARATE
// dialect from the shared "escpos-tr" builder (escpos-builder.service.ts),
// which every UZ tenant used before this task. That builder's CP857
// (Turkish) codepage cannot represent Cyrillic AT ALL: any character it
// doesn't recognise degrades to a literal '?', so a Cyrillic product name —
// entirely plausible on a Tashkent receipt, given Uzbekistan's substantial
// Russian-speaking population — printed as a row of question marks.
//
// CODEPAGE DECISION — CP866 over CP1251, and why:
//
// The two usual ESC/POS Cyrillic candidates are CP866 (DOS Cyrillic #2) and
// CP1251 (Windows Cyrillic). Both cover the same character repertoire (the
// standard Russian alphabet, which is what Uzbek Cyrillic also uses for its
// shared letters). The difference that matters here is which numeric value
// `ESC t n` needs to SELECT the table on real hardware — and that number is
// NOT standardised across ESC/POS printer vendors (verified by cross-
// checking multiple sources rather than assumed): the official Star
// Micronics ESC/POS Command Specification (rev 2.52) lists CP866 at n=17 in
// BOTH of its documented `ESC t n` tables ("Spec A" and "Spec B"), the same
// n=17 commonly cited for Epson-compatible firmware — but CP1251's value
// varies BY VENDOR (34 in that same Star spec; other vendor docs list 46 or
// 23 for the same "WPC1251" table). Printing on a codepage the firmware
// doesn't actually have at that address doesn't fail loudly — it silently
// selects whatever page 17/34/46/23 happens to mean on THAT printer,
// printing garbage. Given "a wrong byte here prints garbage on real paper"
// and no physical UZ hardware available to verify against, CP866's n=17 is
// the one value with cross-vendor agreement, so it is the responsible
// choice. (This mirrors the existing TR builder's own `ESC t 19` for
// CP857 — also unverified against physical hardware, also left untouched
// by this task; see that file's CMD_CODEPAGE_CP857 comment. If it later
// turns out the specific printer models this fleet uses number CP866
// differently, only THIS builder's `CMD_CODEPAGE_CP866` constant needs to
// change — the dialect-per-id structure this and the TR builder share is
// exactly what makes that a one-line fix instead of a redesign.)
//
// SCOPE — Uzbek Latin covered, receipt LABELS transliterated, not
// translated:
//
// Uzbek Latin's only non-ASCII characters are the oʻ/gʻ modifier-apostrophe
// letters (U+02BB/U+02BC, sometimes typed as a curly quote) — neither CP866
// nor CP1251 can represent them (they're Latin Extended, not Cyrillic), so
// `enc()` below normalises them to a plain ASCII apostrophe before encoding
// rather than let them degrade to '?'. This task's scope (per its brief) is
// codepage + timestamp + money — NOT localising the receipt's fixed field
// labels ("Ödeme", "Fiş No", …) into Uzbek/Russian. Those labels are still
// Turkish WORDS here, but spelled WITHOUT their Turkish diacritics (ş/ğ/ı/
// ö/ü/ç all have CP857 codepoints but NONE of them exist in CP866 — the
// same single-byte-table ceiling that rules out combining "Turkish labels"
// and "Cyrillic product data" on one printer codepage at all), so they
// survive CP866 intact instead of turning "Fiş No" into "Fi?No". Full
// label localisation is future work; this keeps every character on the
// page — labels, Latin product names, and Cyrillic product names alike —
// printable today.
// ──────────────────────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD_INIT = [ESC, 0x40] as const;

/** ESC t n — select character code table. n=17 → PC866 (Cyrillic #2). See
 * the class doc comment above for why 17/CP866 rather than CP1251. */
const CMD_CODEPAGE_CP866 = [ESC, 0x74, 17] as const;

const alignLeft = () => [ESC, 0x61, 0];
const alignCenter = () => [ESC, 0x61, 1];
const boldOn = () => [ESC, 0x45, 1];
const boldOff = () => [ESC, 0x45, 0];
const sizeNormal = () => [GS, 0x21, 0x00];
const sizeDoubleHeight = () => [GS, 0x21, 0x01];
const sizeDoubleBoth = () => [GS, 0x21, 0x11];
const cutPaper = () => [GS, 0x56, 66, 0x00];
const drawerKickBytes = (pin: 0 | 1) => [ESC, 0x70, pin, 25, 250];

/**
 * Uzbek Latin's modifier-apostrophe letters (oʻ / gʻ) have no CP866
 * codepoint. Normalising them to a plain ASCII apostrophe first means
 * "o'sha"/"g'alati" print readably instead of degrading to "o?sha"/
 * "g?alati" — cheap, deterministic, and doesn't require inventing a byte
 * mapping the printer firmware doesn't have.
 */
const UZ_APOSTROPHE_NORMALIZE: Record<string, string> = {
  ʻ: "'", // ʻ MODIFIER LETTER TURNED COMMA — the standard oʻ/gʻ glyph
  ʼ: "'", // ʼ MODIFIER LETTER APOSTROPHE — a common alternate
  "‘": "'", // ' LEFT SINGLE QUOTATION MARK — common substitute in typed text
  "’": "'", // ' RIGHT SINGLE QUOTATION MARK — common substitute
};

@Injectable()
export class EscPosBuilderUzService implements EscPosBuilder, OnModuleInit {
  readonly id = "escpos-uz";
  private readonly logger = new Logger(EscPosBuilderUzService.name);

  constructor(private readonly registry: EscPosBuilderRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // ── Public builder API ────────────────────────────────────────────────

  buildReceipt(
    snapshot: ReceiptSnapshotV1,
    options: EscPosReceiptOptions = {},
  ): EscPosJob {
    const cols = this.columns(options);
    const intlLocale = options.intlLocale ?? "uz-UZ";
    const displayDecimals = options.displayDecimals ?? 0;
    const timezone = options.timezone ?? "Asia/Tashkent";
    const b = new ByteWriter();
    this.preamble(b);

    b.push(alignCenter(), boldOn(), sizeDoubleBoth());
    b.line(this.enc(snapshot.restaurant.name), cols);
    b.push(sizeNormal(), boldOff());
    b.line(this.enc("ADISYON / FIS"), cols);
    b.push(alignLeft());
    this.rule(b, cols);

    b.line(this.enc(`Fis No : ${snapshot.order.orderNumber}`), cols);
    b.line(this.enc(`Tur    : ${this.orderType(snapshot.order.type)}`), cols);
    if (snapshot.order.tableNumber) {
      b.line(this.enc(`Masa   : ${snapshot.order.tableNumber}`), cols);
    }
    b.line(
      this.enc(
        `Tarih  : ${this.formatDateTime(snapshot.printedAt, intlLocale, timezone)}`,
      ),
      cols,
    );
    this.rule(b, cols);

    for (const item of snapshot.items) {
      const left = `${item.quantity} x ${item.name}`;
      const right = this.money(
        item.totalPrice,
        snapshot.restaurant.currency,
        intlLocale,
        displayDecimals,
      );
      b.line(this.encTwoCol(left, right, cols), cols);
      for (const mod of item.modifiers) {
        b.line(this.enc(`   + ${mod}`), cols);
      }
      if (item.notes) {
        b.line(this.enc(`   not: ${item.notes}`), cols);
      }
    }
    this.rule(b, cols);

    const cur = snapshot.restaurant.currency;
    const money = (amount: string) =>
      this.money(amount, cur, intlLocale, displayDecimals);
    b.line(
      this.encTwoCol("Ara Toplam", money(snapshot.totals.subtotal), cols),
      cols,
    );
    if (this.nonZero(snapshot.totals.discount)) {
      b.line(
        this.encTwoCol("Indirim", `-${money(snapshot.totals.discount)}`, cols),
        cols,
      );
    }
    b.line(this.encTwoCol("KDV", money(snapshot.totals.tax), cols), cols);
    b.push(boldOn(), sizeDoubleHeight());
    b.line(
      this.encTwoCol(
        "TOPLAM",
        money(snapshot.totals.total),
        this.doubleWidthCols(cols),
      ),
      cols,
    );
    b.push(sizeNormal(), boldOff());
    this.rule(b, cols);

    b.line(
      this.enc(`Odeme  : ${this.payMethod(snapshot.payment.method)}`),
      cols,
    );
    if (snapshot.payment.transactionId) {
      b.line(this.enc(`Islem  : ${snapshot.payment.transactionId}`), cols);
    }

    this.footer(b, cols, options);
    if (options.kickDrawerAfter) b.push(drawerKickBytes(0));
    this.finish(b, options);

    return this.job("receipt", b);
  }

  buildKitchenTicket(
    snapshot: KitchenTicketSnapshotV1,
    options: EscPosReceiptOptions = {},
  ): EscPosJob {
    const cols = this.columns(options);
    const intlLocale = options.intlLocale ?? "uz-UZ";
    const timezone = options.timezone ?? "Asia/Tashkent";
    const b = new ByteWriter();
    this.preamble(b);

    b.push(alignCenter(), boldOn(), sizeDoubleBoth());
    b.line(this.enc("MUTFAK"), cols);
    b.push(sizeNormal());
    b.line(this.enc(`#${snapshot.order.orderNumber}`), cols);
    b.push(boldOff(), alignLeft());

    b.line(this.enc(`Tur  : ${this.orderType(snapshot.order.type)}`), cols);
    if (snapshot.order.tableNumber) {
      b.push(boldOn());
      b.line(this.enc(`MASA : ${snapshot.order.tableNumber}`), cols);
      b.push(boldOff());
    }
    b.line(
      this.enc(this.formatDateTime(snapshot.createdAt, intlLocale, timezone)),
      cols,
    );
    this.rule(b, cols);

    for (const item of snapshot.items) {
      b.push(boldOn(), sizeDoubleHeight());
      b.line(this.enc(`${item.quantity} x ${item.name}`), cols);
      b.push(sizeNormal(), boldOff());
      for (const mod of item.modifiers) {
        b.line(this.enc(`   + ${mod}`), cols);
      }
      if (item.notes) {
        b.push(boldOn());
        b.line(this.enc(`   >> ${item.notes}`), cols);
        b.push(boldOff());
      }
    }

    if (snapshot.specialInstructions) {
      this.rule(b, cols);
      b.push(boldOn());
      b.line(this.enc(`NOT: ${snapshot.specialInstructions}`), cols);
      b.push(boldOff());
    }

    this.finish(b, options);
    return this.job("kitchen_ticket", b);
  }

  drawerKick(pin: 0 | 1 = 0): EscPosJob {
    const b = new ByteWriter();
    b.push(drawerKickBytes(pin));
    return this.job("drawer_kick", b);
  }

  // ── Command-payload wrappers ──────────────────────────────────────────

  toPrintCommand(job: EscPosJob): EscPosPrintCommand {
    return { kind: "print_receipt", payload: this.payload(job) };
  }

  toDrawerCommand(job: EscPosJob, pin: 0 | 1 = 0): EscPosDrawerCommand {
    return {
      kind: "open_drawer",
      payload: { ...this.payload(job), pin },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private payload(job: EscPosJob): EscPosCommandPayload {
    return {
      data: job.base64,
      codepage: job.codepage,
      artifact: job.artifact,
      contentHash: createHash("sha256")
        .update(Buffer.from(job.bytes))
        .digest("hex"),
    };
  }

  private job(artifact: EscPosArtifact, b: ByteWriter): EscPosJob {
    const bytes = b.toBytes();
    const buf = Buffer.from(bytes);
    return {
      artifact,
      codepage: "CP866",
      bytes,
      base64: buf.toString("base64"),
      byteLength: bytes.length,
    };
  }

  private preamble(b: ByteWriter): void {
    b.push(CMD_INIT, CMD_CODEPAGE_CP866);
  }

  private finish(b: ByteWriter, options: EscPosReceiptOptions): void {
    b.push([LF, LF, LF]);
    if (options.qr) this.qr(b, options.qr.data, options.qr.size ?? 6);
    if (options.cut !== false) b.push(cutPaper());
  }

  private footer(
    b: ByteWriter,
    cols: number,
    options: EscPosReceiptOptions,
  ): void {
    const lines = options.footerLines ?? ["Tashrifingiz uchun", "rahmat."];
    if (lines.length === 0) return;
    this.rule(b, cols);
    b.push(alignCenter());
    for (const l of lines) b.line(this.enc(l), cols);
    b.push(alignLeft());
  }

  private qr(b: ByteWriter, data: string, size: number): void {
    const bytes = Array.from(Buffer.from(data, "utf8"));
    if (bytes.length > 0xfffc) {
      throw new Error(
        `QR payload too large: ${bytes.length} bytes (max ${0xfffc})`,
      );
    }
    const len = bytes.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;
    b.push(alignCenter());
    b.push([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    b.push([
      GS,
      0x28,
      0x6b,
      0x03,
      0x00,
      0x31,
      0x43,
      Math.min(Math.max(size, 1), 16),
    ]);
    b.push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    b.push([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30], bytes);
    b.push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    b.push(alignLeft());
  }

  private rule(b: ByteWriter, cols: number): void {
    b.line(this.enc("-".repeat(cols)), cols);
  }

  // ── Formatting helpers ────────────────────────────────────────────────

  private columns(options: EscPosReceiptOptions): number {
    return options.paperWidth === "58mm" ? 32 : 42;
  }

  private doubleWidthCols(cols: number): number {
    return Math.floor(cols / 2);
  }

  private orderType(type: string): string {
    const map: Record<string, string> = {
      DINE_IN: "Masada",
      TAKEAWAY: "Paket",
      DELIVERY: "Teslimat",
    };
    return map[type] ?? type;
  }

  private payMethod(method: string): string {
    const map: Record<string, string> = {
      CASH: "Nakit",
      CARD: "Kart",
      QR: "QR",
      VOUCHER: "Kupon",
      TICKET: "Yemek Karti",
    };
    return map[method?.toUpperCase()] ?? method;
  }

  private nonZero(amount: string): boolean {
    return Number.parseFloat(amount) !== 0;
  }

  /**
   * Same shared server-side money formatter the TR builder uses
   * (common/country/money-format.ts) — grouping and decimal-place count
   * come from `intlLocale`/`displayDecimals` (this dialect defaults to
   * "uz-UZ"/0, so'm is quoted whole), never hardcoded. The suffix is the
   * currency's own ASCII-safe ISO code (`asciiCurrencySuffix` — "TL" only
   * for TRY, "UZS" here) rather than a Unicode glyph CP866 can't encode.
   */
  private money(
    amount: string,
    currency: string,
    intlLocale: string,
    displayDecimals: number,
  ): string {
    const grouped = formatMoneyNumber(amount, { intlLocale, displayDecimals });
    return `${grouped} ${asciiCurrencySuffix(currency)}`;
  }

  private formatDateTime(
    iso: string,
    intlLocale: string,
    timezone: string,
  ): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(d);
  }

  private encTwoCol(left: string, right: string, cols: number): Uint8Array {
    const pad = cols - right.length - left.length;
    let text: string;
    if (pad >= 1) {
      text = left + " ".repeat(pad) + right;
    } else {
      const room = Math.max(0, cols - right.length - 1);
      text = left.slice(0, room) + " " + right;
    }
    return this.enc(text);
  }

  /**
   * Encode a JS string to CP866 bytes via iconv-lite (a battle-tested,
   * third-party-verified codepage table — see the class doc comment for
   * why this task uses a library table here rather than hand-transcribing
   * one: a hand-typed 256-entry table is exactly the kind of "wrong byte
   * that prints garbage on real paper" this task warns against). Uzbek
   * Latin's modifier-apostrophe letters are normalised to a plain ASCII
   * apostrophe first (see UZ_APOSTROPHE_NORMALIZE); anything iconv-lite
   * still can't map degrades to '?' — the SAME single-byte-table fallback
   * the TR builder uses, so the "1 char in the decoded string = 1 column"
   * invariant `encTwoCol` relies on holds here too.
   */
  private enc(text: string): Uint8Array {
    let normalized = text;
    for (const [from, to] of Object.entries(UZ_APOSTROPHE_NORMALIZE)) {
      if (normalized.includes(from)) {
        normalized = normalized.split(from).join(to);
      }
    }
    return iconv.encode(normalized, "cp866");
  }
}

/** Identical tiny append-only byte buffer to the TR builder's — see that
 * file's ByteWriter doc comment. Kept as a separate copy rather than a
 * shared import so this dialect's file has zero coupling to the TR
 * builder's internals (the byte-identical TR regression pin stays trivially
 * safe: nothing here can perturb that file). */
class ByteWriter {
  private readonly chunks: number[] = [];

  push(...parts: Array<ArrayLike<number>>): void {
    for (const p of parts) {
      for (let i = 0; i < p.length; i++) this.chunks.push(p[i]);
    }
  }

  line(encoded: Uint8Array, cols?: number): void {
    const run =
      cols != null && encoded.length > cols
        ? encoded.subarray(0, cols)
        : encoded;
    for (let i = 0; i < run.length; i++) this.chunks.push(run[i]);
    this.chunks.push(LF);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
