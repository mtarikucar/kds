import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { FiscalReceipt } from "./fiscal-receipt.generator";

export const OKC_DEVICE = Symbol("OKC_DEVICE");

export interface OkcPrintResult {
  fiscalReceiptNo: string;
  ekuNo: string; // EKÜ (fiscal memory) serial
  zNo: number; // current Z-report number
  printedAt: Date;
}

/**
 * ÖKC device adapter. A real implementation drives a physical yeni-nesil
 * yazarkasa via its vendor SDK (Hugin/Beko/…) — external hardware. The code
 * path (receipt generation → print → fiscal result) is complete and exercised
 * end-to-end via MockOkcDevice; going live is swapping in the SDK-backed
 * provider under the OKC_DEVICE token.
 */
export interface OkcDeviceProvider {
  readonly name: string;
  isAvailable(): boolean;
  print(receipt: FiscalReceipt): Promise<OkcPrintResult>;
}

/** In-memory fiscal device — deterministic sequence, for dev/test + the full
 * flow. Not a real ÖKC; issues mock fiscal numbers so the pipeline is testable. */
@Injectable()
export class MockOkcDevice implements OkcDeviceProvider {
  readonly name = "MOCK";
  private seq = 0;
  private zNo = 1;

  isAvailable(): boolean {
    return true;
  }

  async print(_receipt: FiscalReceipt): Promise<OkcPrintResult> {
    this.seq += 1;
    return {
      fiscalReceiptNo: `MOCK-${String(this.seq).padStart(6, "0")}`,
      ekuNo: "EKU-MOCK-0001",
      zNo: this.zNo,
      printedAt: new Date(),
    };
  }
}

/** Default when no hardware is configured — refuses to print (clear signal). */
@Injectable()
export class NullOkcDevice implements OkcDeviceProvider {
  readonly name = "NONE";

  isAvailable(): boolean {
    return false;
  }

  async print(_receipt: FiscalReceipt): Promise<OkcPrintResult> {
    throw new ServiceUnavailableException(
      "No ÖKC device configured. Install a device provider (vendor SDK) to print fiscal receipts.",
    );
  }
}
