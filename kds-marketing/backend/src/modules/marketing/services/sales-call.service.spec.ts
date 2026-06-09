import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SalesCallService } from './sales-call.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

describe('SalesCallService', () => {
  let prisma: MockPrismaClient;
  let registry: { get: jest.Mock };
  let outbox: { append: jest.Mock };
  let config: { get: jest.Mock };
  let provider: any;
  let svc: SalesCallService;

  const REP = 'rep-1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    provider = {
      id: 'netgsm-lite',
      maxConcurrentCalls: 1,
      prepareOutboundCall: jest.fn().mockResolvedValue({
        providerId: 'netgsm-lite',
        dialUri: 'tel:+905551234567',
        mode: 'click-to-dial',
        externalCallId: null,
      }),
    };
    registry = { get: jest.fn().mockReturnValue(provider) };
    outbox = { append: jest.fn().mockResolvedValue('ob') };
    config = { get: jest.fn().mockReturnValue(undefined) };
    svc = new SalesCallService(prisma as any, registry as any, outbox as any, config as any);

    // Support both $transaction(callback) and $transaction([...]) forms.
    (prisma.$transaction as any).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    );
    prisma.salesCall.findMany.mockResolvedValue([]); // no active calls by default
    prisma.salesCall.create.mockResolvedValue({ id: 'call-1', status: 'INITIATED' } as any);
  });

  describe('startCall', () => {
    it('reserves the line and returns a click-to-dial URI', async () => {
      const res = await svc.startCall(REP, { toPhone: '05551234567' } as any);
      expect(res.dialUri).toBe('tel:+905551234567');
      expect(res.mode).toBe('click-to-dial');
      expect(prisma.salesCall.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            marketingUserId: REP,
            status: 'INITIATED',
            providerId: 'netgsm-lite',
            direction: 'OUTBOUND',
          }),
        }),
      );
    });

    it('rejects when the single line is busy (a fresh INITIATED call exists)', async () => {
      prisma.salesCall.findMany.mockResolvedValue([{ id: 'c0', startedAt: new Date() }] as any);
      await expect(svc.startCall(REP, { toPhone: '05551234567' } as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.salesCall.create).not.toHaveBeenCalled();
    });

    it('auto-cancels a stale INITIATED call and proceeds', async () => {
      prisma.salesCall.findMany.mockResolvedValue([
        { id: 'c-stale', startedAt: new Date(Date.now() - 60 * 60 * 1000) },
      ] as any);
      prisma.salesCall.updateMany.mockResolvedValue({ count: 1 } as any);

      await svc.startCall(REP, { toPhone: '05551234567' } as any);

      expect(prisma.salesCall.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['c-stale'] } },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(prisma.salesCall.create).toHaveBeenCalled();
    });

    it('rejects when the linked lead does not exist', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);
      await expect(
        svc.startCall(REP, { toPhone: '05551234567', leadId: 'lead-x' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('logCall', () => {
    it('records the outcome, mirrors a CALL activity onto the lead, and emits the event', async () => {
      prisma.salesCall.findUnique.mockResolvedValue({
        id: 'call-1',
        marketingUserId: REP,
        status: 'INITIATED',
        leadId: 'lead-1',
      } as any);
      prisma.salesCall.update.mockResolvedValue({ id: 'call-1', status: 'CONNECTED' } as any);

      await svc.logCall('call-1', REP, {
        status: 'CONNECTED',
        durationSec: 120,
        notes: 'good chat',
      } as any);

      expect(prisma.salesCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'call-1' },
          data: expect.objectContaining({ status: 'CONNECTED', durationSec: 120, endedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CALL',
            leadId: 'lead-1',
            outcome: 'POSITIVE',
            duration: 2, // 120s → 2 min
            createdById: REP,
          }),
        }),
      );
      expect(outbox.append.mock.calls[0][0]).toMatchObject({
        type: 'marketing.call.logged.v1',
        idempotencyKey: 'call-logged:call-1',
        payload: expect.objectContaining({ callId: 'call-1', status: 'CONNECTED', durationSec: 120 }),
      });
    });

    it("rejects logging another rep's call", async () => {
      prisma.salesCall.findUnique.mockResolvedValue({
        id: 'call-1',
        marketingUserId: 'other',
        status: 'INITIATED',
        leadId: null,
      } as any);
      await expect(
        svc.logCall('call-1', REP, { status: 'CONNECTED' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects logging an already-logged call', async () => {
      prisma.salesCall.findUnique.mockResolvedValue({
        id: 'call-1',
        marketingUserId: REP,
        status: 'CONNECTED',
        leadId: null,
      } as any);
      await expect(
        svc.logCall('call-1', REP, { status: 'NO_ANSWER' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('list', () => {
    it('scopes a SALES_REP to their own calls', async () => {
      prisma.salesCall.findMany.mockResolvedValue([]);
      prisma.salesCall.count.mockResolvedValue(0);
      await svc.list({} as any, { id: REP, role: 'SALES_REP' } as any);
      expect(prisma.salesCall.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { marketingUserId: REP } }),
      );
    });
  });
});
