# Security Improvements for Production Payment System

This document outlines critical security improvements needed before going to production with payment processing.

## Table of Contents
1. [Webhook Security](#webhook-security)
2. [Payment Data Security](#payment-data-security)
3. [Rate Limiting & DDoS Protection](#rate-limiting--ddos-protection)
4. [Idempotency](#idempotency)
5. [Audit Logging](#audit-logging)
6. [Environment Security](#environment-security)
7. [Database Security](#database-security)
8. [Network Security](#network-security)

---

## 1. Webhook Security

### Stripe Webhook Verification
**Status**: ✅ Implemented

The Stripe webhook handler already verifies signatures using `stripe.webhooks.constructEvent()`.

Location: `backend/src/modules/subscriptions/webhooks/stripe-webhook.controller.ts:66`

### Iyzico Webhook Verification
**Status**: ⚠️  Needs Implementation

Iyzico doesn't provide built-in signature verification like Stripe. We need to implement custom verification.

#### Solution: HMAC-Based Verification

1. **Add webhook secret to environment**:
```bash
IYZICO_WEBHOOK_SECRET=your-random-32-char-secret
```

2. **Implement verification utility**:
```typescript
// backend/src/common/utils/iyzico-webhook-verification.util.ts
import * as crypto from 'crypto';

export function verifyIyzicoWebhook(
  payload: string,
  receivedSignature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const calculatedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(receivedSignature)
  );
}
```

3. **Update webhook controller** to verify signatures

4. **Alternative: IP Whitelisting**
If Iyzico provides static IP ranges, whitelist them:
```typescript
const IYZICO_IPS = [
  '52.58.100.0/24',
  // Add Iyzico IP ranges
];
```

---

## 2. Payment Data Security

### PCI DSS Compliance Checklist

- [x] Card data never touches your server (handled by Stripe/Iyzico)
- [x] Use HTTPS for all communication
- [x] No card numbers stored in database
- [x] No CVV codes stored or logged
- [ ] Implement data encryption at rest
- [ ] Regular security audits
- [ ] Employee security training

### Sensitive Data Handling

#### What to Store ✅
- Payment Intent IDs
- Customer IDs (from payment providers)
- Last 4 digits of card
- Card brand
- Transaction amounts
- Transaction status

#### What NOT to Store ❌
- Full card numbers
- CVV codes
- Expiration dates (raw form)
- Raw card tokens before use
- Unencrypted customer financial data

### Logging Best Practices

**DO log**:
```typescript
logger.info('Payment initiated', {
  tenantId: 'xxx',
  amount: 100,
  currency: 'USD',
  paymentIntentId: 'pi_xxx'
});
```

**DON'T log**:
```typescript
// BAD - Never do this!
logger.info('Payment data', {
  cardNumber: '4242424242424242',
  cvv: '123',
  paymentCard: fullCardObject
});
```

---

## 3. Rate Limiting & DDoS Protection

### Current Implementation
Basic rate limiting is configured via NestJS Throttler.

### Enhanced Rate Limiting

#### Per-Endpoint Limits

```typescript
// Payment creation: 5 attempts per minute
@Throttle(5, 60)
@Post('create-intent')
async createPaymentIntent() {}

// Payment confirmation: 3 attempts per minute (stricter)
@Throttle(3, 60)
@Post('confirm-payment')
async confirmPayment() {}

// Webhook endpoints: No rate limit (but verify signatures!)
@SkipThrottle()
@Post('webhooks/stripe')
async handleStripeWebhook() {}
```

#### Redis-Based Rate Limiting

For production, implement Redis-based rate limiting:

```typescript
import { RateLimiterRedis } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  points: 5, // 5 requests
  duration: 60, // per 60 seconds
  blockDuration: 300, // Block for 5 minutes if exceeded
});
```

#### IP-Based Blocking

```typescript
// Block suspicious IPs after too many failed payments
const failedPaymentsKey = `failed_payments:${clientIp}`;
const failedCount = await redis.incr(failedPaymentsKey);
await redis.expire(failedPaymentsKey, 3600); // 1 hour

if (failedCount > 10) {
  throw new TooManyRequestsException('Too many failed payment attempts');
}
```

### Cloudflare Protection (Recommended)

- [ ] Enable Cloudflare DDoS protection
- [ ] Configure WAF rules
- [ ] Enable bot detection
- [ ] Set up rate limiting at CDN level

---

## 4. Idempotency

### Why It's Critical
Prevent duplicate payments if user clicks "Pay" multiple times or network retries occur.

### Implementation

#### 1. Add Idempotency Key to DTOs

```typescript
// backend/src/modules/subscriptions/dto/payment-intent.dto.ts
export class CreatePaymentIntentDto {
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  // ... other fields
}
```

#### 2. Store Idempotency Keys in Redis

```typescript
async createPaymentWithIdempotency(dto: CreatePaymentIntentDto) {
  const idempotencyKey = dto.idempotencyKey || uuidv4();
  const cacheKey = `idempotency:${idempotencyKey}`;

  // Check if already processed
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached); // Return previous result
  }

  // Process payment
  const result = await this.processPayment(dto);

  // Cache result for 24 hours
  await redis.setex(cacheKey, 86400, JSON.stringify(result));

  return result;
}
```

#### 3. Frontend: Generate Idempotency Keys

```typescript
// frontend/src/api/paymentsApi.ts
export async function createPaymentIntent(data: PaymentIntentData) {
  const idempotencyKey = uuidv4();

  return axios.post('/payments/create-intent', {
    ...data,
    idempotencyKey,
  }, {
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  });
}
```

---

## 5. Audit Logging

### What to Audit

Create an audit log table for all payment-related actions:

```prisma
model AuditLog {
  id        String   @id @default(uuid())
  tenantId  String
  userId    String?
  action    String   // PAYMENT_CREATED, PAYMENT_FAILED, SUBSCRIPTION_CHANGED
  entity    String   // subscription, payment, invoice
  entityId  String
  oldValue  Json?    // Previous state
  newValue  Json?    // New state
  ipAddress String
  userAgent String?
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([tenantId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### Implement Audit Interceptor

```typescript
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { user, method, url, body } = request;

    return next.handle().pipe(
      tap(async (response) => {
        // Log successful actions
        await this.auditService.log({
          tenantId: user.tenantId,
          userId: user.id,
          action: `${method}_${url}`,
          metadata: { body, response },
          ipAddress: getClientIp(request),
          userAgent: request.headers['user-agent'],
        });
      }),
    );
  }
}
```

### Use Audit Logs

```typescript
// Log payment attempts
await this.auditService.log({
  tenantId,
  userId,
  action: 'PAYMENT_ATTEMPT',
  entity: 'payment',
  entityId: paymentIntent.id,
  metadata: {
    amount,
    currency,
    provider: 'stripe',
  },
  ipAddress: clientIp,
});
```

---

## 6. Environment Security

### Environment Variable Security

#### Development
```bash
# .env.development (committed to repo - OK)
STRIPE_SECRET_KEY=sk_test_xxx
IYZICO_API_KEY=sandbox-xxx
```

#### Production
```bash
# .env.production (NEVER commit!)
STRIPE_SECRET_KEY=sk_live_xxx
IYZICO_API_KEY=prod-xxx
```

#### Use Secret Management

**AWS Secrets Manager**:
```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretName: string): Promise<string> {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  return response.SecretString;
}
```

**Environment Variables in Docker**:
```yaml
# docker-compose.prod.yml
services:
  backend:
    environment:
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
    env_file:
      - .env.production
```

### JWT Security

```bash
# Use strong, randomly generated secrets (min 32 characters)
JWT_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
```

---

## 7. Database Security

### Encryption at Rest

#### PostgreSQL
```sql
-- Enable encryption extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt sensitive fields
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  card_token TEXT, -- Encrypted
  encrypted_data BYTEA -- Use pgcrypto
);

-- Example: Encrypt data
INSERT INTO payment_methods (encrypted_data)
VALUES (pgp_sym_encrypt('sensitive data', 'encryption-key'));

-- Decrypt data
SELECT pgp_sym_decrypt(encrypted_data, 'encryption-key') FROM payment_methods;
```

### Database Access Control

```sql
-- Create read-only user for reporting
CREATE ROLE reporting_user WITH LOGIN PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE restaurant_pos TO reporting_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting_user;

-- Application user with limited permissions
CREATE ROLE app_user WITH LOGIN PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE restaurant_pos TO app_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
-- DO NOT grant DELETE or DROP permissions
```

### Connection Security

```bash
# Use SSL for database connections
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require&sslcert=/path/to/cert"
```

---

## 8. Network Security

### HTTPS Only

```typescript
// Enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}
```

### Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'js.stripe.com'],
      frameSrc: ["'self'", 'js.stripe.com'],
      connectSrc: ["'self'", 'api.stripe.com', 'api.iyzipay.com'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

### CORS Configuration

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN, // https://yourdomain.com
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
});
```

### Firewall Rules

```bash
# Allow only necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirect to HTTPS)
ufw allow 443/tcp   # HTTPS
ufw allow 5432/tcp from 10.0.0.0/8  # PostgreSQL (internal only)
ufw enable
```

---

## Priority Implementation Checklist

### Critical (Implement Before Launch)
- [ ] Implement idempotency for payment operations
- [ ] Add comprehensive audit logging
- [ ] Enable HTTPS and security headers
- [ ] Implement proper webhook verification for Iyzico
- [ ] Set up Redis-based rate limiting
- [ ] Use secret management for production credentials
- [ ] Database connection with SSL
- [ ] IP-based fraud detection

### High Priority (First Week)
- [ ] Add monitoring and alerting
- [ ] Implement automated backup verification
- [ ] Set up error tracking (Sentry)
- [ ] Create incident response plan
- [ ] Regular security audits
- [ ] Penetration testing

### Medium Priority (First Month)
- [ ] Implement advanced fraud detection
- [ ] Add velocity checks
- [ ] Set up WAF rules
- [ ] Create security training materials
- [ ] Document security procedures
- [ ] Regular dependency updates

---

## Security Monitoring

### Metrics to Track

1. **Failed Payment Attempts**: Track by IP, user, and reason
2. **Webhook Verification Failures**: Alert on multiple failures
3. **Rate Limit Hits**: Monitor for attacks
4. **Database Connection Failures**: Alert immediately
5. **SSL Certificate Expiry**: Auto-renew with certbot
6. **Unauthorized Access Attempts**: Log and alert

### Alert Configuration

```yaml
security_alerts:
  - name: Multiple Failed Payments
    condition: failed_payments_per_ip > 5 in 10 minutes
    severity: HIGH
    action: Block IP and alert security team

  - name: Webhook Verification Failure
    condition: webhook_verification_failures > 3 in 5 minutes
    severity: CRITICAL
    action: Page on-call engineer

  - name: Unusual Payment Volume
    condition: payments_per_minute > 100
    severity: MEDIUM
    action: Alert fraud team for review

  - name: Database Connection Pool Exhaustion
    condition: db_connections > 90% of max
    severity: HIGH
    action: Scale database or restart service
```

---

## Regular Security Tasks

### Daily
- Review failed payment logs
- Check for unusual patterns
- Monitor rate limit hits

### Weekly
- Review audit logs
- Update security rules
- Check for suspicious IPs
- Verify backup integrity

### Monthly
- Update dependencies
- Review access controls
- Security audit
- Penetration testing
- Review and update documentation

### Quarterly
- Full security assessment
- Update disaster recovery plan
- Security training for team
- Review and renew SSL certificates (if not auto-renewed)

---

## Incident Response Plan

### 1. Suspected Breach
1. Immediately disable affected API keys
2. Rotate all secrets and credentials
3. Review audit logs for unauthorized access
4. Notify affected customers within 72 hours (GDPR)
5. Contact payment providers
6. Engage security consultant

### 2. Failed Payments Spike
1. Check payment provider status
2. Review error logs
3. Verify webhook delivery
4. Check for DDoS attack
5. Scale resources if needed

### 3. Database Compromise
1. Immediately block external database access
2. Rotate database credentials
3. Restore from clean backup
4. Audit all recent changes
5. Notify authorities if customer data exposed

---

## Compliance Requirements

### GDPR (EU Customers)
- [ ] Data processing agreement with payment providers
- [ ] Customer consent for payment processing
- [ ] Right to data deletion
- [ ] Breach notification within 72 hours
- [ ] Data encryption in transit and at rest

### PCI DSS (Payment Card Industry)
- [ ] Never store full card numbers
- [ ] Annual security assessment
- [ ] Quarterly vulnerability scans
- [ ] Security awareness training
- [ ] Incident response plan

### PSD2 (EU Payments)
- [ ] Strong Customer Authentication (SCA)
- [ ] 3D Secure 2.0 implementation
- [ ] Transaction monitoring

---

## Tools and Resources

### Security Testing
- **OWASP ZAP**: Web application security scanner
- **Burp Suite**: Security testing toolkit
- **Nmap**: Network scanning
- **SQLMap**: SQL injection testing

### Monitoring
- **Sentry**: Error tracking
- **Datadog**: Infrastructure monitoring
- **Grafana**: Metrics visualization
- **ELK Stack**: Log aggregation

### Secrets Management
- **AWS Secrets Manager**
- **HashiCorp Vault**
- **Azure Key Vault**
- **Google Cloud Secret Manager**

---

**Last Updated**: 2025-10-10
**Next Review**: 2025-11-10
**Owner**: Security Team
