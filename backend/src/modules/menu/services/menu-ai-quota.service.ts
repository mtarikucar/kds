import { Injectable } from "@nestjs/common";
import { CreditService } from "../../credits/credit.service";

/** FRAME and OCR-parse draw from the PHOTO pool (same image-scale vendor
    cost); MODEL3D has its own — a Meshy model is ~9× a photo. */
export type AiQuotaKind = "PHOTO" | "VIDEO" | "MODEL3D";

export interface AiQuotaUsage {
  used: number;
  /** Units bought. Named `limit` for the existing UI contract. */
  limit: number;
  remaining: number;
}

/**
 * The AI menu studio's view of prepaid credits.
 *
 * v3.3.0 replaced the monthly plan quota with credits that are bought and
 * valid until consumed. This stayed as a thin adapter rather than being
 * deleted: its five methods are called from 15 places across the media, 3D and
 * OCR-import services, and every one of them wants exactly the same
 * behaviour — claim atomically, refund on failure. Keeping the seam meant the
 * swap touched the balance source and nothing else.
 *
 * All the properties that mattered are inherited from CreditService and were
 * already right in the code this replaces: the advisory-locked claim (a burst
 * of parallel generations cannot overdraw), and a consumption ledger with no
 * product FK (so "delete the product → get the credit back" cannot farm free
 * generations).
 *
 * What changed underneath: no calendar-month window, and the balance comes
 * from purchased lots instead of a plan column. A tenant who buys 100 images
 * in March and spends 40 still has 60 in December.
 */
@Injectable()
export class MenuAiQuotaService {
  constructor(private readonly credits: CreditService) {}

  /** Read-only view for the AI-studio header. */
  async getUsage(tenantId: string, kind: AiQuotaKind): Promise<AiQuotaUsage> {
    const all = await this.credits.balances(tenantId);
    const row = all.find((b) => b.kind === kind);
    return {
      used: row?.used ?? 0,
      limit: row?.granted ?? 0,
      remaining: row?.remaining ?? 0,
    };
  }

  /** Atomically spend credits, or throw 402 with the pack to buy. */
  claim(tenantId: string, kind: AiQuotaKind, units: number): Promise<string> {
    return this.credits.claim(tenantId, kind, units, { type: "media_job" });
  }

  /** Link a claim to the job it paid for, so a failure can refund it. */
  attachJob(usageId: string, jobId: string): Promise<void> {
    return this.credits.attachRef(usageId, "media_job", jobId);
  }

  /** Refund a claim that never became a job. Idempotent. */
  voidUsage(usageId: string): Promise<void> {
    return this.credits.void(usageId);
  }

  /** Refund the claim behind a failed job. Idempotent. */
  voidByJob(jobId: string): Promise<void> {
    return this.credits.voidByRef(jobId);
  }
}
