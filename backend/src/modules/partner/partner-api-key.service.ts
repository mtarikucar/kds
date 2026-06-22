import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { PartnerScope } from "./partner.constants";

// Per-tenant cap on active partner keys. DoS guard, not a precise quota — the
// count() race is bounded N+1 (accepted, same posture as webhooks-outbound).
const PARTNER_API_KEY_CAP_PER_TENANT = Math.max(
  1,
  Number(process.env.PARTNER_API_KEY_CAP_PER_TENANT ?? "10"),
);

export interface IssueApiKeyInput {
  name: string;
  scopes: PartnerScope[];
  allowedReturnOrigins?: string[];
  allowedBranchIds?: string[];
}

// Columns safe to return on list/read — NEVER the secretHash.
const SAFE_SELECT = {
  id: true,
  keyId: true,
  name: true,
  scopes: true,
  allowedReturnOrigins: true,
  allowedBranchIds: true,
  status: true,
  lastUsedAt: true,
  createdBy: true,
  createdAt: true,
  revokedAt: true,
} as const;

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Tenant-issued credential lifecycle. A restaurant ADMIN issues a key to its
 * integrator; the raw secret is shown ONCE and stored only as sha256.
 * Authentication (bearer secret over TLS) and revocation (IDOR-safe, cascading
 * to child ScreenSessions) live here.
 */
@Injectable()
export class PartnerApiKeyService {
  private readonly logger = new Logger(PartnerApiKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ADMIN-side: create a key. Returns the raw secret EXACTLY ONCE. */
  async issue(tenantId: string, createdBy: string | null, input: IssueApiKeyInput) {
    const activeCount = await this.prisma.partnerApiKey.count({
      where: { tenantId, status: "active" },
    });
    if (activeCount >= PARTNER_API_KEY_CAP_PER_TENANT) {
      throw new BadRequestException(
        `partner API key cap reached (${PARTNER_API_KEY_CAP_PER_TENANT}); revoke unused keys first`,
      );
    }

    const keyId = `pk_live_${randomBytes(9).toString("base64url")}`;
    const secret = `pk_live_secret_${randomBytes(24).toString("base64url")}`;
    const secretHash = sha256Hex(secret);

    const row = await this.prisma.partnerApiKey.create({
      data: {
        tenantId,
        keyId,
        secretHash,
        name: input.name,
        scopes: input.scopes,
        allowedReturnOrigins: input.allowedReturnOrigins ?? [],
        allowedBranchIds: input.allowedBranchIds ?? [],
        createdBy: createdBy ?? undefined,
      },
      select: SAFE_SELECT,
    });

    // Secret returned once; never re-derivable from the stored sha256 hash.
    return { ...row, secret };
  }

  /** ADMIN-side: list this tenant's keys (never exposes secretHash). */
  list(tenantId: string) {
    return this.prisma.partnerApiKey.findMany({
      where: { tenantId },
      select: SAFE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * ADMIN-side: revoke a key. IDOR-safe single compound update, then cascade
   * the revocation to the key's active ScreenSessions so live screen tokens
   * die on their next request.
   */
  async revoke(tenantId: string, id: string): Promise<void> {
    const result = await this.prisma.partnerApiKey.updateMany({
      where: { id, tenantId },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException("Partner API key not found");
    }
    await this.prisma.screenSession.updateMany({
      where: { partnerApiKeyId: id, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }

  /**
   * Machine-side: authenticate a presented (keyId, secret) pair. Looks up by
   * keyId (public), then timing-safe compares sha256(secret) to the stored
   * hash. Returns the active key row or null (the guard maps null → 401).
   */
  async authenticate(keyId: string, rawSecret: string) {
    if (!keyId || !rawSecret) return null;
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { keyId, status: "active" },
    });
    if (!row) return null;

    const provided = sha256Hex(rawSecret);
    // Equal-length hex buffers required by timingSafeEqual.
    if (provided.length !== row.secretHash.length) return null;
    const matches = timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(row.secretHash, "hex"),
    );
    if (!matches) return null;

    // Best-effort last-used touch; never block auth on it.
    this.prisma.partnerApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return row;
  }
}
