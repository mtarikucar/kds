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
});
