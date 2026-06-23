// Provider-neutral ESC/POS contracts. The cloud builds the raw byte stream
// for a Turkish-restaurant fiş / kitchen ticket / cash-drawer kick; the
// on-prem `local_bridge` simply writes those bytes to the USB/serial/network
// thermal printer. Keeping the byte-builder cloud-side means the bridge stays
// a dumb, audited executor and all formatting/i18n/codepage logic lives where
// it can be tested and shipped without re-flashing on-prem agents.
//
// Mirrors the fiscal-core seam (FiscalProvider / FiscalProviderRegistry): a
// narrow interface + a registry the concrete builder self-registers into on
// module init. New printer dialects (Star Line Mode, etc.) implement the same
// interface and register under a different `id`.

import type {
  ReceiptSnapshotV1,
  KitchenTicketSnapshotV1,
} from "../../orders/services/receipt-snapshot.builder";

/**
 * Which physical artefact a built byte stream targets. Maps 1:1 onto the
 * device-mesh `CommandKind`s the bridge dispatcher executes:
 *   receipt        → print_receipt
 *   kitchen_ticket → print_receipt (routed to a kitchen_printer device)
 *   drawer_kick    → open_drawer
 */
export type EscPosArtifact = "receipt" | "kitchen_ticket" | "drawer_kick";

/**
 * The device-mesh command kinds this builder produces payloads for. Re-stated
 * here (rather than importing the full CommandKind union) so the printing seam
 * only depends on the two kinds it actually emits; the DTO's `satisfies
 * CommandKind[]` check is the source of truth for the full set.
 */
export type EscPosCommandKind = "print_receipt" | "open_drawer";

/**
 * A built ESC/POS job. `bytes` is the raw command stream; `base64` is the
 * same bytes wrapped for the device-mesh command payload (JSON-safe). The
 * bridge base64-decodes `base64` and writes it verbatim — it MUST equal
 * `Buffer.from(bytes).toString("base64")`.
 */
export interface EscPosJob {
  artifact: EscPosArtifact;
  /** Codepage the bytes were encoded in (informational; bridge does not re-encode). */
  codepage: "CP857";
  bytes: Uint8Array;
  base64: string;
  /** Byte length — convenience for callers logging/metering print volume. */
  byteLength: number;
}

/**
 * A fully-formed device-mesh command payload ready to hand to
 * CommandQueueService.enqueue(deviceId, { kind, payload, idempotencyKey }).
 *
 * The `payload` carries the base64 byte stream plus light metadata the bridge
 * uses for routing/observability (drawer pin, cut mode). It is intentionally a
 * plain JSON object (Record<string, unknown>-compatible) so it round-trips
 * through the `Json` command column unchanged.
 */
export interface EscPosCommandPayload {
  /** ESC/POS byte stream, base64-encoded. */
  data: string;
  codepage: "CP857";
  artifact: EscPosArtifact;
  /**
   * Stable hash of the byte stream. Lets the bridge dedupe a re-delivered
   * print of the SAME job (the command-queue marks print_receipt/open_drawer
   * non-retryable, but a network-level redelivery of the identical command is
   * still possible). Same input → same digest → bridge can skip a dup.
   */
  contentHash: string;
}

export interface EscPosPrintCommand {
  kind: "print_receipt";
  payload: EscPosCommandPayload;
}

export interface EscPosDrawerCommand {
  kind: "open_drawer";
  payload: EscPosCommandPayload & {
    /** ESC p connector pin: 0 (pin 2) or 1 (pin 5). Defaults to 0. */
    pin: 0 | 1;
  };
}

/**
 * Options for a receipt/ticket build. All optional — sensible Turkish-fiş
 * defaults apply. `paperWidth` selects the character columns for the chosen
 * font (42 cols for an 80 mm head at Font A, 32 cols for a 58 mm head).
 */
export interface EscPosReceiptOptions {
  /** Printer head width. Default "80mm". */
  paperWidth?: "58mm" | "80mm";
  /** Emit a GS V paper cut at the end. Default true. */
  cut?: boolean;
  /** Render a QR (e.g. an e-Arşiv/verification URL or order id) before the cut. */
  qr?: { data: string; size?: number };
  /** Free-form footer lines (e.g. "Bizi tercih ettiğiniz için teşekkürler"). */
  footerLines?: string[];
  /** Open the drawer at the end (appends ESC p). Default false. */
  kickDrawerAfter?: boolean;
}

/**
 * The ESC/POS byte-builder seam. A single implementation
 * (EscPosBuilderService) is shipped today; the registry lets a future
 * Star/Bixolon dialect coexist.
 */
export interface EscPosBuilder {
  readonly id: string;

  /**
   * Build a customer receipt (fiş) from the canonical receipt snapshot.
   * Pure + deterministic for a fixed snapshot+options EXCEPT for the
   * snapshot's own `printedAt`, which the caller has already frozen.
   */
  buildReceipt(
    snapshot: ReceiptSnapshotV1,
    options?: EscPosReceiptOptions,
  ): EscPosJob;

  /** Build a kitchen ticket (mutfak fişi) — large, no prices/totals. */
  buildKitchenTicket(
    snapshot: KitchenTicketSnapshotV1,
    options?: EscPosReceiptOptions,
  ): EscPosJob;

  /** Build a bare cash-drawer kick (ESC p) for the open_drawer command. */
  drawerKick(pin?: 0 | 1): EscPosJob;

  /** Wrap a built job into a device-mesh print_receipt command. */
  toPrintCommand(job: EscPosJob): EscPosPrintCommand;

  /** Wrap a built drawer-kick job into a device-mesh open_drawer command. */
  toDrawerCommand(job: EscPosJob, pin?: 0 | 1): EscPosDrawerCommand;
}
