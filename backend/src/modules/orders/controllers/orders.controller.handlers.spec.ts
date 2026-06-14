import { OrdersController } from './orders.controller';
import { BranchScope } from '../../../common/scoping/branch-scope';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Thin-controller spec for the OrdersController handlers OTHER than
 * findAll (its query-validation branches live in
 * orders.controller.findAll.spec.ts). Every handler here forwards the
 * resolved BranchScope (v3 scoping) plus the path/body to the right
 * collaborator. A regression in which service a route targets — or in
 * the scope-forwarding contract that makes branch filtering work — fails
 * one of these.
 */
describe('OrdersController — handler forwarding', () => {
  let ordersService: Record<string, jest.Mock>;
  let orderTransferService: { transferTableOrders: jest.Mock };
  let paymentsService: { getGroupBillSummary: jest.Mock };
  let ctrl: OrdersController;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    ordersService = {
      create: jest.fn().mockResolvedValue({ id: 'o1' }),
      syncTableStatuses: jest.fn().mockResolvedValue({ synced: 3 }),
      findOne: jest.fn().mockResolvedValue({ id: 'o1' }),
      update: jest.fn().mockResolvedValue({ id: 'o1' }),
      updateStatus: jest.fn().mockResolvedValue({ id: 'o1' }),
      approveOrder: jest.fn().mockResolvedValue({ id: 'o1' }),
      remove: jest.fn().mockResolvedValue({ id: 'o1' }),
      removeItem: jest.fn().mockResolvedValue({ id: 'o1' }),
    };
    orderTransferService = {
      transferTableOrders: jest.fn().mockResolvedValue({ moved: 2 }),
    };
    paymentsService = {
      getGroupBillSummary: jest.fn().mockResolvedValue({ items: [] }),
    };
    ctrl = new OrdersController(
      ordersService as any,
      orderTransferService as any,
      paymentsService as any,
    );
  });

  it('create forwards the scope and dto (so branchId can be stamped for tableless orders)', () => {
    const dto = { type: 'DINE_IN' } as any;
    ctrl.create(dto, scope);
    expect(ordersService.create).toHaveBeenCalledWith(scope, dto);
  });

  it('transferTableOrders delegates to the transfer service with scope + dto', () => {
    const dto = { fromTableId: 'a', toTableId: 'b' } as any;
    ctrl.transferTableOrders(dto, scope);
    expect(orderTransferService.transferTableOrders).toHaveBeenCalledWith(
      scope,
      dto,
    );
  });

  it('syncTableStatuses forwards the scope', () => {
    ctrl.syncTableStatuses(scope);
    expect(ordersService.syncTableStatuses).toHaveBeenCalledWith(scope);
  });

  it('getGroupBillSummary delegates to paymentsService with scope + groupId', () => {
    ctrl.getGroupBillSummary('group-9', scope);
    expect(paymentsService.getGroupBillSummary).toHaveBeenCalledWith(
      scope,
      'group-9',
    );
  });

  it('findOne forwards scope + id', () => {
    ctrl.findOne('o1', scope);
    expect(ordersService.findOne).toHaveBeenCalledWith(scope, 'o1');
  });

  it('update forwards scope, id, dto', () => {
    const dto = { notes: 'x' } as any;
    ctrl.update('o1', dto, scope);
    expect(ordersService.update).toHaveBeenCalledWith(scope, 'o1', dto);
  });

  it('updateStatus forwards scope, id, dto', () => {
    const dto = { status: 'READY' } as any;
    ctrl.updateStatus('o1', dto, scope);
    expect(ordersService.updateStatus).toHaveBeenCalledWith(scope, 'o1', dto);
  });

  it('approveOrder forwards scope + id', () => {
    ctrl.approveOrder('o1', scope);
    expect(ordersService.approveOrder).toHaveBeenCalledWith(scope, 'o1');
  });

  it('remove forwards scope + id', () => {
    ctrl.remove('o1', scope);
    expect(ordersService.remove).toHaveBeenCalledWith(scope, 'o1');
  });

  it('removeItem forwards scope, orderId AND itemId (both path params)', () => {
    ctrl.removeItem('o1', 'item-3', scope);
    expect(ordersService.removeItem).toHaveBeenCalledWith(scope, 'o1', 'item-3');
  });

  it('returns the service result (passthrough)', async () => {
    await expect(ctrl.findOne('o1', scope)).resolves.toEqual({ id: 'o1' });
  });
});
