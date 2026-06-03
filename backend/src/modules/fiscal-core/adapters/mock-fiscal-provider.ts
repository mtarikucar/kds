import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  FiscalCapability,
  FiscalDeviceStatus,
  FiscalProvider,
  FiscalReceiptRequest,
  FiscalReceiptResult,
  ZReport,
} from "../fiscal-provider.interface";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";

/**
 * Sandbox fiscal provider used by CI and demo tenants. Always issues
 * monotonically-increasing fiscal numbers so reporting and e-Fatura demos
 * look realistic without touching real hardware.
 */
@Injectable()
export class MockFiscalProvider implements FiscalProvider, OnModuleInit {
  readonly id = "mock";
  readonly capabilities: FiscalCapability[] = ["receipt", "cancel", "z_report"];
  private readonly logger = new Logger(MockFiscalProvider.name);
  private sequence = 1;
  private readonly issued = new Map<string, FiscalReceiptResult>();

  constructor(private readonly registry: FiscalProviderRegistry) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV !== "production") this.registry.register(this);
  }

  async issueReceipt(req: FiscalReceiptRequest): Promise<FiscalReceiptResult> {
    if (this.issued.has(req.idempotencyKey))
      return this.issued.get(req.idempotencyKey)!;
    const result: FiscalReceiptResult = {
      providerId: this.id,
      receiptId: uuidv7(),
      fiscalNo: String(this.sequence++).padStart(8, "0"),
      fiscalZNo: "Z-001",
      status: "issued",
    };
    this.issued.set(req.idempotencyKey, result);
    return result;
  }

  async cancelReceipt(_id: string, _reason: string): Promise<void> {
    // Mock: no-op. Real provider would reverse it on the device.
  }

  async reprintReceipt(_id: string): Promise<void> {
    // No-op.
  }

  async status(fiscalDeviceId: string): Promise<FiscalDeviceStatus> {
    return { providerId: this.id, fiscalDeviceId, status: "online" };
  }

  async zReport(fiscalDeviceId: string, _date: Date): Promise<ZReport> {
    return {
      providerId: this.id,
      fiscalDeviceId,
      zNo: "Z-001",
      openedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      closedAt: new Date().toISOString(),
      totals: { cash: 0, card: 0 },
    };
  }

  async closeDay(fiscalDeviceId: string): Promise<ZReport> {
    return this.zReport(fiscalDeviceId, new Date());
  }

  async healthCheck() {
    return { ok: true, details: { mode: "mock" } };
  }
}
