import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase, createTestTenant, getAuthToken } from '../src/common/test/test-helpers';

describe('Subscriptions E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let userId: string;
  let freePlanId: string;
  let proPlanId: string;
  let enterprisePlanId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    prisma = app.get<PrismaService>(PrismaService);

    await app.init();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    // Create subscription plans
    const plans = await Promise.all([
      prisma.subscriptionPlan.create({
        data: {
          name: 'FREE',
          displayName: 'Free Plan',
          price: 0,
          interval: 'MONTHLY',
          features: { basic: true },
          maxUsers: 2,
          maxProducts: 20,
          isActive: true,
        },
      }),
      prisma.subscriptionPlan.create({
        data: {
          name: 'PRO',
          displayName: 'Pro Plan',
          price: 49.99,
          interval: 'MONTHLY',
          features: { advanced: true, analytics: true },
          maxUsers: 10,
          maxProducts: 500,
          isActive: true,
        },
      }),
      prisma.subscriptionPlan.create({
        data: {
          name: 'ENTERPRISE',
          displayName: 'Enterprise Plan',
          price: 199.99,
          interval: 'MONTHLY',
          features: { advanced: true, analytics: true, multiLocation: true },
          maxUsers: 100,
          maxProducts: 99999,
          isActive: true,
        },
      }),
    ]);

    freePlanId = plans[0].id;
    proPlanId = plans[1].id;
    enterprisePlanId = plans[2].id;

    // Create test tenant with FREE plan
    const { tenant, user } = await createTestTenant(prisma);
    tenantId = tenant.id;
    userId = user.id;
    authToken = getAuthToken(user);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('GET /subscriptions/plans - List Plans', () => {
    it('should list all active subscription plans', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/plans')
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('price');
      expect(response.body[0]).toHaveProperty('features');
    });
  });

  describe('GET /subscriptions/current - Get Current Subscription', () => {
    it('should get current subscription details', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.subscriptionTier).toBe('FREE');
      expect(response.body.subscriptionStatus).toBe('ACTIVE');
    });
  });

  describe('POST /subscriptions/upgrade - Upgrade Subscription', () => {
    it('should create pending upgrade from FREE to PRO', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscriptions/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: proPlanId })
        .expect(201);

      expect(response.body.fromPlan).toBe('FREE');
      expect(response.body.toPlan).toBe('PRO');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.amount).toBeGreaterThan(0);
    });

    it('should create pending upgrade from PRO to ENTERPRISE', async () => {
      // First upgrade tenant to PRO
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionTier: 'PRO',
          subscriptionStatus: 'ACTIVE',
        },
      });

      const response = await request(app.getHttpServer())
        .post('/subscriptions/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: enterprisePlanId })
        .expect(201);

      expect(response.body.fromPlan).toBe('PRO');
      expect(response.body.toPlan).toBe('ENTERPRISE');
    });

    it('should reject downgrade to lower tier', async () => {
      // Set tenant to PRO
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionTier: 'PRO' },
      });

      await request(app.getHttpServer())
        .post('/subscriptions/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: freePlanId })
        .expect(400);
    });

    it('should reject upgrade to same plan', async () => {
      await request(app.getHttpServer())
        .post('/subscriptions/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: freePlanId })
        .expect(400);
    });
  });

  describe('POST /subscriptions/downgrade - Downgrade Subscription', () => {
    beforeEach(async () => {
      // Set tenant to PRO
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionTier: 'PRO',
          subscriptionStatus: 'ACTIVE',
        },
      });
    });

    it('should create pending downgrade from PRO to FREE', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscriptions/downgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: freePlanId })
        .expect(201);

      expect(response.body.fromPlan).toBe('PRO');
      expect(response.body.toPlan).toBe('FREE');
      expect(response.body.status).toBe('PENDING');
    });

    it('should reject downgrade to higher tier', async () => {
      await request(app.getHttpServer())
        .post('/subscriptions/downgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: enterprisePlanId })
        .expect(400);
    });
  });

  describe('POST /subscriptions/cancel - Cancel Subscription', () => {
    beforeEach(async () => {
      // Set tenant to PRO
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionTier: 'PRO',
          subscriptionStatus: 'ACTIVE',
        },
      });
    });

    it('should cancel active subscription', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toContain('cancelled');

      // Verify cancellation was recorded
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(tenant.subscriptionStatus).toBe('CANCELLED');
    });

    it('should not cancel FREE plan', async () => {
      // Set back to FREE
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionTier: 'FREE' },
      });

      await request(app.getHttpServer())
        .post('/subscriptions/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /subscriptions/usage - Get Usage Stats', () => {
    beforeEach(async () => {
      // Create some users
      await Promise.all([
        prisma.user.create({
          data: {
            email: 'user1@test.com',
            password: 'hash',
            firstName: 'User',
            lastName: '1',
            role: 'WAITER',
            tenantId,
            emailVerified: true,
          },
        }),
        prisma.user.create({
          data: {
            email: 'user2@test.com',
            password: 'hash',
            firstName: 'User',
            lastName: '2',
            role: 'WAITER',
            tenantId,
            emailVerified: true,
          },
        }),
      ]);

      // Create category
      const category = await prisma.category.create({
        data: {
          name: 'Test Category',
          slug: 'test-category',
          isActive: true,
          tenantId,
        },
      });

      // Create some products
      await Promise.all([
        prisma.product.create({
          data: {
            name: 'Product 1',
            slug: 'product-1',
            price: 10,
            isAvailable: true,
            categoryId: category.id,
            tenantId,
          },
        }),
        prisma.product.create({
          data: {
            name: 'Product 2',
            slug: 'product-2',
            price: 20,
            isAvailable: true,
            categoryId: category.id,
            tenantId,
          },
        }),
      ]);
    });

    it('should get current usage statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/usage')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.currentPlan).toBe('FREE');
      expect(response.body.usage.users).toBe(3); // Original user + 2 created
      expect(response.body.usage.products).toBe(2);
      expect(response.body.limits.maxUsers).toBe(2);
      expect(response.body.limits.maxProducts).toBe(20);
    });

    it('should indicate when limits are exceeded', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscriptions/usage')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // User limit exceeded (3 users with max 2)
      expect(response.body.warnings).toContain('users');
    });
  });

  describe('Complete Subscription Upgrade Flow', () => {
    it('should handle full upgrade: request -> payment -> confirmation', async () => {
      // 1. Request upgrade
      const upgradeResponse = await request(app.getHttpServer())
        .post('/subscriptions/upgrade')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId: proPlanId })
        .expect(201);

      const pendingChangeId = upgradeResponse.body.id;
      expect(upgradeResponse.body.status).toBe('PENDING');

      // 2. Simulate payment confirmation (in real scenario, this comes from Stripe/Iyzico webhook)
      await prisma.subscriptionChange.update({
        where: { id: pendingChangeId },
        data: { status: 'COMPLETED' },
      });

      // 3. Apply the change
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionTier: 'PRO',
          subscriptionStatus: 'ACTIVE',
        },
      });

      // 4. Verify subscription was upgraded
      const response = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.subscriptionTier).toBe('PRO');
      expect(response.body.subscriptionStatus).toBe('ACTIVE');
    });
  });

  describe('Subscription Quota Enforcement', () => {
    it('should enforce user limit on FREE plan', async () => {
      // FREE plan max: 2 users
      // Already have 1 user from setup

      // Create first additional user (should succeed - total 2)
      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'user1@test.com',
          password: 'Password123!',
          firstName: 'User',
          lastName: 'One',
          role: 'WAITER',
        })
        .expect(201);

      // Create second additional user (should fail - exceeds limit)
      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'user2@test.com',
          password: 'Password123!',
          firstName: 'User',
          lastName: 'Two',
          role: 'WAITER',
        })
        .expect(402); // Payment required
    });
  });
});
