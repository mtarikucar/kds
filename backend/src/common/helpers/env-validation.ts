/**
 * Fail-fast environment validation. Runs at module bootstrap before any
 * route is served. Missing/short secrets previously surfaced as first-request
 * 500s; now they abort startup with an actionable error.
 *
 * Kept as a plain helper (not Joi/class-validator) so env validation doesn't
 * depend on a side-installed schema library.
 */
export interface EnvRule {
  key: string;
  required: boolean;
  minLength?: number;
  /** When `true`, the value must differ from every other `distinctFrom` entry. */
  distinctFrom?: string[];
  /** Only enforce in production. */
  prodOnly?: boolean;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';

const CORE_SECRETS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SUPERADMIN_JWT_SECRET',
  'SUPERADMIN_JWT_REFRESH_SECRET',
  'MARKETING_JWT_SECRET',
  'MARKETING_JWT_REFRESH_SECRET',
  'ENCRYPTION_MASTER_KEY',
];

const RULES: EnvRule[] = [
  { key: 'DATABASE_URL', required: true, minLength: 10 },
  // JWT realms — all must be present + unique + >= 32 chars
  ...CORE_SECRETS.map((k) => ({
    key: k,
    required: true,
    minLength: 32,
    distinctFrom: CORE_SECRETS.filter((x) => x !== k),
  })),
  // Production-only
  { key: 'CORS_ORIGIN', required: true, prodOnly: true },
  { key: 'SENTRY_DSN', required: false, prodOnly: true },
];

export function validateEnv(): void {
  const errors: string[] = [];

  for (const rule of RULES) {
    if (rule.prodOnly && !IS_PROD) continue;
    const value = process.env[rule.key];

    if (!value || value.trim() === '') {
      if (rule.required) {
        errors.push(`Missing required environment variable: ${rule.key}`);
      }
      continue;
    }

    if (rule.minLength && value.length < rule.minLength) {
      errors.push(
        `${rule.key} must be at least ${rule.minLength} characters (got ${value.length})`,
      );
    }

    if (rule.distinctFrom) {
      for (const other of rule.distinctFrom) {
        if (process.env[other] && process.env[other] === value) {
          errors.push(
            `${rule.key} must not equal ${other} (reusing a secret across realms defeats the isolation)`,
          );
        }
      }
    }
  }

  // Placeholder detection — catch .env.example leaking into real envs.
  const placeholders = [
    'your-super-secret-jwt-key-change-in-production',
    'your-super-secret-refresh-key',
    'change-me-32-chars-minimum-superadmin-jwt-secret',
    'change-me-32-chars-minimum-superadmin-refresh-secret',
    'change-me-32-chars-minimum-at-rest-encryption-key',
    'your-marketing-jwt-secret-change-in-production',
    'your-marketing-jwt-refresh-secret-change-in-production',
  ];
  if (IS_PROD) {
    for (const key of CORE_SECRETS) {
      if (placeholders.includes(process.env[key] ?? '')) {
        errors.push(`${key} is still set to the .env.example placeholder value`);
      }
    }
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[env-validation] startup aborted:\n  - ${errors.join('\n  - ')}\n`,
    );
    process.exit(1);
  }
}
