import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import axios from "axios";
import {
  ReferralDirectoryPort,
  ResolvedReferral,
} from "../../core-contracts/referral/referral-directory.port";

/**
 * Phase-5 network transport for {@link ReferralDirectoryPort}.
 *
 * The in-process impl (ReferralDirectoryService, marketing/acl/) shipped with
 * the kds-marketing service; core now resolves referral codes over HTTP:
 *
 *   POST ${MARKETING_SERVICE_URL}/api/internal/referral/resolve
 *   headers: x-internal-token: ${INTERNAL_SERVICE_TOKEN}
 *   body:    { code }
 *   200 →    ResolvedReferral | null  (same DTO as the port)
 *
 * Referral attribution is best-effort by contract ("Must NEVER throw on a
 * bad code"): on network error, timeout, or any non-200, we log a warning
 * and return null — a payment must never fail because marketing is down.
 */
@Injectable()
export class HttpReferralDirectoryClient implements ReferralDirectoryPort {
  private readonly logger = new Logger(HttpReferralDirectoryClient.name);
  private readonly TIMEOUT_MS = 3_000;

  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string | undefined,
  ) {}

  async resolveReferralCode(code: string): Promise<ResolvedReferral | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/internal/referral/resolve`,
        { code: trimmed },
        {
          headers: { "x-internal-token": this.internalToken ?? "" },
          timeout: this.TIMEOUT_MS,
          // Treat every status as "resolved" so non-200s land in the
          // warn-and-null branch below instead of throwing.
          validateStatus: () => true,
        },
      );
      if (response.status !== 200) {
        this.logger.warn(
          `referral resolve failed (status ${response.status}) — attribution skipped for this checkout`,
        );
        return null;
      }
      const body = response.data as ResolvedReferral | null;
      if (!body || !body.marketingUserId || !body.referralCode) return null;
      return {
        marketingUserId: body.marketingUserId,
        referralCode: body.referralCode,
      };
    } catch (err) {
      this.logger.warn(
        `referral resolve unreachable (${(err as Error).message}) — attribution skipped for this checkout`,
      );
      return null;
    }
  }
}

/**
 * Bound when MARKETING_SERVICE_URL is unset (e.g. a dev checkout without the
 * marketing service running). Logs once at startup so the silent attribution
 * gap is visible in the boot log, then resolves every code to null.
 */
@Injectable()
export class NoopReferralDirectoryClient
  implements ReferralDirectoryPort, OnModuleInit
{
  private readonly logger = new Logger(NoopReferralDirectoryClient.name);

  onModuleInit(): void {
    this.logger.warn(
      "MARKETING_SERVICE_URL is not set — referral codes will not be resolved; " +
        "payments proceed without marketing attribution. Set MARKETING_SERVICE_URL " +
        "(+ INTERNAL_SERVICE_TOKEN) to enable the HTTP referral directory.",
    );
  }

  async resolveReferralCode(): Promise<null> {
    return null;
  }
}
