import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  ReceiptSnapshotV1,
  KitchenTicketSnapshotV1,
} from "../../orders/services/receipt-snapshot.builder";
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

// ──────────────────────────────────────────────────────────────────────────
// ESC/POS control codes (Epson TM-T spec; the de-facto standard every cheap
// 80mm Chinese head clones). Named constants rather than magic bytes so the
// command stream reads like the spec.
// ──────────────────────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC @  — initialise printer (clears mode, codepage, justification). */
const CMD_INIT = [ESC, 0x40] as const;

/** ESC t n — select character code table. n=19 → PC857 (Turkish). */
const CMD_CODEPAGE_CP857 = [ESC, 0x74, 19] as const;

/** ESC a n — justification. 0=left 1=center (2=right unused: prices are
 * flush-right via space-padding inside the left-justified column instead). */
const alignLeft = () => [ESC, 0x61, 0];
const alignCenter = () => [ESC, 0x61, 1];

/** ESC E n — emphasised (bold) on/off. */
const boldOn = () => [ESC, 0x45, 1];
const boldOff = () => [ESC, 0x45, 0];

/** GS ! n — character size. low-nibble=height multiplier, high-nibble=width. */
const sizeNormal = () => [GS, 0x21, 0x00];
const sizeDoubleHeight = () => [GS, 0x21, 0x01];
const sizeDoubleBoth = () => [GS, 0x21, 0x11];

/** GS V m — paper cut. m=66 (full cut after feed) via the function-B form. */
const cutPaper = () => [GS, 0x56, 66, 0x00];

/**
 * ESC p m t1 t2 — generate drawer-kick pulse on connector pin `m`
 * (0 → pin 2, 1 → pin 5). t1/t2 = on/off pulse widths × 2 ms. 50/250 ms is the
 * standard cash-drawer solenoid pulse.
 */
const drawerKickBytes = (pin: 0 | 1) => [ESC, 0x70, pin, 25, 250];

// ──────────────────────────────────────────────────────────────────────────
// CP857 (PC857, "Multilingual Latin V" — Turkish) high-half encoding table.
// The low half (0x00–0x7F) is plain ASCII. We only need the mapping for the
// Turkish letters a Turkish fiş actually contains; everything else falls
// through to a "?" so the byte stream never carries an un-encodable char that
// would desync the printer's column counter.
// ──────────────────────────────────────────────────────────────────────────
const CP857: Record<string, number> = {
  // Uppercase
  Ç: 0x80,
  Ü: 0x9a,
  É: 0x90,
  Ä: 0x8e,
  Ö: 0x99,
  Ğ: 0xa6,
  İ: 0x98, // dotted capital I (CP857 maps Ÿ slot to İ)
  Ş: 0x9e,
  // Lowercase
  ç: 0x87,
  ü: 0x81,
  é: 0x82,
  ö: 0x94,
  ı: 0x8d, // dotless lowercase i
  ğ: 0xa7,
  ş: 0x9f,
  â: 0x83,
  î: 0x8c,
  û: 0x96,
  // Currency / symbols
  "£": 0x9c,
  "₺": 0x54, // no native TRY glyph in CP857 → fall back to ASCII 'T' is wrong;
  // we instead emit the literal "TL" string upstream (see money()), so this
  // entry is only a defensive last resort and intentionally maps to 'T'.
};

@Injectable()
export class EscPosBuilderService implements EscPosBuilder, OnModuleInit {
  readonly id = "escpos-tr";
  private readonly logger = new Logger(EscPosBuilderService.name);

  constructor(private readonly registry: EscPosBuilderRegistry) {}

  onModuleInit(): void {
    // Mirror the fiscal adapter: self-register so callers resolve by dialect
    // id. Unlike the sandbox fiscal provider this is a pure, side-effect-free
    // byte builder, so it registers in every environment (incl. production).
    this.registry.register(this);
  }

  // ── Public builder API ────────────────────────────────────────────────

  buildReceipt(
    snapshot: ReceiptSnapshotV1,
    options: EscPosReceiptOptions = {},
  ): EscPosJob {
    const cols = this.columns(options);
    const b = new ByteWriter();
    this.preamble(b);

    // Header — restaurant name, big + centered + bold.
    b.push(alignCenter(), boldOn(), sizeDoubleBoth());
    b.line(this.enc(snapshot.restaurant.name), cols);
    b.push(sizeNormal(), boldOff());
    b.line(this.enc("ADİSYON / FİŞ"), cols);
    b.push(alignLeft());
    this.rule(b, cols);

    // Order meta.
    b.line(this.enc(`Fiş No : ${snapshot.order.orderNumber}`), cols);
    b.line(this.enc(`Tür    : ${this.orderType(snapshot.order.type)}`), cols);
    if (snapshot.order.tableNumber) {
      b.line(this.enc(`Masa   : ${snapshot.order.tableNumber}`), cols);
    }
    b.line(this.enc(`Tarih  : ${this.trDateTime(snapshot.printedAt)}`), cols);
    this.rule(b, cols);

    // Items — "qty x name" left, line total right.
    for (const item of snapshot.items) {
      const left = `${item.quantity} x ${item.name}`;
      const right = this.money(item.totalPrice, snapshot.restaurant.currency);
      b.line(this.encTwoCol(left, right, cols), cols);
      for (const mod of item.modifiers) {
        b.line(this.enc(`   + ${mod}`), cols);
      }
      if (item.notes) {
        b.line(this.enc(`   not: ${item.notes}`), cols);
      }
    }
    this.rule(b, cols);

    // Totals + KDV breakdown.
    const cur = snapshot.restaurant.currency;
    b.line(
      this.encTwoCol(
        "Ara Toplam",
        this.money(snapshot.totals.subtotal, cur),
        cols,
      ),
      cols,
    );
    if (this.nonZero(snapshot.totals.discount)) {
      b.line(
        this.encTwoCol(
          "İndirim",
          `-${this.money(snapshot.totals.discount, cur)}`,
          cols,
        ),
        cols,
      );
    }
    b.line(
      this.encTwoCol("KDV", this.money(snapshot.totals.tax, cur), cols),
      cols,
    );
    b.push(boldOn(), sizeDoubleHeight());
    b.line(
      this.encTwoCol(
        "TOPLAM",
        this.money(snapshot.totals.total, cur),
        this.doubleWidthCols(cols),
      ),
      cols,
    );
    b.push(sizeNormal(), boldOff());
    this.rule(b, cols);

    // Payment.
    b.line(
      this.enc(`Ödeme  : ${this.payMethod(snapshot.payment.method)}`),
      cols,
    );
    if (snapshot.payment.transactionId) {
      b.line(this.enc(`İşlem  : ${snapshot.payment.transactionId}`), cols);
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
    const b = new ByteWriter();
    this.preamble(b);

    b.push(alignCenter(), boldOn(), sizeDoubleBoth());
    b.line(this.enc("MUTFAK"), cols);
    b.push(sizeNormal());
    b.line(this.enc(`#${snapshot.order.orderNumber}`), cols);
    b.push(boldOff(), alignLeft());

    b.line(this.enc(`Tür  : ${this.orderType(snapshot.order.type)}`), cols);
    if (snapshot.order.tableNumber) {
      b.push(boldOn());
      b.line(this.enc(`MASA : ${snapshot.order.tableNumber}`), cols);
      b.push(boldOff());
    }
    b.line(this.enc(this.trDateTime(snapshot.createdAt)), cols);
    this.rule(b, cols);

    // Items — large qty, no prices.
    for (const item of snapshot.items) {
      b.push(boldOn(), sizeDoubleHeight());
      b.line(
        this.enc(`${item.quantity} x ${item.name}`),
        this.doubleWidthCols(cols),
      );
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
    // No ESC @ here: a drawer kick must not reset an in-progress print job's
    // mode. It's a bare pulse the bridge sends to the printer's drawer port.
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
      codepage: "CP857",
      bytes,
      base64: buf.toString("base64"),
      byteLength: bytes.length,
    };
  }

  private preamble(b: ByteWriter): void {
    b.push(CMD_INIT, CMD_CODEPAGE_CP857);
  }

  private finish(b: ByteWriter, options: EscPosReceiptOptions): void {
    // Feed a few lines so the cut clears the print head, then cut.
    b.push([LF, LF, LF]);
    if (options.qr) this.qr(b, options.qr.data, options.qr.size ?? 6);
    if (options.cut !== false) b.push(cutPaper());
  }

  private footer(
    b: ByteWriter,
    cols: number,
    options: EscPosReceiptOptions,
  ): void {
    const lines = options.footerLines ?? [
      "Bizi tercih ettiğiniz için",
      "teşekkür ederiz.",
    ];
    if (lines.length === 0) return;
    this.rule(b, cols);
    b.push(alignCenter());
    for (const l of lines) b.line(this.enc(l), cols);
    b.push(alignLeft());
  }

  /**
   * GS ( k — print a model-2 QR. Stores the data then prints it. Sequence:
   *   set module size → set model → store data → print.
   */
  private qr(b: ByteWriter, data: string, size: number): void {
    const bytes = Array.from(Buffer.from(data, "utf8"));
    const len = bytes.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;
    b.push(alignCenter());
    // Model 2.
    b.push([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Module size.
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
    // Error correction level M.
    b.push([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // Store the data.
    b.push([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30], bytes);
    // Print.
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

  /** Column budget when text is printed double-width. */
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
      TICKET: "Yemek Kartı",
    };
    return map[method?.toUpperCase()] ?? method;
  }

  private nonZero(amount: string): boolean {
    return Number.parseFloat(amount) !== 0;
  }

  /**
   * Money is rendered as "1.234,56 TL" (Turkish grouping + the literal "TL"
   * suffix). The ₺ glyph has no CP857 codepoint, so we never try to print it;
   * "TL" is the conventional fiş suffix anyway. Non-TRY currencies keep their
   * ISO code suffix.
   */
  private money(amount: string, currency: string): string {
    const n = Number.parseFloat(amount);
    const safe = Number.isFinite(n) ? n : 0;
    const grouped = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
    const suffix = currency === "TRY" ? "TL" : currency;
    return `${grouped} ${suffix}`;
  }

  private trDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul",
    }).format(d);
  }

  /**
   * Lay out a label on the left and a value flush-right within `cols`
   * characters. If they collide, the value wins (truncate the label) so the
   * money column never wraps. Operates on the DECODED string (char count),
   * then is CP857-encoded by the caller — CP857 is single-byte so 1 char =
   * 1 column.
   */
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
   * Encode a JS string to CP857 bytes. ASCII passes through; mapped Turkish
   * letters use their CP857 codepoint; anything else degrades to "?" so the
   * column counter stays in sync with what prints.
   */
  private enc(text: string): Uint8Array {
    const out: number[] = [];
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if (code <= 0x7f) {
        out.push(code);
        continue;
      }
      const mapped = CP857[ch];
      out.push(mapped ?? 0x3f /* '?' */);
    }
    return Uint8Array.from(out);
  }
}

/**
 * Tiny append-only byte buffer. Accepts raw control sequences (number[] /
 * readonly number[]) and pre-encoded text runs (Uint8Array), and writes a
 * trailing LF after a text `line`. Kept local to the builder so the ESC/POS
 * command stream reads top-to-bottom.
 */
class ByteWriter {
  private readonly chunks: number[] = [];

  push(...parts: Array<ArrayLike<number>>): void {
    for (const p of parts) {
      for (let i = 0; i < p.length; i++) this.chunks.push(p[i]);
    }
  }

  /** Append an already-encoded text run, optionally clamped to `cols`, + LF. */
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
