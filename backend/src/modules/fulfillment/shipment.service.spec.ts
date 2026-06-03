import { ShipmentService } from './shipment.service';
import { CatalogService } from '../catalog/catalog.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('ShipmentService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let catalog: jest.Mocked<CatalogService>;
  let svc: ShipmentService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    catalog = { markShipped: jest.fn().mockResolvedValue(undefined) } as any;
    svc = new ShipmentService(prisma as any, outbox as any, catalog);
  });

  it('createShipment refuses to ship draft / non-paid orders', async () => {
    prisma.hardwareOrder.findUnique.mockResolvedValue({ id: 'o-1', status: 'draft', items: [] } as any);
    await expect(svc.createShipment('o-1', { carrier: 'manual' })).rejects.toThrow(/Cannot ship/);
  });

  it('createShipment moves order to "shipped" only when trackingNo provided', async () => {
    prisma.hardwareOrder.findUnique.mockResolvedValue({
      id: 'o-1', status: 'paid', tenantId: 't1', items: [{ productId: 'p-1', qty: 2 }],
    } as any);
    (prisma.shipment.create as any).mockImplementation(async ({ data }: any) => ({ id: 's-1', ...data }));
    let orderUpdate: any = null;
    (prisma.hardwareOrder.update as any).mockImplementation(async ({ data }: any) => {
      orderUpdate = data;
      return { id: 'o-1', tenantId: 't1', ...data };
    });

    // With tracking number → 'shipped'.
    await svc.createShipment('o-1', { carrier: 'yurtici', trackingNo: 'YT-123' });
    expect(orderUpdate.status).toBe('shipped');
    expect(catalog.markShipped).toHaveBeenCalledWith('p-1', 2);

    // Without tracking → 'fulfillment'.
    orderUpdate = null;
    catalog.markShipped.mockClear();
    prisma.hardwareOrder.findUnique.mockResolvedValue({
      id: 'o-2', status: 'paid', tenantId: 't1', items: [{ productId: 'p-1', qty: 1 }],
    } as any);
    await svc.createShipment('o-2', { carrier: 'manual' });
    expect(orderUpdate.status).toBe('fulfillment');
  });

  it('markDelivered is idempotent on second call', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue({ id: 'o-1', tenantId: 't1' } as any);
    prisma.shipment.findUnique.mockResolvedValue({ id: 's-1', orderId: 'o-1', status: 'delivered' } as any);
    const out = await svc.markDelivered('s-1');
    expect(out.status).toBe('delivered');
    expect(outbox.append).not.toHaveBeenCalled();   // no duplicate event
  });

  it('markDelivered flips order to delivered and emits', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue({ id: 'o-1', tenantId: 't1' } as any);
    prisma.shipment.findUnique.mockResolvedValue({ id: 's-1', orderId: 'o-1', status: 'in_transit' } as any);
    (prisma.shipment.update as any).mockResolvedValue({ id: 's-1', status: 'delivered' });
    (prisma.hardwareOrder.update as any).mockResolvedValue({ id: 'o-1', tenantId: 't1', status: 'delivered' });
    await svc.markDelivered('s-1');
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hardware.order.delivered.v1' }),
    );
  });

  it('markDelivered scopes lookup to tenantId when provided (cross-tenant protection)', async () => {
    // Foreign tenant lookup must not find the shipment.
    prisma.hardwareOrder.findFirst.mockResolvedValue(null);
    await expect(svc.markDelivered('s-1', 'other-tenant')).rejects.toThrow(/Shipment not found/);
    expect(prisma.shipment.update).not.toHaveBeenCalled();
  });
});
