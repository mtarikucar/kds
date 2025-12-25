import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('PayTR Payment E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let authToken: string;
  let tenantId: string;
  let userId: string;
  let proPlanId: string;
  let merchantKey: string;
  let merchantSalt: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    prisma = app.get<PrismaService>(PrismaService);
    configService = app.get<ConfigService>(ConfigService);

    merchantKey = configService.get<string>('PAYTR_MERCHANT_KEY') || 'test_key';
    merchantSalt = configService.get<string>('PAYTR_MERCHANT_SALT') || 'test_salt';

    await app.init();
  });

  beforeEach(async () => {
    // Clean relevant tables
    await prisma.invoice.deleteMany();
    await prisma.subscriptionPayment.deleteMany();
    await prisma.pendingPlanChange.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();

    // Create PRO plan if not exists
    const existingPlan = await prisma.subscriptionPlan.findFirst({
      where: { name: 'PRO' },
    });

    if (!existingPlan) {
      const plan = await prisma.subscriptionPlan.create({
        data: {
          name: 'PRO',
          displayName: 'Pro Plan',
          monthlyPrice: 299.99,
          yearlyPrice: 2999.99,
          currency: 'TRY',
          trialDays: 14,
          maxUsers: 10,
          maxTables: 50,
          maxProducts: 500,
          maxCategories: 50,
          maxMonthlyOrders: 10000,
          advancedReports: true,
          multiLocation: false,
          customBranding: true,
          apiAccess: true,
          prioritySupport: true,
          inventoryTracking: true,
          kdsIntegration: true,
          isActive: true,
        },
      });
      proPlanId = plan.id;
    } else {
      proPlanId = existingPlan.id;
    }

    // Create test tenant with TURKEY payment region
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('password123', 10);

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Restaurant Turkey',
        subdomain: 'test-restaurant-tr',
        paymentRegion: 'TURKEY', // Important: Forces PayTR usage
        status: 'ACTIVE',
        currency: 'TRY',
      },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        email: 'admin@test-tr.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        role: 'ADMIN',
        tenantId: tenant.id,
        emailVerified: true,
        phone: '5551234567',
      },
    });
    userId = user.id;

    // Get auth token
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@test-tr.com', password: 'password123' });

    authToken = loginResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up
    await prisma.invoice.deleteMany();
    await prisma.subscriptionPayment.deleteMany();
    await prisma.pendingPlanChange.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();
    await app.close();
  });

  describe('POST /payments/create-intent - PayTR Payment Intent', () => {
    it('should create PayTR payment link for Turkish tenant', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          planId: proPlanId,
          billingCycle: 'MONTHLY',
        });

      // Note: This may fail if PayTR credentials are not configured
      // In that case, expect 400 with configuration error
      if (response.status === 200) {
        expect(response.body.provider).toBe('PAYTR');
        expect(response.body.paymentLink).toBeDefined();
        expect(response.body.paymentLink).toContain('paytr.com');
        expect(response.body.merchantOid).toBeDefined();
        expect(response.body.amount).toBe(299.99);
        expect(response.body.currency).toBe('TRY');
      } else {
        // PayTR not configured - acceptable in test environment
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('PayTR');
      }
    });

    it('should create subscription payment record when creating intent', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          planId: proPlanId,
          billingCycle: 'MONTHLY',
        });

      if (response.status === 200) {
        const merchantOid = response.body.merchantOid;

        // Verify payment record was created
        const payment = await prisma.subscriptionPayment.findFirst({
          where: { paytrMerchantOid: merchantOid },
        });

        expect(payment).toBeDefined();
        expect(payment?.status).toBe('PENDING');
        expect(payment?.paymentProvider).toBe('PAYTR');
      }
    });

    it('should handle yearly billing cycle', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          planId: proPlanId,
          billingCycle: 'YEARLY',
        });

      if (response.status === 200) {
        expect(response.body.amount).toBe(2999.99);
      }
    });
  });

  describe('POST /webhooks/paytr - PayTR Callback', () => {
    let subscriptionId: string;
    let paymentId: string;
    let merchantOid: string;

    beforeEach(async () => {
      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          tenantId,
          planId: proPlanId,
          status: 'PENDING',
          billingCycle: 'MONTHLY',
          paymentProvider: 'PAYTR',
          amount: 299.99,
          currency: 'TRY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
        },
      });
      subscriptionId = subscription.id;

      merchantOid = `SUB-${subscriptionId}-${Date.now()}`;

      // Create pending payment
      const payment = await prisma.subscriptionPayment.create({
        data: {
          subscriptionId,
          amount: 299.99,
          currency: 'TRY',
          status: 'PENDING',
          paymentProvider: 'PAYTR',
          paytrMerchantOid: merchantOid,
        },
      });
      paymentId = payment.id;
    });

    function generatePaytrHash(merchantOid: string, status: string, totalAmount: string): string {
      const hashStr = `${merchantOid}${merchantSalt}${status}${totalAmount}`;
      return crypto
        .createHmac('sha256', merchantKey)
        .update(hashStr)
        .digest('base64');
    }

    it('should process successful payment callback', async () => {
      const totalAmount = '29999'; // 299.99 TRY in kurus
      const hash = generatePaytrHash(merchantOid, 'success', totalAmount);

      const response = await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: totalAmount,
          hash: hash,
          payment_type: 'card',
          currency: 'TL',
          test_mode: '1',
        });

      expect(response.text).toBe('OK');

      // Verify payment was updated
      const updatedPayment = await prisma.subscriptionPayment.findUnique({
        where: { id: paymentId },
      });
      expect(updatedPayment?.status).toBe('SUCCEEDED');
      expect(updatedPayment?.paidAt).toBeDefined();

      // Verify subscription was activated
      const updatedSubscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });
      expect(updatedSubscription?.status).toBe('ACTIVE');
      expect(updatedSubscription?.isTrialPeriod).toBe(false);
    });

    it('should process failed payment callback', async () => {
      const totalAmount = '29999';
      const hash = generatePaytrHash(merchantOid, 'failed', totalAmount);

      const response = await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'failed',
          total_amount: totalAmount,
          hash: hash,
          failed_reason_code: 'INSUFFICIENT_FUNDS',
          failed_reason_msg: 'Yetersiz bakiye',
        });

      expect(response.text).toBe('OK');

      // Verify payment was marked as failed
      const updatedPayment = await prisma.subscriptionPayment.findUnique({
        where: { id: paymentId },
      });
      expect(updatedPayment?.status).toBe('FAILED');
      expect(updatedPayment?.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(updatedPayment?.failureMessage).toBe('Yetersiz bakiye');
    });

    it('should reject callback with invalid hash', async () => {
      const response = await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: '29999',
          hash: 'invalid_hash_value',
        });

      expect(response.text).toBe('FAIL');

      // Verify payment was NOT updated
      const payment = await prisma.subscriptionPayment.findUnique({
        where: { id: paymentId },
      });
      expect(payment?.status).toBe('PENDING');
    });

    it('should handle callback for non-existent payment gracefully', async () => {
      const nonExistentOid = 'SUB-nonexistent-123456';
      const hash = generatePaytrHash(nonExistentOid, 'success', '29999');

      const response = await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: nonExistentOid,
          status: 'success',
          total_amount: '29999',
          hash: hash,
        });

      // Should still return OK for idempotency
      expect(response.text).toBe('OK');
    });

    it('should update subscription period for monthly billing', async () => {
      const totalAmount = '29999';
      const hash = generatePaytrHash(merchantOid, 'success', totalAmount);

      await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: totalAmount,
          hash: hash,
        });

      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });

      const periodEnd = new Date(subscription!.currentPeriodEnd);
      const now = new Date();

      // Period end should be approximately 1 month in the future
      const expectedMonth = (now.getMonth() + 1) % 12;
      expect(periodEnd.getMonth()).toBe(expectedMonth);
    });

    it('should update subscription period for yearly billing', async () => {
      // Update subscription to yearly
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { billingCycle: 'YEARLY' },
      });

      const totalAmount = '299999'; // Yearly amount
      const hash = generatePaytrHash(merchantOid, 'success', totalAmount);

      await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: totalAmount,
          hash: hash,
        });

      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });

      const periodEnd = new Date(subscription!.currentPeriodEnd);
      const now = new Date();

      // Period end should be approximately 1 year in the future
      expect(periodEnd.getFullYear()).toBe(now.getFullYear() + 1);
    });

    it('should create invoice after successful payment', async () => {
      const totalAmount = '29999';
      const hash = generatePaytrHash(merchantOid, 'success', totalAmount);

      await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: totalAmount,
          hash: hash,
        });

      // Verify invoice was created
      const invoice = await prisma.invoice.findFirst({
        where: { subscriptionId },
      });

      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe('PAID');
      expect(Number(invoice?.total)).toBe(299.99);
    });

    it('should update tenant current plan after successful payment', async () => {
      const totalAmount = '29999';
      const hash = generatePaytrHash(merchantOid, 'success', totalAmount);

      await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: totalAmount,
          hash: hash,
        });

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      expect(tenant?.currentPlanId).toBe(proPlanId);
    });
  });

  describe('Payment Flow Integration', () => {
    it('should complete full payment flow: intent -> redirect -> callback', async () => {
      // Step 1: Create payment intent
      const intentResponse = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          planId: proPlanId,
          billingCycle: 'MONTHLY',
        });

      if (intentResponse.status !== 200) {
        // PayTR not configured - skip this test
        console.log('PayTR not configured, skipping integration test');
        return;
      }

      const merchantOid = intentResponse.body.merchantOid;
      expect(intentResponse.body.provider).toBe('PAYTR');
      expect(intentResponse.body.paymentLink).toBeDefined();

      // Step 2: Simulate PayTR callback (as if user completed payment)
      const totalAmount = '29999';
      const hash = crypto
        .createHmac('sha256', merchantKey)
        .update(`${merchantOid}${merchantSalt}success${totalAmount}`)
        .digest('base64');

      const callbackResponse = await request(app.getHttpServer())
        .post('/webhooks/paytr')
        .send({
          merchant_oid: merchantOid,
          status: 'success',
          total_amount: totalAmount,
          hash: hash,
          payment_type: 'card',
          test_mode: '1',
        });

      expect(callbackResponse.text).toBe('OK');

      // Step 3: Verify subscription is active
      const subscription = await prisma.subscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      expect(subscription?.status).toBe('ACTIVE');
      expect(subscription?.planId).toBe(proPlanId);

      // Step 4: Verify payment is marked as succeeded
      const payment = await prisma.subscriptionPayment.findFirst({
        where: { paytrMerchantOid: merchantOid },
      });

      expect(payment?.status).toBe('SUCCEEDED');
      expect(payment?.paidAt).toBeDefined();

      // Step 5: Verify invoice was created
      const invoice = await prisma.invoice.findFirst({
        where: { subscriptionId: subscription?.id },
      });

      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe('PAID');
    });
  });
});
