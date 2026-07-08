import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import helmet from "helmet";
import * as bodyParser from "body-parser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookieParser = require("cookie-parser");
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { initSentry } from "./sentry.config";
import { validateEnv } from "./common/helpers/env-validation";
import { RedisIoAdapter } from "./common/adapters/redis-io.adapter";
import { createUploadsAclMiddleware } from "./common/middleware/uploads-acl.middleware";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const expressStatic = require("express").static;

// Fail-fast env validation BEFORE Sentry / Nest touches anything. Missing
// secrets previously surfaced as a first-request 500; now abort startup.
validateEnv();

initSentry();

// Global unhandled error handlers
process.on("unhandledRejection", (reason: any) => {
  console.error("Unhandled Rejection:", reason);
  try {
    // Lazy require: the handler must work even if module init partially
    // failed, which a top-level import cannot guarantee.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node");
    Sentry.captureException(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  } catch {}
});

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught Exception:", error);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node");
    Sentry.captureException(error);
  } catch {}
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Trust proxy so `req.ip`, rate-limiter tracking, and audit-IP columns see
  // the real client IP behind the load balancer. `true` (permissive) is
  // spoofable via X-Forwarded-For — operator should pin TRUST_PROXY to exact
  // hop count or known CIDR. Default 1 = one LB hop.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const parsed = Number(trustProxy);
    app.set("trust proxy", Number.isFinite(parsed) ? parsed : trustProxy);
  } else {
    app.set("trust proxy", 1);
  }

  // Body parsers: register path-scoped /api/webhooks FIRST so the generic
  // 100KB parser doesn't match it first (body-parser no-ops once a parser
  // matches). Delivery-platform webhooks can carry 200KB+ line-item bodies;
  // the generic path stays tight to block DoS.
  app.use(
    "/api/webhooks",
    bodyParser.json({
      limit: "2mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(
    bodyParser.json({
      limit: "100kb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ limit: "100kb", extended: true }));
  app.use(cookieParser());

  // Security headers with Helmet. CSP hardened with frame-ancestors 'none'
  // for clickjacking protection, object-src 'none', base-uri 'self',
  // form-action 'self', and connect-src allowing wss: for Socket.IO.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:", "wss:"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // process.cwd() (not __dirname) — webpack bundles to dist/main.js so
  // __dirname collapses to /app/dist/ in prod. The previous `__dirname/..`
  // form happened to resolve correctly because /app/dist/../uploads/ is
  // /app/uploads/ (where the Dockerfile creates the mount), but that's
  // pure accident of the current bundle layout. process.cwd() pins the
  // resolution to the canonical app root in both dev and prod. Same
  // pattern as EmailService + iter-23 SubscriptionNotificationService +
  // iter-24 ContactMailerService.
  //
  // SECURITY: the previous `app.useStaticAssets(... { prefix: '/uploads/' })`
  // was a blanket file server with NO authorization — any guessable path
  // streamed raw bytes of ANY tenant's file, and any future private category
  // would silently inherit that world-readable behavior. We replace it with
  // an ALLOWLIST gate that serves ONLY the public-by-design QR-menu asset
  // categories (`products/`, `logos/`) unauthenticated and 404s everything
  // else (other categories, path traversal, dotfiles). The actual file serve
  // is still delegated to express.static so Content-Type / ETag / range /
  // streaming behavior is byte-for-byte what the blanket mount produced.
  // See common/middleware/uploads-acl.middleware.ts for the threat model and
  // the place to register future private (tenant-scoped) categories.
  const uploadsRoot = join(process.cwd(), "uploads");
  app.use(
    "/uploads",
    createUploadsAclMiddleware({
      staticHandler: expressStatic(uploadsRoot),
    }),
  );

  app.setGlobalPrefix("api");

  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : ["http://localhost:5173", "http://localhost:5179"];

  // v2.8.94 — explicit tenant-subdomain regex with structural caps and
  // a reserved-name deny-list. Pre-fix `[a-z0-9-]+` matched any length
  // of any allowed character; combined with `credentials: true` an
  // attacker controlling a subdomain (DNS hijack, accidental wildcard
  // delegation, internal misconfig) would get cookied requests. The
  // new shape:
  //   - 3–32 char label (matches tenant subdomain validation rules)
  //   - cannot start or end with a hyphen
  //   - explicit deny-list of platform-reserved labels prevents an
  //     attacker who got `admin.hummytummy.com` provisioned to them
  //     from also winning CORS access
  const TENANT_SUBDOMAIN_RE =
    /^https:\/\/(?!-)[a-z0-9-]{3,32}(?<!-)\.hummytummy\.com$/;
  const TENANT_SUBDOMAIN_STAGING_RE =
    /^https:\/\/(?!-)[a-z0-9-]{3,32}(?<!-)\.staging\.hummytummy\.com$/;
  const RESERVED_SUBDOMAINS = new Set([
    "admin",
    "api",
    "app",
    "auth",
    "cdn",
    "dashboard",
    "docs",
    "help",
    "login",
    "mail",
    "ops",
    "panel",
    "platform",
    "root",
    "staff",
    "staging",
    "status",
    "superadmin",
    "support",
    "system",
    "www",
  ]);
  const isAllowedTenantOrigin = (origin: string): boolean => {
    let match = TENANT_SUBDOMAIN_RE.exec(origin);
    if (!match) match = TENANT_SUBDOMAIN_STAGING_RE.exec(origin);
    if (!match) return false;
    const label = origin.replace(/^https:\/\//, "").split(".")[0];
    if (RESERVED_SUBDOMAINS.has(label)) return false;
    return true;
  };

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (isAllowedTenantOrigin(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // X-Branch-Id: the branch-scope header the SPA sends on every scoped call
    // (BranchGuard). Without it here, any cross-origin deployment (e.g. local
    // dev on a different port) fails CORS preflight on all branch-scoped APIs.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Branch-Id",
    ],
    exposedHeaders: ["X-Total-Count", "X-Request-ID"],
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Socket.IO Redis adapter for multi-replica broadcast correctness. When
  // REDIS_URL is absent we fall back to the in-memory adapter with a warn
  // log so single-node dev keeps working. Every emit in the codebase uses
  // `server.to('<room>').emit(...)` which with the default adapter ONLY
  // reaches sockets on the same replica — horizontal scale-out silently
  // loses half the events.
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // Nest calls onModuleDestroy on SIGTERM/SIGINT so Prisma and Redis clients
  // drain cleanly on k8s rolling restarts. Without this, connections leak.
  app.enableShutdownHooks();

  // Swagger only in non-prod; in prod it reveals the full admin API surface.
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.SWAGGER_ENABLED === "true"
  ) {
    const config = new DocumentBuilder()
      .setTitle("HummyTummy API")
      .setDescription("Cloud-based restaurant management system")
      .setVersion("1.0")
      .addBearerAuth()
      // Partner Display API — a partner backend authenticates the screen-mint
      // call with its key id + secret (bearer secret over TLS).
      .addApiKey(
        {
          type: "apiKey",
          name: "X-Partner-Key",
          in: "header",
          description:
            "Partner API key id. Send the matching secret in X-Partner-Secret.",
        },
        "PartnerKey",
      )
      // Partner Display API — a screen presents its scoped token as
      // `Authorization: Screen <token>` on /v1/display/* routes.
      .addApiKey(
        {
          type: "apiKey",
          name: "Authorization",
          in: "header",
          description: 'Screen token, formatted as "Screen <token>".',
        },
        "Screen",
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap();
