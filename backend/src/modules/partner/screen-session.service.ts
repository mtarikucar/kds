import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { CustomerSessionService } from "../customers/customer-session.service";
import { PartnerScope } from "./partner.constants";

// Access tokens are short-lived (the screen refreshes them); the refresh token
// (and the backing CustomerSession it extends) spans a long install window.
const ACCESS_TTL_MS = Math.max(
  60_000,
  Number(process.env.SCREEN_TOKEN_TTL_MS ?? 60 * 60 * 1000), // 1h
);
const REFRESH_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.SCREEN_REFRESH_TTL_MS ?? 30 * 24 * 60 * 60 * 1000), // 30d
);
const SCREEN_SESSION_CAP_PER_BRANCH = Math.max(
  1,
  Number(process.env.SCREEN_SESSION_CAP_PER_BRANCH ?? "50"),
);

export interface MintingKey {
  id: string;
  tenantId: string;
  scopes: string[];
  allowedBranchIds: string[];
}

export interface MintScreenSessionInput {
  branchId: string;
  tableId?: string;
  scopes?: PartnerScope[];
}

function newToken(): string {
  // uuidv7 prefix is sortable/indexable + non-secret; entropy is the suffix.
  return `${uuidv7()}.${randomBytes(24).toString("base64url")}`;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const SAFE_SELECT = {
  id: true,
  tenantId: true,
  branchId: true,
  tableId: true,
  partnerApiKeyId: true,
  orderingSessionId: true,
  scopes: true,
  tokenExpiresAt: true,
  refreshExpiresAt: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

/**
 * Mints/refreshes/revokes per-screen scoped tokens. Each ScreenSession is
 * branch-bound and carries a backing CustomerSession (orderingSessionId) so
 * the unchanged customer-orders / self-pay / qr-menu services and the
 * customer-session realtime room work verbatim for a partner screen.
 */
@Injectable()
export class ScreenSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerSessions: CustomerSessionService,
  ) {}

  /** Machine-side: mint a screen token for a partner key. Tokens returned once. */
  async mint(key: MintingKey, input: MintScreenSessionInput) {
    const { branchId, tableId } = input;

    // Branch must belong to the tenant + be active, and be permitted by the key.
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId: key.tenantId },
      select: { id: true, status: true },
    });
    if (!branch || branch.status !== "active") {
      throw new BadRequestException(
        "Invalid or inactive branch for this tenant",
      );
    }
    if (
      key.allowedBranchIds.length > 0 &&
      !key.allowedBranchIds.includes(branchId)
    ) {
      throw new BadRequestException("Branch not permitted for this API key");
    }
    if (tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: tableId, tenantId: key.tenantId, branchId },
        select: { id: true },
      });
      if (!table) {
        throw new BadRequestException("Invalid table for this branch");
      }
    }

    // Effective scopes ⊆ key scopes.
    const requested = input.scopes ?? (key.scopes as PartnerScope[]);
    const effective = requested.filter((s) => key.scopes.includes(s));
    if (effective.length === 0) {
      throw new BadRequestException(
        "No valid scopes requested (must be a subset of the key's scopes)",
      );
    }

    const activeCount = await this.prisma.screenSession.count({
      where: { tenantId: key.tenantId, branchId, status: "active" },
    });
    if (activeCount >= SCREEN_SESSION_CAP_PER_BRANCH) {
      throw new BadRequestException(
        `screen session cap reached (${SCREEN_SESSION_CAP_PER_BRANCH}); revoke unused screens first`,
      );
    }

    // Backing CustomerSession (64-hex orderingSessionId) — the ordering identity.
    const backing = await this.customerSessions.createForScreen(
      key.tenantId,
      tableId,
      REFRESH_TTL_MS,
    );

    const screenToken = newToken();
    const refreshToken = newToken();
    const now = Date.now();
    const tokenExpiresAt = new Date(now + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);

    const row = await this.prisma.screenSession.create({
      data: {
        tenantId: key.tenantId,
        branchId,
        tableId,
        partnerApiKeyId: key.id,
        orderingSessionId: backing.sessionId,
        scopes: effective,
        tokenHash: hashToken(screenToken),
        refreshTokenHash: hashToken(refreshToken),
        tokenExpiresAt,
        refreshExpiresAt,
      },
      select: SAFE_SELECT,
    });

    return {
      id: row.id,
      screenToken,
      refreshToken,
      expiresAt: tokenExpiresAt,
      refreshExpiresAt,
      scopes: row.scopes,
      tenantId: row.tenantId,
      branchId: row.branchId,
      tableId: row.tableId,
      orderingSessionId: row.orderingSessionId,
    };
  }

  /** Screen-side: validate an access token. Returns the active row or null. */
  async authenticate(rawToken: string) {
    if (!rawToken) return null;
    const row = await this.prisma.screenSession.findFirst({
      where: { tokenHash: hashToken(rawToken), status: "active" },
      select: SAFE_SELECT,
    });
    if (!row) return null;
    if (row.tokenExpiresAt < new Date()) return null;
    this.prisma.screenSession
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    return row;
  }

  /**
   * Machine-side: rotate a screen's tokens via its refresh token. Single-use:
   * the rotation is keyed on the OLD refresh hash so a replayed refresh races
   * to count===0. Extends the backing CustomerSession.
   */
  async refresh(key: MintingKey, rawRefresh: string) {
    if (!rawRefresh) throw new UnauthorizedException("Missing refresh token");
    const oldHash = hashToken(rawRefresh);
    const existing = await this.prisma.screenSession.findFirst({
      where: {
        refreshTokenHash: oldHash,
        status: "active",
        partnerApiKeyId: key.id,
      },
      select: { id: true, refreshExpiresAt: true, orderingSessionId: true },
    });
    if (!existing || existing.refreshExpiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const screenToken = newToken();
    const refreshToken = newToken();
    const now = Date.now();
    const tokenExpiresAt = new Date(now + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);

    const rotated = await this.prisma.screenSession.updateMany({
      where: { refreshTokenHash: oldHash, status: "active" },
      data: {
        tokenHash: hashToken(screenToken),
        refreshTokenHash: hashToken(refreshToken),
        tokenExpiresAt,
        refreshExpiresAt,
      },
    });
    if (rotated.count === 0) {
      throw new UnauthorizedException("Refresh token already used");
    }

    await this.customerSessions.extendSession(
      existing.orderingSessionId,
      refreshExpiresAt,
    );

    return {
      id: existing.id,
      screenToken,
      refreshToken,
      expiresAt: tokenExpiresAt,
      refreshExpiresAt,
    };
  }

  /** ADMIN/machine-side: revoke a single screen session (+ its backing session). */
  async revoke(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.screenSession.findFirst({
      where: { id, tenantId },
      select: { orderingSessionId: true },
    });
    const result = await this.prisma.screenSession.updateMany({
      where: { id, tenantId },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException("Screen session not found");
    }
    if (row) {
      await this.prisma.customerSession
        .updateMany({
          where: { sessionId: row.orderingSessionId },
          data: { isActive: false },
        })
        .catch(() => undefined);
    }
  }
}
