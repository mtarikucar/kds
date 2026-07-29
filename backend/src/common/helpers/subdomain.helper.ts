import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_QUARANTINE_DAYS,
} from "../constants/subdomain.const";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * A subdomain is blocked from reuse if it is in the platform-wide reserved
 * list (hard-coded) or if it is parked in the quarantine table within the
 * `availableAfter` window (after a tenant released it).
 *
 * `requestingTenantId`: a quarantine row stamped with the SAME tenant is
 * treated as reclaimable, not blocking — the quarantine exists to stop
 * OTHER tenants taking over the name; the owner undoing its own rename
 * (restoring a printed QR base URL) is exactly the safe case. Legacy rows
 * without an owner stamp keep blocking everyone.
 */
export async function isSubdomainQuarantined(
  prisma: PrismaLike,
  subdomain: string,
  requestingTenantId?: string,
): Promise<boolean> {
  const normalized = subdomain.toLowerCase();
  if (RESERVED_SUBDOMAINS.includes(normalized)) return true;
  const reserved = await prisma.reservedSubdomain.findUnique({
    where: { subdomain: normalized },
  });
  if (!reserved || reserved.availableAfter <= new Date()) return false;
  if (requestingTenantId && reserved.tenantId === requestingTenantId) {
    return false;
  }
  return true;
}

/**
 * Park a freed subdomain so it cannot be immediately reclaimed by a new
 * tenant (protects against subdomain takeover phishing).
 *
 * `tenantId` stamps the releasing tenant on the quarantine row so that same
 * tenant can later reclaim its own name (see isSubdomainQuarantined). Pass
 * it on every quarantine write; omitted only by legacy/unknown-owner paths.
 */
export async function reserveSubdomain(
  prisma: PrismaLike,
  subdomain: string,
  reason: "tenant_deleted" | "tenant_suspended" | "subdomain_changed",
  tenantId?: string,
): Promise<void> {
  const availableAfter = new Date();
  availableAfter.setDate(availableAfter.getDate() + SUBDOMAIN_QUARANTINE_DAYS);
  const normalized = subdomain.toLowerCase();
  await prisma.reservedSubdomain.upsert({
    where: { subdomain: normalized },
    create: {
      subdomain: normalized,
      reason,
      availableAfter,
      tenantId: tenantId ?? null,
    },
    update: {
      reason,
      availableAfter,
      reservedAt: new Date(),
      tenantId: tenantId ?? null,
    },
  });
}

/**
 * Cryptographically-strong 6-hex suffix for disambiguating collisions
 * when generating a subdomain from a human-readable name.
 */
export function randomSubdomainSuffix(): string {
  return randomBytes(4).toString("hex").slice(0, 6);
}
