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

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

const CORE_SECRETS = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "SUPERADMIN_JWT_SECRET",
  "SUPERADMIN_JWT_REFRESH_SECRET",
  // MARKETING_JWT_* / MARKETING_INGEST_TOKEN moved to the kds-marketing
  // service together with the marketing bounded context (Phase-5 split).
  // Core's side of the split uses MARKETING_SERVICE_URL +
  // INTERNAL_SERVICE_TOKEN, both optional: when unset, referral resolution
  // no-ops and the /api/internal/* endpoints answer 503.
  "ENCRYPTION_MASTER_KEY",
  // INTEGRATION_KEY is the seed for the per-tenant envelope key in
  // IntegrationService (see iter-8 commit message). IntegrationService
  // throws on missing key in production, but only at the FIRST encrypt
  // or decrypt call — too late if the first integration call is a
  // webhook from PayTR/Yemeksepeti. Validating here pulls the failure
  // forward to boot, which the orchestrator catches and surfaces as
  // a deploy failure instead of an opaque 500.
  "INTEGRATION_KEY",
];

const RULES: EnvRule[] = [
  { key: "DATABASE_URL", required: true, minLength: 10 },
  // JWT realms — presence is enforced in every environment. Length + cross-realm
  // uniqueness are enforced only in production so dev setups with the short
  // .env.example placeholders don't fail to boot. Operators still get a
  // very-clear error if they ship placeholders to production.
  ...CORE_SECRETS.map((k) => ({
    key: k,
    required: true,
    minLength: IS_PROD ? 32 : undefined,
    distinctFrom: IS_PROD ? CORE_SECRETS.filter((x) => x !== k) : undefined,
  })),
  // Production-only
  { key: "CORS_ORIGIN", required: true, prodOnly: true },
  { key: "SENTRY_DSN", required: false, prodOnly: true },
  // METRICS_TOKEN gates GET /api/metrics. When unset, MetricsController
  // serves the Prometheus registry to ANYONE who can reach the route —
  // payment/subscription/fiscal volumes, login-failure counts, outbox/DLQ
  // depth, per-route latency: a BI + attack-recon leak. Required in
  // production so the bearer-token check is always armed (defence in depth
  // alongside the nginx `location = /api/metrics` deny + 127.0.0.1 port
  // binding). 16+ chars.
  { key: "METRICS_TOKEN", required: true, prodOnly: true, minLength: 16 },
  // PayTR — required in production because the Turkish payment flow is
  // useless without them. Dev can run without (PaymentsService throws a
  // clear "credentials not configured" error if the user actually tries
  // to check out without setting them).
  { key: "PAYTR_MERCHANT_ID", required: true, prodOnly: true },
  { key: "PAYTR_MERCHANT_KEY", required: true, prodOnly: true, minLength: 8 },
  { key: "PAYTR_MERCHANT_SALT", required: true, prodOnly: true, minLength: 8 },
  { key: "PAYTR_OK_URL", required: true, prodOnly: true, minLength: 10 },
  { key: "PAYTR_FAIL_URL", required: true, prodOnly: true, minLength: 10 },
  // POS-specific redirect URLs for customer self-pay (QR menu PayTR
  // flow). Optional — falls back to the subscription PAYTR_OK_URL /
  // PAYTR_FAIL_URL if unset, but production should set them so
  // subdomain restaurants don't bounce customers to the wrong host.
  { key: "PAYTR_OK_URL_POS", required: false, prodOnly: true, minLength: 10 },
  { key: "PAYTR_FAIL_URL_POS", required: false, prodOnly: true, minLength: 10 },
  // Comma-separated regex patterns for valid return origins (e.g.
  // `https://.*\.hummytummy\.com,https://hummytummy\.com`). When the
  // QR menu is opened on a subdomain, the backend honors that origin
  // for PayTR's redirect IF it matches one of these patterns. Empty
  // → only the global PAYTR_*_URL_POS is used (subdomain customers
  // bounce back to the platform host).
  { key: "PAYTR_ALLOWED_RETURN_ORIGINS", required: false, prodOnly: false },
  // PAYTR_TEST_MODE defaults to "1" in adapter; PAYTR_WEBHOOK_ALLOWED_IPS
  // is optional defence-in-depth. Production-mode guard below.

  // SMTP — required in production. EmailService.initializeTransporter()
  // warns and continues if these are missing, which silently drops every
  // outbound email (password resets, email verification, plan-change
  // confirmations, contact-form replies). In a B2B SaaS that's
  // data-loss-by-misconfiguration. dev keeps the lax behavior so local
  // workflows aren't blocked on SMTP creds.
  { key: "EMAIL_HOST", required: true, prodOnly: true, minLength: 3 },
  { key: "EMAIL_USER", required: true, prodOnly: true },
  { key: "EMAIL_PASSWORD", required: true, prodOnly: true },
  // EMAIL_PORT optional — defaults to 587 in the transporter; EMAIL_FROM
  // optional — falls back to noreply@hummytummy.com in callers.
];

export function validateEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of RULES) {
    if (rule.prodOnly && !IS_PROD) continue;
    const value = process.env[rule.key];

    if (!value || value.trim() === "") {
      if (rule.required) {
        errors.push(`Missing required environment variable: ${rule.key}`);
      }
      continue;
    }

    if (rule.minLength && value.length < rule.minLength) {
      errors.push(
        `${rule.key} must be at least ${rule.minLength} characters (got ${value.length})`,
      );
    } else if (
      !IS_PROD &&
      value.length < 32 &&
      CORE_SECRETS.includes(rule.key)
    ) {
      warnings.push(
        `${rule.key} is ${value.length} chars — OK for dev, but < 32 chars will abort boot in production`,
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

  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n[env-validation] warnings (dev mode — production would fail):\n  - ${warnings.join("\n  - ")}\n`,
    );
  }

  // Placeholder detection — catch .env.example leaking into real envs.
  const placeholders = [
    "your-super-secret-jwt-key-change-in-production-32chars",
    "your-super-secret-refresh-key-change-in-production",
    "change-me-32-chars-minimum-superadmin-jwt-secret",
    "change-me-32-chars-minimum-superadmin-refresh-secret",
    "change-me-32-chars-minimum-at-rest-encryption-key",
  ];
  if (IS_PROD) {
    for (const key of CORE_SECRETS) {
      if (placeholders.includes(process.env[key] ?? "")) {
        errors.push(
          `${key} is still set to the .env.example placeholder value`,
        );
      }
    }
  }

  // PayTR test mode — must NOT stay "1" in production. A customer
  // whose 3DS "succeeds" against PayTR's sandbox while the merchant
  // is running prod credentials would book real Payment rows without
  // money actually moving. Hard-fail boot.
  if (IS_PROD) {
    const testMode = process.env.PAYTR_TEST_MODE;
    if (testMode === undefined || testMode === "" || testMode === "1") {
      errors.push(
        'PAYTR_TEST_MODE must be set to "0" in production ' +
          '(current value: "' +
          (testMode ?? "<unset>") +
          '"). Test-mode payments do not move real money.',
      );
    }
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[env-validation] startup aborted:\n  - ${errors.join("\n  - ")}\n`,
    );
    process.exit(1);
  }
}
