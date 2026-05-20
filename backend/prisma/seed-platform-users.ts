/**
 * Idempotent seeder for the platform-level users (SuperAdmin +
 * MarketingUser). Lives outside the tenant realm; e2e tests need
 * stable credentials that survive incremental DB state. Run via:
 *
 *   npx ts-node prisma/seed-platform-users.ts
 *
 * Safe to invoke repeatedly — uses upsert by email.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const E2E_SUPERADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

// Platform-realm DTOs enforce min-8-char passwords (validation: see
// SuperAdminLoginDto and the marketing login DTO). The tenant-staff
// "demo123" is 7 chars and would 400; use 8+ here.
const E2E_PLATFORM_PASSWORD = 'demo1234';

async function main() {
  const password = await bcrypt.hash(E2E_PLATFORM_PASSWORD, 10);

  await prisma.superAdmin.upsert({
    where: { email: 'superadmin@e2e.local' },
    update: {
      password,
      status: 'ACTIVE',
      twoFactorEnabled: true,
      twoFactorSecret: E2E_SUPERADMIN_TOTP_SECRET,
      // Reset abuse counters so a prior failed-login run can't lock us.
      failedLogins: 0,
      lockedUntil: null,
    },
    create: {
      email: 'superadmin@e2e.local',
      password,
      firstName: 'Super',
      lastName: 'Admin',
      status: 'ACTIVE',
      twoFactorEnabled: true,
      twoFactorSecret: E2E_SUPERADMIN_TOTP_SECRET,
    },
  });

  await prisma.marketingUser.upsert({
    where: { email: 'marketing@e2e.local' },
    update: {
      password,
      status: 'ACTIVE',
      failedLogins: 0,
      lockedUntil: null,
    },
    create: {
      email: 'marketing@e2e.local',
      password,
      firstName: 'Marketing',
      lastName: 'Manager',
      role: 'SALES_MANAGER',
      status: 'ACTIVE',
    },
  });

  // Sentinel user for the AI research ingest routine. Never logs in;
  // password is randomised every seed run so a leaked seed file can't
  // be used to authenticate.
  const aiResearchPassword = await bcrypt.hash(
    require('crypto').randomBytes(48).toString('hex'),
    12,
  );
  await prisma.marketingUser.upsert({
    where: { email: 'ai-research@system.local' },
    update: {
      status: 'ACTIVE',
      failedLogins: 0,
      lockedUntil: null,
    },
    create: {
      email: 'ai-research@system.local',
      password: aiResearchPassword,
      firstName: 'AI',
      lastName: 'Research',
      role: 'SALES_MANAGER',
      status: 'ACTIVE',
    },
  });

  console.log('✅ platform users upserted');
  console.log(`  superadmin@e2e.local  /  ${E2E_PLATFORM_PASSWORD}  /  TOTP secret: ${E2E_SUPERADMIN_TOTP_SECRET}`);
  console.log(`  marketing@e2e.local   /  ${E2E_PLATFORM_PASSWORD}`);
  console.log(`  ai-research@system.local  /  (random — sentinel for ingest routine; no login)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
