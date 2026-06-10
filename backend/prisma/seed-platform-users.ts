/**
 * Idempotent seeder for the platform-level users (SuperAdmin). Lives
 * outside the tenant realm; e2e tests need stable credentials that
 * survive incremental DB state. Run via:
 *
 *   npx ts-node prisma/seed-platform-users.ts
 *
 * Safe to invoke repeatedly — uses upsert by email.
 *
 * Marketing platform users (marketing@e2e.local, the ai-research ingest
 * sentinel) are NOT seeded here anymore: the marketing bounded context —
 * including the MarketingUser table — moved to the standalone
 * kds-marketing project, which owns its own seeds.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const E2E_SUPERADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

// Platform-realm DTOs enforce min-8-char passwords (validation: see
// SuperAdminLoginDto). The tenant-staff "demo123" is 7 chars and would
// 400; use 8+ here.
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

  console.log('✅ platform users upserted');
  console.log(`  superadmin@e2e.local  /  ${E2E_PLATFORM_PASSWORD}  /  TOTP secret: ${E2E_SUPERADMIN_TOTP_SECRET}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
