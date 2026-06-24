import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * Register a physical fiscal device (yazarkasa / ÖKC) so the
 * payment-finalizer's yazarkasa-receipt path becomes reachable for this
 * tenant.
 *
 * HONESTY: creating this record does NOT make receipts print. A real GMP-3
 * ÖKC (Hugin/Beko) only issues once its certified hardware is wired through
 * the local bridge (linked via `deviceId`) AND the bridge acks the queued
 * fiscal command. Until then, paid orders enqueue a `queued` FiscalReceipt
 * (visible in the recovery panel) — never a fake "issued". `efatura` is NOT a
 * physical device and is rejected here (e-documents go through the Accounting
 * rail on order payment).
 */
export class RegisterFiscalDeviceDto {
  /**
   * Registered fiscal provider id with a `receipt` capability — i.e. a
   * physical ÖKC (`fiscal_hugin`, `fiscal_beko`, or `mock` outside prod).
   * The cloud `efatura` provider (capability `invoice` only) is rejected.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  providerId!: string;

  /** Hardware serial of the yazarkasa. Unique per (tenant, provider). */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  serial!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  /**
   * Optional link to the device-mesh Device row (the local bridge / yazarkasa
   * this ÖKC is wired through). Validated to exist in the same tenant + branch
   * when provided; required in practice for a GMP-3 ÖKC to ever issue.
   */
  @IsOptional()
  @IsString()
  deviceId?: string;

  /** Branch override; defaults to the request's branch scope. */
  @IsOptional()
  @IsString()
  branchId?: string;

  /** Provider-specific config (VAT-rate → department map, station code, …). */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
