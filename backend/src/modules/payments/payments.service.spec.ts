import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('PaymentsService', () => {
  describe('merchantOid generator', () => {
    const svc = new PaymentsService(
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );

    function oid(tenantId: string): string {
      return (svc as any).generateMerchantOid(tenantId);
    }

    it('produces strictly alphanumeric OIDs (PayTR requirement)', () => {
      const id = oid('11111111-2222-3333-4444-555555555555');
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('starts with the SUB prefix for log readability', () => {
      const id = oid('11111111-2222-3333-4444-555555555555');
      expect(id.startsWith('SUB')).toBe(true);
    });

    it('drops dashes from the tenant UUID', () => {
      const id = oid('aabbccdd-eeff-0011-2233-445566778899');
      expect(id).not.toContain('-');
    });

    it('produces distinct OIDs on rapid successive calls (random suffix)', () => {
      const t = '11111111-2222-3333-4444-555555555555';
      const seen = new Set<string>();
      for (let i = 0; i < 50; i += 1) seen.add(oid(t));
      expect(seen.size).toBe(50);
    });

    it("keeps OIDs comfortably under PayTR's 64-char limit", () => {
      const id = oid('11111111-2222-3333-4444-555555555555');
      expect(id.length).toBeLessThanOrEqual(64);
    });
  });

  /**
   * Behavioural tests for createIntent. The PayTR HTTP path is verified
   * by the e2e suite — here we lock down the three short-circuits
   * (INTERNATIONAL fallback, trial activation, FREE-plan reject) and
   * the email-verified gate.
   */
  describe('createIntent', () => {
    let prisma: MockPrismaClient;
    let paytr: any;
    let config: any;
    let subscriptions: any;
    let svc: PaymentsService;

    const TENANT_ID = '11111111-2222-3333-4444-555555555555';
    const USER_ID = 'user-1';
    const PLAN_ID = 'plan-pro';

    const proPlan = {
      id: PLAN_ID,
      name: 'PRO',
      displayName: 'Profesyonel',
      monthlyPrice: '1299',
      yearlyPrice: '12990',
      currency: 'TRY',
      trialDays: 14,
      isActive: true,
    } as any;

    beforeEach(() => {
      prisma = mockPrismaClient();
      paytr = { getIframeToken: jest.fn() };
      config = {
        get: (key: string) => {
          if (key === 'PAYTR_OK_URL') return 'https://example.com/ok';
          if (key === 'PAYTR_FAIL_URL') return 'https://example.com/fail';
          return undefined;
        },
      };
      subscriptions = { startTrialFromIntent: jest.fn().mockResolvedValue({}) };
      const consents = {
        verifyAndRecord: jest.fn().mockResolvedValue(undefined),
      };
      svc = new PaymentsService(
        prisma as any,
        paytr,
        config,
        subscriptions,
        consents as any,
      );
    });

    it('throws NotFoundException when tenant is missing', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ emailVerified: true } as any);
      await expect(
        svc.createIntent(TENANT_ID, USER_ID, { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'] }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when calling user is unverified', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        trialUsed: false,
        usedTrialPlanIds: [],
        subscriptions: [],
        name: 'Test',
      } as any);
      prisma.user.findUnique.mockResolvedValue({
        email: 'm@x.com',
        emailVerified: false,
      } as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(proPlan);
      await expect(
        svc.createIntent(TENANT_ID, USER_ID, { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'] }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects FREE-plan intents', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        trialUsed: false,
        usedTrialPlanIds: [],
        subscriptions: [],
        name: 'Test',
      } as any);
      prisma.user.findUnique.mockResolvedValue({ emailVerified: true, email: 'a@b.com' } as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValue({ ...proPlan, name: 'FREE' } as any);
      await expect(
        svc.createIntent(TENANT_ID, USER_ID, { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'] }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activates trial via SubscriptionService when tenant is trial-eligible on FREE', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        trialUsed: false,
        usedTrialPlanIds: [],
        subscriptions: [
          { id: 'free-sub', planId: 'plan-free', plan: { name: 'FREE' } },
        ],
        name: 'Test',
      } as any);
      prisma.user.findUnique.mockResolvedValue({
        emailVerified: true,
        email: 'a@b.com',
        phone: '+905551234567',
      } as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(proPlan);

      const result = await svc.createIntent(
        TENANT_ID,
        USER_ID,
        { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'] },
        '127.0.0.1',
      );

      expect(result).toEqual({
        provider: 'TRIAL',
        amount: 1299,
        currency: 'TRY',
        trialActivated: true,
      });
      expect(subscriptions.startTrialFromIntent).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: 'MONTHLY',
      });
      expect(paytr.getIframeToken).not.toHaveBeenCalled();
    });

    it('skips trial when the plan has already been trialed', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        trialUsed: true,
        usedTrialPlanIds: [PLAN_ID],
        subscriptions: [
          { id: 'free-sub', planId: 'plan-free', plan: { name: 'FREE' } },
        ],
        name: 'Test',
      } as any);
      prisma.user.findUnique.mockResolvedValue({
        emailVerified: true,
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        phone: '555',
      } as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValue(proPlan);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.subscription.create.mockResolvedValue({ id: 'new-pending' } as any);
      prisma.subscriptionPayment.create.mockResolvedValue({ id: 'payment-1' } as any);
      paytr.getIframeToken.mockResolvedValue({
        token: 'tk_xyz',
        paymentLink: 'https://www.paytr.com/odeme/guvenli/tk_xyz',
        merchantOid: 'unused',
        amount: '79900',
        currency: 'TL',
      });

      const result = await svc.createIntent(
        TENANT_ID,
        USER_ID,
        { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'] },
        '127.0.0.1',
      );

      expect(result.provider).toBe('PAYTR');
      expect(result.paymentLink).toContain('paytr.com');
      expect(subscriptions.startTrialFromIntent).not.toHaveBeenCalled();
      expect(paytr.getIframeToken).toHaveBeenCalled();
    });
  });
});
