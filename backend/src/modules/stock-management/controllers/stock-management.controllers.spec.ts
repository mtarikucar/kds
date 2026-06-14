import { StockItemsController } from './stock-items.controller';
import { StockItemCategoriesController } from './stock-item-categories.controller';
import { SuppliersController } from './suppliers.controller';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { RecipesController } from './recipes.controller';
import { StockCountsController } from './stock-counts.controller';
import { WasteLogsController } from './waste-logs.controller';
import { IngredientMovementsController } from './ingredient-movements.controller';
import { StockDashboardController } from './stock-dashboard.controller';
import { StockSettingsController } from './stock-settings.controller';
import { BranchScope } from '../../../common/scoping/branch-scope';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Thin-controller specs for the stock-management controller surface. These
 * are tenant-scoped forwarders (tenantId off req; create paths stamp
 * scope.branchId, and PO/count/waste paths attach req.user.id as the actor).
 * The parse-heavy handlers (findExpiringSoon days, recipes findAll/checkStock)
 * additionally assert int parsing + NaN→default fallback.
 */
const scope: BranchScope = {
  tenantId: 't1',
  branchId: 'b1',
  userId: 'u1',
  role: UserRole.MANAGER,
};
const req = { tenantId: 't1', user: { id: 'u1' } };

function mocks(...names: string[]): Record<string, jest.Mock> {
  return names.reduce((acc, n) => {
    acc[n] = jest.fn().mockResolvedValue({ ok: true });
    return acc;
  }, {} as Record<string, jest.Mock>);
}

describe('StockItemsController', () => {
  const svc = mocks(
    'findAll',
    'findLowStockItems',
    'findExpiringSoon',
    'findOne',
    'create',
    'update',
    'remove',
  );
  const ctrl = new StockItemsController(svc as any);

  it('findAll forwards tenantId + query', () => {
    const q = { search: 'x' } as any;
    ctrl.findAll(req as any, q);
    expect(svc.findAll).toHaveBeenCalledWith('t1', q);
  });
  it('findLowStock forwards tenantId', () => {
    ctrl.findLowStock(req as any);
    expect(svc.findLowStockItems).toHaveBeenCalledWith('t1');
  });
  it('findExpiringSoon parses days', () => {
    ctrl.findExpiringSoon(req as any, '7');
    expect(svc.findExpiringSoon).toHaveBeenCalledWith('t1', 7);
  });
  it('findExpiringSoon passes undefined when days omitted', () => {
    ctrl.findExpiringSoon(req as any);
    expect(svc.findExpiringSoon).toHaveBeenCalledWith('t1', undefined);
  });
  it('create stamps scope.branchId', () => {
    const dto = { name: 'Flour' } as any;
    ctrl.create(dto, req as any, scope);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1', 'b1');
  });
  it('update forwards id, dto, tenantId', () => {
    const dto = { isActive: false } as any;
    ctrl.update('s1', dto, req as any);
    expect(svc.update).toHaveBeenCalledWith('s1', dto, 't1');
  });
  it('remove forwards id + tenantId', () => {
    ctrl.remove('s1', req as any);
    expect(svc.remove).toHaveBeenCalledWith('s1', 't1');
  });
});

describe('StockItemCategoriesController', () => {
  const svc = mocks('findAll', 'findOne', 'create', 'update', 'remove');
  const ctrl = new StockItemCategoriesController(svc as any);

  it('findAll forwards tenantId', () => {
    ctrl.findAll(req as any);
    expect(svc.findAll).toHaveBeenCalledWith('t1');
  });
  it('create forwards dto + tenantId', () => {
    const dto = { name: 'Dry' } as any;
    ctrl.create(dto, req as any);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1');
  });
  it('update forwards id, dto, tenantId', () => {
    ctrl.update('c1', { name: 'X' } as any, req as any);
    expect(svc.update).toHaveBeenCalledWith('c1', { name: 'X' }, 't1');
  });
  it('remove forwards id + tenantId', () => {
    ctrl.remove('c1', req as any);
    expect(svc.remove).toHaveBeenCalledWith('c1', 't1');
  });
});

describe('SuppliersController', () => {
  const svc = mocks(
    'findAll',
    'findOne',
    'create',
    'update',
    'remove',
    'addStockItem',
    'removeStockItem',
  );
  const ctrl = new SuppliersController(svc as any);

  it('create forwards dto + tenantId', () => {
    ctrl.create({ name: 'ACME' } as any, req as any);
    expect(svc.create).toHaveBeenCalledWith({ name: 'ACME' }, 't1');
  });
  it('addStockItem forwards supplierId, dto, tenantId', () => {
    ctrl.addStockItem('sup1', { stockItemId: 's1', unitPrice: 1 } as any, req as any);
    expect(svc.addStockItem).toHaveBeenCalledWith('sup1', { stockItemId: 's1', unitPrice: 1 }, 't1');
  });
  it('removeStockItem forwards both path params + tenantId', () => {
    ctrl.removeStockItem('sup1', 's1', req as any);
    expect(svc.removeStockItem).toHaveBeenCalledWith('sup1', 's1', 't1');
  });
});

describe('PurchaseOrdersController', () => {
  const svc = mocks('findAll', 'findOne', 'create', 'submit', 'receive', 'cancel');
  const ctrl = new PurchaseOrdersController(svc as any);

  it('findAll forwards tenantId + status', () => {
    ctrl.findAll(req as any, 'DRAFT');
    expect(svc.findAll).toHaveBeenCalledWith('t1', 'DRAFT');
  });
  it('create forwards dto, scope tenant+branch AND actor id', () => {
    const dto = { supplierId: 'sup1', items: [] } as any;
    ctrl.create(dto, scope, req as any);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1', 'b1', 'u1');
  });
  it('receive forwards id, dto, tenantId, actor', () => {
    const dto = { items: [] } as any;
    ctrl.receive('po1', dto, req as any);
    expect(svc.receive).toHaveBeenCalledWith('po1', dto, 't1', 'u1');
  });
  it('cancel forwards id, tenantId, actor', () => {
    ctrl.cancel('po1', req as any);
    expect(svc.cancel).toHaveBeenCalledWith('po1', 't1', 'u1');
  });
});

describe('RecipesController', () => {
  const svc = mocks(
    'findAll',
    'findByProduct',
    'findOne',
    'create',
    'checkStock',
    'update',
    'remove',
  );
  const ctrl = new RecipesController(svc as any);

  it('findAll parses limit/offset', () => {
    ctrl.findAll(req as any, '10', '5');
    expect(svc.findAll).toHaveBeenCalledWith('t1', { limit: 10, offset: 5 });
  });
  it('findAll coerces a non-numeric limit to undefined', () => {
    ctrl.findAll(req as any, 'banana');
    expect(svc.findAll).toHaveBeenCalledWith('t1', { limit: undefined, offset: undefined });
  });
  it('create stamps scope.branchId', () => {
    const dto = { productId: 'p1', ingredients: [] } as any;
    ctrl.create(dto, req as any, scope);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1', 'b1');
  });
  it('checkStock parses quantity (defaults to 1)', () => {
    ctrl.checkStock('r1', req as any, '3');
    expect(svc.checkStock).toHaveBeenCalledWith('r1', 't1', 3);
    svc.checkStock.mockClear();
    ctrl.checkStock('r1', req as any);
    expect(svc.checkStock).toHaveBeenCalledWith('r1', 't1', 1);
  });
});

describe('StockCountsController', () => {
  const svc = mocks('findAll', 'findOne', 'create', 'updateItem', 'finalize', 'cancel');
  const ctrl = new StockCountsController(svc as any);

  it('create forwards dto, tenantId, branch, actor', () => {
    const dto = {} as any;
    ctrl.create(dto, req as any, scope);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1', 'b1', 'u1');
  });
  it('updateItem forwards both ids, dto, tenantId', () => {
    const dto = { countedQty: 5 } as any;
    ctrl.updateItem('sc1', 'item1', dto, req as any);
    expect(svc.updateItem).toHaveBeenCalledWith('sc1', 'item1', dto, 't1');
  });
  it('finalize forwards id + tenantId', () => {
    ctrl.finalize('sc1', req as any);
    expect(svc.finalize).toHaveBeenCalledWith('sc1', 't1');
  });
});

describe('WasteLogsController', () => {
  const svc = mocks('findAll', 'getSummary', 'create');
  const ctrl = new WasteLogsController(svc as any);

  it('findAll forwards tenantId + query', () => {
    const q = { limit: 100 } as any;
    ctrl.findAll(req as any, q);
    expect(svc.findAll).toHaveBeenCalledWith('t1', q);
  });
  it('getSummary unwraps startDate/endDate', () => {
    ctrl.getSummary(req as any, { startDate: '2026-01-01', endDate: '2026-02-01' } as any);
    expect(svc.getSummary).toHaveBeenCalledWith('t1', '2026-01-01', '2026-02-01');
  });
  it('create forwards dto, tenantId, actor', () => {
    const dto = { stockItemId: 's1', quantity: 1, reason: 'SPOILED' } as any;
    ctrl.create(dto, req as any);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1', 'u1');
  });
});

describe('IngredientMovementsController', () => {
  const svc = mocks('findAll', 'create');
  const ctrl = new IngredientMovementsController(svc as any);

  it('findAll forwards tenantId + query', () => {
    const q = { type: 'IN' } as any;
    ctrl.findAll(req as any, q);
    expect(svc.findAll).toHaveBeenCalledWith('t1', q);
  });
  it('create forwards dto + tenantId', () => {
    const dto = { stockItemId: 's1', type: 'IN', quantity: 1 } as any;
    ctrl.create(dto, req as any);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1');
  });
});

describe('StockDashboardController', () => {
  const svc = mocks('getDashboard', 'getValuation', 'getMovementSummary');
  const ctrl = new StockDashboardController(svc as any);

  it('getDashboard forwards tenantId', () => {
    ctrl.getDashboard(req as any);
    expect(svc.getDashboard).toHaveBeenCalledWith('t1');
  });
  it('getMovementSummary unwraps the date window', () => {
    ctrl.getMovementSummary(req as any, { startDate: '2026-01-01', endDate: '2026-02-01' } as any);
    expect(svc.getMovementSummary).toHaveBeenCalledWith('t1', '2026-01-01', '2026-02-01');
  });
});

describe('StockSettingsController', () => {
  const svc = mocks('get', 'update');
  const ctrl = new StockSettingsController(svc as any);

  it('get forwards tenantId', () => {
    ctrl.get(req as any);
    expect(svc.get).toHaveBeenCalledWith('t1');
  });
  it('update forwards dto + tenantId', () => {
    const dto = { enableAutoDeduction: true } as any;
    ctrl.update(dto, req as any);
    expect(svc.update).toHaveBeenCalledWith(dto, 't1');
  });
});
