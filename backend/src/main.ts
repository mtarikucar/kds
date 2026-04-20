import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookieParser = require('cookie-parser');
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { initSentry } from './sentry.config';
import { validateEnv } from './common/helpers/env-validation';

// Fail-fast env validation BEFORE Sentry / Nest touches anything. Missing
// JWT_SECRET etc. used to surface as a first-request 500; now they abort.
validateEnv();

initSentry();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Trust proxy so `req.ip`, rate-limiter tracking, and audit-IP columns see
  // the real client IP behind the load balancer. `true` (permissive) is
  // spoofable via X-Forwarded-For — the operator should pin this to exact
  // hop count or a known CIDR via TRUST_PROXY. Default 1 = one LB hop.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const parsed = Number(trustProxy);
    app.set('trust proxy', Number.isFinite(parsed) ? parsed : trustProxy);
  } else {
    app.set('trust proxy', 1);
  }

  // Tighter default JSON body limit on everything EXCEPT the webhook /
  // upload routes which legitimately need larger payloads. 10MB was a DoS
  // vector on every POST handler.
  app.use(
    bodyParser.json({
      limit: '100kb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ limit: '100kb', extended: true }));

  // Webhook endpoints receive signed payloads from external platforms that
  // can carry full order bodies; allow more here but still bounded.
  app.use(
    '/api/webhooks',
    bodyParser.json({
      limit: '2mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

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
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  app.setGlobalPrefix('api');

  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173'];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (/^https:\/\/[a-z0-9-]+\.hummytummy\.com$/.test(origin)) return callback(null, true);
      if (/^https:\/\/[a-z0-9-]+\.staging\.hummytummy\.com$/.test(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Request-ID'],
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

  // Nest calls onModuleDestroy on SIGTERM/SIGINT so Prisma and Redis clients
  // drain cleanly on k8s rolling restarts. Without this, connections leak.
  app.enableShutdownHooks();

  // Swagger only in non-prod; in prod it reveals the full admin API surface.
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('HummyTummy API')
      .setDescription('Cloud-based restaurant management system')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap();
