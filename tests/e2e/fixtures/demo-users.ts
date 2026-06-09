/**
 * Demo tenant credentials seeded by `npm run seed:demo` in
 * backend/prisma/seed-demo.ts. Tests rely on these being present.
 */
export type DemoRole = 'admin' | 'manager' | 'waiter' | 'kitchen';

export const DEMO_PASSWORD = 'demo123';

export const DEMO_USERS: Record<DemoRole, { email: string; password: string; firstName: string; role: string }> = {
  admin: {
    email: 'ahmet@sultanahmet-sofra.com',
    password: DEMO_PASSWORD,
    firstName: 'Ahmet',
    role: 'ADMIN',
  },
  manager: {
    email: 'elif@sultanahmet-sofra.com',
    password: DEMO_PASSWORD,
    firstName: 'Elif',
    role: 'MANAGER',
  },
  waiter: {
    email: 'mehmet@sultanahmet-sofra.com',
    password: DEMO_PASSWORD,
    firstName: 'Mehmet',
    role: 'WAITER',
  },
  kitchen: {
    email: 'mustafa@sultanahmet-sofra.com',
    password: DEMO_PASSWORD,
    firstName: 'Mustafa',
    role: 'KITCHEN',
  },
};

export const DEMO_TENANT_SUBDOMAIN = 'sultanahmet';

/**
 * Platform-level credentials (NOT tenant staff). Seeded by
 * `npx ts-node backend/prisma/seed-platform-users.ts`. Platform DTOs
 * enforce min-8-char passwords, so we use a longer password than the
 * 7-char tenant-staff "demo123".
 */
export const PLATFORM_PASSWORD = 'demo1234';

export const PLATFORM_USERS = {
  superadmin: {
    email: 'superadmin@e2e.local',
    password: PLATFORM_PASSWORD,
    /** Pre-enrolled TOTP secret — used by the test harness to mint
     *  valid 2FA codes via `speakeasy.totp({ secret, encoding: 'base32' })`. */
    totpSecret: 'JBSWY3DPEHPK3PXP',
  },
  // The marketing platform user moved with the marketing panel to the
  // separate kds-marketing project.
} as const;
