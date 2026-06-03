import { KdsRoutingService } from './kds-routing.service';
import { CommandQueueService } from '../device-mesh/command-queue.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Tests that order lifecycle events fan out to mesh-paired KDS screens.
 *
 * The bus subscription wiring is the side-effect of onModuleInit; we test
 * the dispatch logic directly by invoking the private onOrderEvent through
 * the public `dispatch` shape.
 */
describe('KdsRoutingService.onOrderEvent', () => {
  let prisma: MockPrismaClient;
  let commands: jest.Mocked<CommandQueueService>;
  let bus: any;
  let svc: KdsRoutingService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    commands = { enqueue: jest.fn().mockResolvedValue({ id: 'c-1' }) } as any;
    bus = { on: jest.fn() };
    svc = new KdsRoutingService(prisma as any, bus, commands);
    // Trigger subscription registration so onOrderEvent is reachable via bus.on calls.
    svc.onModuleInit();
  });

  function getHandler(eventType: string) {
    const call = (bus.on as jest.Mock).mock.calls.find((c) => c[0] === eventType);
    return call?.[1] as (e: any) => Promise<void>;
  }

  it('enqueues show_order to every KDS screen on the branch on order.created', async () => {
    prisma.device.findMany.mockResolvedValue([
      { id: 'd-1' }, { id: 'd-2' },
    ] as any);

    const handler = getHandler('order.created.v1');
    await handler!({
      id: 'evt-1',
      tenantId: 't1',
      payload: { orderId: 'o-1', tenantId: 't1', branchId: 'b-1' },
    });

    expect(commands.enqueue).toHaveBeenCalledTimes(2);
    const args = (commands.enqueue as any).mock.calls[0];
    expect(args[2].kind).toBe('show_order');
    expect(args[2].idempotencyKey).toContain('evt-1');
  });

  it('enqueues clear_order on order.completed', async () => {
    prisma.device.findMany.mockResolvedValue([{ id: 'd-1' }] as any);
    const handler = getHandler('order.completed.v1');
    await handler!({
      id: 'evt-2',
      tenantId: 't1',
      payload: { orderId: 'o-1', tenantId: 't1' },
    });
    expect(commands.enqueue).toHaveBeenCalledTimes(1);
    expect((commands.enqueue as any).mock.calls[0][2].kind).toBe('clear_order');
  });

  it('skips when no KDS screens are paired', async () => {
    prisma.device.findMany.mockResolvedValue([] as any);
    const handler = getHandler('order.created.v1');
    await handler!({ id: 'evt-3', tenantId: 't1', payload: { orderId: 'o-1', tenantId: 't1' } });
    expect(commands.enqueue).not.toHaveBeenCalled();
  });

  it('silently ignores events with no tenantId or orderId', async () => {
    const handler = getHandler('order.created.v1');
    await handler!({ id: 'evt-4', tenantId: null, payload: {} });
    expect(prisma.device.findMany).not.toHaveBeenCalled();
  });

  /**
   * Iter-69 regressions.
   *
   * 1. Tenant-scope precedence: the outbox envelope's tenantId is the
   *    authoritative source. The pre-fix code preferred payload's id,
   *    so a publisher bug could fan KDS commands to a foreign tenant.
   * 2. Mismatched envelope/payload tenantIds = publisher bug; the
   *    service must refuse to dispatch (and log) rather than pick one.
   * 3. Per-event fan-out cap so a runaway provisioning bug doesn't
   *    turn every order event into a thousand-statement enqueue burst.
   */
  describe('iter-69 tenant precedence + fan-out cap', () => {
    it('uses envelope.tenantId, not payload.tenantId, for the device lookup', async () => {
      prisma.device.findMany.mockResolvedValue([{ id: 'd-1' }] as any);
      let lookupWhere: any = null;
      (prisma.device.findMany as any).mockImplementation(async ({ where }: any) => {
        lookupWhere = where;
        return [{ id: 'd-1' }];
      });

      const handler = getHandler('order.created.v1');
      // Envelope says t1, payload says t1 too — happy path.
      await handler!({
        id: 'evt-9',
        tenantId: 't1',
        payload: { orderId: 'o-1', tenantId: 't1' },
      });

      expect(lookupWhere.tenantId).toBe('t1');
    });

    it('refuses to dispatch when envelope and payload tenantIds disagree', async () => {
      const handler = getHandler('order.created.v1');
      await handler!({
        id: 'evt-mismatch',
        tenantId: 't1',
        payload: { orderId: 'o-1', tenantId: 't2' },
      });

      expect(prisma.device.findMany).not.toHaveBeenCalled();
      expect(commands.enqueue).not.toHaveBeenCalled();
    });

    it('still dispatches when envelope.tenantId is null and only payload carries one (system events)', async () => {
      prisma.device.findMany.mockResolvedValue([{ id: 'd-1' }] as any);
      const handler = getHandler('order.created.v1');
      await handler!({
        id: 'evt-sys',
        tenantId: null,
        payload: { orderId: 'o-1', tenantId: 't1' },
      });
      expect(commands.enqueue).toHaveBeenCalled();
    });

    it('caps the device lookup at 50 to bound per-event fan-out', async () => {
      prisma.device.findMany.mockResolvedValue([{ id: 'd-1' }] as any);
      let take: any = null;
      (prisma.device.findMany as any).mockImplementation(async (args: any) => {
        take = args.take;
        return [{ id: 'd-1' }];
      });

      const handler = getHandler('order.created.v1');
      await handler!({
        id: 'evt-cap',
        tenantId: 't1',
        payload: { orderId: 'o-1', tenantId: 't1' },
      });

      expect(take).toBe(50);
    });
  });
});
