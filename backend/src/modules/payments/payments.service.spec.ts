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
   * Testability adoption (wave-t1/be-clock-id-infra). merchantOid used to be
   * non-deterministic — it folded in Date.now() and crypto.randomBytes() — so
   * the legacy spec above can only assert *shape* (alphanumeric, prefix,
   * distinctness), never the exact value. By injecting a fixed Clock + a stub
   * IdGenerator we pin both ambient inputs and assert the OID byte-for-byte.
   * This is the proof that the DI refactor made the generator deterministic
   * while leaving the production code path (SystemClock/SystemIdGenerator
   * defaults) byte-identical to the old inline implementation.
   */
  describe('merchantOid is deterministic under injected clock + id', () => {
    // (1700000000000).toString(36) === 'loyw3v28' — see the generator: it
    // base36-encodes nowMs(). Pinning the clock pins this segment.
    const FIXED_MS = 1_700_000_000_000;
    const FIXED_HEX = 'abc123'; // what the stub IdGenerator.randomHex returns

    const fixedClock = {
      now: () => new Date(FIXED_MS),
      nowMs: () => FIXED_MS,
    };
    const fixedIdGen = {
      uuid: () => 'fixed-uuid',
      randomHex: (_bytes: number) => FIXED_HEX,
    };

    function svcWithFixedTime() {
      return new PaymentsService(
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any, // metrics (@Optional)
        fixedClock as any,
        fixedIdGen as any,
      );
    }

    function oid(tenantId: string): string {
      return (svcWithFixedTime() as any).generateMerchantOid(tenantId);
    }

    it('produces the exact expected OID for a known tenant', () => {
      const id = oid('11111111-2222-3333-4444-555555555555');
      // SUB + tenantHex(12) + base36(FIXED_MS) + FIXED_HEX
      expect(id).toBe('SUB111111112222loyw3v28abc123');
    });

    it('is stable across repeated calls (no hidden randomness left)', () => {
      const t = '11111111-2222-3333-4444-555555555555';
      const a = oid(t);
      const b = oid(t);
      expect(a).toBe(b);
    });

    it('still satisfies the PayTR alphanumeric + prefix contract', () => {
      const id = oid('aabbccdd-eeff-0011-2233-445566778899');
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
      expect(id.startsWith('SUB')).toBe(true);
    });

    it('threads the injected randomHex output into the OID suffix', () => {
      const id = oid('11111111-2222-3333-4444-555555555555');
      expect(id.endsWith(FIXED_HEX)).toBe(true);
    });
  });

  /**
   * Behaviour-preservation guard: a service constructed WITHOUT the new
   * clock/id args (the legacy positional shape used elsewhere) must still
   * generate valid OIDs via the self-constructed SystemClock/SystemIdGenerator
   * defaults — proving the @Optional fallback keeps the old construction sites
   * working and byte-compatible with the pre-DI code path.
   */
  describe('merchantOid falls back to real clock/id when not injected', () => {
    const svc = new PaymentsService(
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );

    it('produces a valid OID with the default (real) collaborators', () => {
      const id = (svc as any).generateMerchantOid(
        '11111111-2222-3333-4444-555555555555',
      );
      expect(id).toMatch(/^SUB[A-Za-z0-9]+$/);
      // 6 hex chars of real randomness on the end → distinct across calls.
      const id2 = (svc as any).generateMerchantOid(
        '11111111-2222-3333-4444-555555555555',
      );
      expect(id).not.toBe(id2);
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
    let referralDirectory: { resolveReferralCode: jest.Mock };
    let metrics: { incCounter: jest.Mock };
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
      referralDirectory = {
        resolveReferralCode: jest.fn().mockResolvedValue(null),
      };
      metrics = { incCounter: jest.fn() };
      svc = new PaymentsService(
        prisma as any,
        paytr,
        config,
        subscriptions,
        consents as any,
        referralDirectory as any,
        metrics as any,
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
      expect(metrics.incCounter).toHaveBeenCalledWith(
        'payment_intents_total',
        expect.any(String),
        { result: 'created' },
      );
    });

    /**
     * Iter-67 regression. Reported by the user as "199 $ olan şeyi 199
     * TL olarak satın alıyor". A plan denominated in USD would have
     * passed through createIntent untouched — the SubscriptionPayment
     * row would have been reserved with currency=USD and PayTR then
     * silently collected the same numeric amount in TL because the
     * adapter hardcoded `currency=TL` on the wire. This suite locks
     * the pre-check so a non-TRY plan refuses BEFORE any DB write or
     * PayTR HTTP call.
     */
    describe('currency safety gate (iter-67)', () => {
      it('refuses a USD plan with the canonical error code (no DB writes, no PayTR call)', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
          id: TENANT_ID,
          trialUsed: true,
          usedTrialPlanIds: [PLAN_ID],
          subscriptions: [{ id: 'free-sub', planId: 'plan-free', plan: { name: 'FREE' } }],
          name: 'Test',
        } as any);
        prisma.user.findUnique.mockResolvedValue({
          emailVerified: true,
          email: 'a@b.com',
          phone: '+905551234567',
        } as any);
        prisma.subscriptionPlan.findUnique.mockResolvedValue({
          ...proPlan,
          currency: 'USD',
        });

        await expect(
          svc.createIntent(
            TENANT_ID,
            USER_ID,
            {
              planId: PLAN_ID,
              billingCycle: 'MONTHLY',
              acceptedDocumentIds: [
                '11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222',
                '33333333-3333-3333-3333-333333333333',
              ],
            },
            '127.0.0.1',
          ),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            errorCode: 'PAYTR_ONLY_SUPPORTS_TRY',
          }),
        });

        expect(paytr.getIframeToken).not.toHaveBeenCalled();
        expect(prisma.subscriptionPayment.create as any).not.toHaveBeenCalled();
        expect(prisma.subscription.create as any).not.toHaveBeenCalled();
      });

      it('passes the plan.currency through to the adapter on the TRY happy path', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
          id: TENANT_ID,
          trialUsed: true,
          usedTrialPlanIds: [PLAN_ID],
          subscriptions: [{ id: 'free-sub', planId: 'plan-free', plan: { name: 'FREE' } }],
          name: 'Test',
        } as any);
        prisma.user.findUnique.mockResolvedValue({
          emailVerified: true,
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          phone: '+905551234567',
        } as any);
        prisma.subscriptionPlan.findUnique.mockResolvedValue(proPlan);
        prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
        prisma.subscription.create.mockResolvedValue({ id: 'new-pending' } as any);
        prisma.subscriptionPayment.create.mockResolvedValue({ id: 'payment-1' } as any);
        paytr.getIframeToken.mockResolvedValue({
          token: 'tk',
          paymentLink: 'https://www.paytr.com/odeme/guvenli/tk',
          merchantOid: 'x',
          amount: '129900',
          currency: 'TL',
        });

        await svc.createIntent(
          TENANT_ID,
          USER_ID,
          {
            planId: PLAN_ID,
            billingCycle: 'MONTHLY',
            acceptedDocumentIds: [
              '11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333',
            ],
          },
          '127.0.0.1',
        );

        // Load-bearing assertion: the adapter must receive the source
        // currency, not a hardcoded default. If a future refactor drops
        // this argument the adapter-level gate is the last defence.
        expect(paytr.getIframeToken).toHaveBeenCalledWith(
          expect.objectContaining({ currency: 'TRY' }),
        );
      });
    });

    /**
     * Step B referral-resolve wiring. The marketer code rides the checkout
     * body, is resolved via the ReferralDirectoryPort, and the RESOLVED code +
     * marketerId are snapshotted onto the SubscriptionPayment row. A bad code
     * must never block checkout.
     */
    describe('referral attribution snapshot', () => {
      const docIds = [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
      ];

      function arrangePaidFlow() {
        prisma.tenant.findUnique.mockResolvedValue({
          id: TENANT_ID,
          trialUsed: true,
          usedTrialPlanIds: [PLAN_ID],
          subscriptions: [{ id: 'free-sub', planId: 'plan-free', plan: { name: 'FREE' } }],
          name: 'Test',
        } as any);
        prisma.user.findUnique.mockResolvedValue({
          emailVerified: true,
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          phone: '+905551234567',
        } as any);
        prisma.subscriptionPlan.findUnique.mockResolvedValue(proPlan);
        prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
        prisma.subscription.create.mockResolvedValue({ id: 'new-pending' } as any);
        prisma.subscriptionPayment.create.mockResolvedValue({ id: 'payment-1' } as any);
        paytr.getIframeToken.mockResolvedValue({
          token: 'tk',
          paymentLink: 'https://www.paytr.com/odeme/guvenli/tk',
          merchantOid: 'x',
          amount: '129900',
          currency: 'TL',
        });
      }

      it('snapshots the resolved marketer onto the payment row', async () => {
        arrangePaidFlow();
        referralDirectory.resolveReferralCode.mockResolvedValue({
          marketingUserId: 'm-1',
          referralCode: 'AHMET42',
        });

        await svc.createIntent(
          TENANT_ID,
          USER_ID,
          { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds, referralCode: 'AHMET42' },
          '127.0.0.1',
        );

        expect(referralDirectory.resolveReferralCode).toHaveBeenCalledWith('AHMET42');
        expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              referralCode: 'AHMET42',
              referredByMarketingUserId: 'm-1',
            }),
          }),
        );
      });

      it('snapshots nulls for an unknown code and still completes checkout', async () => {
        arrangePaidFlow();
        referralDirectory.resolveReferralCode.mockResolvedValue(null);

        const result = await svc.createIntent(
          TENANT_ID,
          USER_ID,
          { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds, referralCode: 'NOPE' },
          '127.0.0.1',
        );

        expect(result.provider).toBe('PAYTR');
        expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              referralCode: null,
              referredByMarketingUserId: null,
            }),
          }),
        );
      });

      it('does not resolve when no referral code is supplied', async () => {
        arrangePaidFlow();

        await svc.createIntent(
          TENANT_ID,
          USER_ID,
          { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds },
          '127.0.0.1',
        );

        expect(referralDirectory.resolveReferralCode).not.toHaveBeenCalled();
        expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              referralCode: null,
              referredByMarketingUserId: null,
            }),
          }),
        );
      });
    });
  });
});
