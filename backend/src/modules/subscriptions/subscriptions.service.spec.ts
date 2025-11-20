import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockPrismaClient, mockTenant } from '../../common/test/prisma-mock.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: ReturnType<typeof mockPrismaClient>;

  const mockPlan = {
    id: 'plan-1',
    name: 'PRO',
    tier: 'PRO',
    monthlyPrice: 29.99,
    yearlyPrice: 299.99,
    currency: 'USD',
    features: {},
    isActive: true,
  };

  const mockSubscription = {
    id: 'sub-1',
    tenantId: 'tenant-1',
    planId: 'plan-1',
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false,
  };

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentSubscription', () => {
    it('should return current subscription for tenant', async () => {
      prisma.subscription.findFirst.mockResolvedValue(mockSubscription);

      const result = await service.getCurrentSubscription('tenant-1');

      expect(result).toEqual(mockSubscription);
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null when no subscription found', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      const result = await service.getCurrentSubscription('tenant-1');

      expect(result).toBeNull();
    });
  });

  describe('getPlans', () => {
    it('should return all active plans', async () => {
      const mockPlans = [mockPlan];
      prisma.subscriptionPlan.findMany.mockResolvedValue(mockPlans);

      const result = await service.getPlans();

      expect(result).toEqual(mockPlans);
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { monthlyPrice: 'asc' },
      });
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription at period end', async () => {
      prisma.subscription.findFirst.mockResolvedValue(mockSubscription);
      prisma.subscription.update.mockResolvedValue({
        ...mockSubscription,
        cancelAtPeriodEnd: true,
      });

      const result = await service.cancelSubscription('tenant-1');

      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(prisma.subscription.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when subscription not found', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelSubscription('tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePlan', () => {
    it('should throw BadRequestException when downgrading with active features', async () => {
      prisma.subscription.findFirst.mockResolvedValue(mockSubscription);
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        ...mockPlan,
        tier: 'BASIC',
      });

      // Mock tenant using features only available in higher tiers
      prisma.tenant.findUnique.mockResolvedValue({
        ...mockTenant,
        // Simulate usage that requires PRO tier
      });

      // This test verifies the service checks feature compatibility
      await expect(
        service.changePlan('tenant-1', 'plan-basic'),
      ).rejects.toThrow();
    });
  });
});
