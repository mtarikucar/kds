import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_QUARANTINE_DAYS,
} from '../constants/subdomain.const';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * A subdomain is blocked from reuse if it is in the platform-wide reserved
 * list (hard-coded) or if it is parked in the quarantine table within the
 * `availableAfter` window (after a tenant released it).
 */
export async function isSubdomainQuarantined(
  prisma: PrismaLike,
  subdomain: string,
): Promise<boolean> {
  const normalized = subdomain.toLowerCase();
  if (RESERVED_SUBDOMAINS.includes(normalized)) return true;
  const reserved = await prisma.reservedSubdomain.findUnique({
    where: { subdomain: normalized },
  });
  return !!reserved && reserved.availableAfter > new Date();
}

/**
 * Park a freed subdomain so it cannot be immediately reclaimed by a new
 * tenant (protects against subdomain takeover phishing).
 */
export async function reserveSubdomain(
  prisma: PrismaLike,
  subdomain: string,
  reason: 'tenant_deleted' | 'tenant_suspended' | 'subdomain_changed',
): Promise<void> {
  const availableAfter = new Date();
  availableAfter.setDate(availableAfter.getDate() + SUBDOMAIN_QUARANTINE_DAYS);
  const normalized = subdomain.toLowerCase();
  await prisma.reservedSubdomain.upsert({
    where: { subdomain: normalized },
    create: { subdomain: normalized, reason, availableAfter },
    update: { reason, availableAfter, reservedAt: new Date() },
  });
}

/**
 * Cryptographically-strong 6-hex suffix for disambiguating collisions
 * when generating a subdomain from a human-readable name.
 */
export function randomSubdomainSuffix(): string {
  return randomBytes(4).toString('hex').slice(0, 6);
}
