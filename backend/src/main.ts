import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { initSentry } from './sentry.config';
import { validateEnv } from './common/helpers/env-validation';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

// Fail-fast env validation BEFORE Sentry / Nest touches anything. Missing
// secrets previously surfaced as a first-request 500; now abort startup.
validateEnv();

// Initialize Sentry as early as possible
initSentry();

// Global unhandled error handlers
process.on('unhandledRejection', (reason: any) => {
  console.error('Unhandled Rejection:', reason);
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  } catch {}
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureException(error);
  } catch {}
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // Disable built-in parser so our custom one with rawBody capture works
  });

  // Trust proxy so `req.ip`, rate-limiter tracking, and audit-IP columns see
  // the real client IP behind the load balancer. `true` (permissive) is
  // spoofable via X-Forwarded-For — operator should pin TRUST_PROXY to exact
  // hop count or known CIDR. Default 1 = one LB hop.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const parsed = Number(trustProxy);
    app.set('trust proxy', Number.isFinite(parsed) ? parsed : trustProxy);
  } else {
    app.set('trust proxy', 1);
  }

  // Body parsers: register path-scoped /api/webhooks FIRST so the generic
  // 100KB parser doesn't match it first (body-parser no-ops once a parser
  // matches). Delivery-platform webhooks can carry 200KB+ line-item bodies;
  // the generic path stays tight to block DoS.
  app.use(
    '/api/webhooks',
    bodyParser.json({
      limit: '2mb',
      verify: (req: any, _res, buf) => { req.rawBody = buf; },
    }),
  );
  app.use(bodyParser.json({
    limit: '100kb',
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(bodyParser.urlencoded({ limit: '100kb', extended: true }));

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
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https:', 'wss:'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow embedding for QR codes
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resources
    }),
  );

  // Serve static files from uploads directory
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS - properly configured with wildcard subdomain support
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173'];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin matches allowed origins list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow any *.hummytummy.com subdomain (production)
      if (/^https:\/\/[a-z0-9-]+\.hummytummy\.com$/.test(origin)) {
        return callback(null, true);
      }

      // Allow any *.staging.hummytummy.com subdomain (staging)
      if (/^https:\/\/[a-z0-9-]+\.staging\.hummytummy\.com$/.test(origin)) {
        return callback(null, true);
      }

      // Reject other origins
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Request-ID'],
  });

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // Allow extra properties (they'll be stripped by whitelist)
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('HummyTummy API')
    .setDescription('Cloud-based restaurant management system')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('tenants', 'Multi-tenant management')
    .addTag('users', 'User management')
    .addTag('menu', 'Menu and products')
    .addTag('orders', 'Order management')
    .addTag('tables', 'Table management')
    .addTag('payments', 'Payment processing')
    .addTag('kds', 'Kitchen Display System')
    .addTag('stock', 'Inventory management')
    .addTag('reports', 'Analytics and reports')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, document);
  }

  // Socket.IO Redis adapter for multi-replica broadcast correctness. When
  // REDIS_URL is absent we fall back to the in-memory adapter with a warn
  // log so single-node dev keeps working. Every emit in the codebase uses
  // `server.to('<room>').emit(...)` which with the default adapter ONLY
  // reaches sockets on the same replica — horizontal scale-out silently
  // loses half the events.
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
