import { TablesController } from './tables.controller';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Thin-controller spec for TablesController. Every handler forwards the
 * resolved BranchScope (v3 scoping) plus path/body to TablesService; the
 * public route forwards only tenantId (no scope). A regression in which
 * method a route targets, or in scope forwarding, fails here.
 */
describe('TablesController — handler forwarding', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: TablesController;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: 'tbl1' }),
      mergeTables: jest.fn().mockResolvedValue({ groupId: 'g1' }),
      unmergeTable: jest.fn().mockResolvedValue({ ok: true }),
      unmergeAll: jest.fn().mockResolvedValue({ ok: true }),
      getTableGroup: jest.fn().mockResolvedValue({ tables: [] }),
      findAll: jest.fn().mockResolvedValue([]),
      findAvailableForCustomers: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'tbl1' }),
      update: jest.fn().mockResolvedValue({ id: 'tbl1' }),
      updateStatus: jest.fn().mockResolvedValue({ id: 'tbl1' }),
      remove: jest.fn().mockResolvedValue({ id: 'tbl1' }),
    };
    ctrl = new TablesController(svc as any);
  });

  it('create forwards scope + dto', () => {
    const dto = { number: '1', capacity: 4 } as any;
    ctrl.create(dto, scope);
    expect(svc.create).toHaveBeenCalledWith(scope, dto);
  });

  it('mergeTables forwards scope + dto', () => {
    const dto = { tableIds: ['a', 'b'] } as any;
    ctrl.mergeTables(dto, scope);
    expect(svc.mergeTables).toHaveBeenCalledWith(scope, dto);
  });

  it('unmergeTable forwards scope + dto', () => {
    const dto = { tableId: 'a' } as any;
    ctrl.unmergeTable(dto, scope);
    expect(svc.unmergeTable).toHaveBeenCalledWith(scope, dto);
  });

  it('unmergeAll forwards scope + groupId', () => {
    ctrl.unmergeAll('g1', scope);
    expect(svc.unmergeAll).toHaveBeenCalledWith(scope, 'g1');
  });

  it('getTableGroup forwards scope + groupId', () => {
    ctrl.getTableGroup('g1', scope);
    expect(svc.getTableGroup).toHaveBeenCalledWith(scope, 'g1');
  });

  it('findAll forwards scope + section filter', () => {
    ctrl.findAll(scope, 'Patio');
    expect(svc.findAll).toHaveBeenCalledWith(scope, 'Patio');
  });

  it('findAll forwards undefined section when omitted', () => {
    ctrl.findAll(scope);
    expect(svc.findAll).toHaveBeenCalledWith(scope, undefined);
  });

  it('getPublicTables forwards ONLY the tenantId (public, no scope)', () => {
    ctrl.getPublicTables('tenant-9');
    expect(svc.findAvailableForCustomers).toHaveBeenCalledWith('tenant-9');
  });

  it('findOne forwards scope + id', () => {
    ctrl.findOne('tbl1', scope);
    expect(svc.findOne).toHaveBeenCalledWith(scope, 'tbl1');
  });

  it('update forwards scope, id, dto', () => {
    const dto = { capacity: 6 } as any;
    ctrl.update('tbl1', dto, scope);
    expect(svc.update).toHaveBeenCalledWith(scope, 'tbl1', dto);
  });

  it('updateStatus forwards scope, id, dto', () => {
    const dto = { status: 'OCCUPIED' } as any;
    ctrl.updateStatus('tbl1', dto, scope);
    expect(svc.updateStatus).toHaveBeenCalledWith(scope, 'tbl1', dto);
  });

  it('remove forwards scope + id', () => {
    ctrl.remove('tbl1', scope);
    expect(svc.remove).toHaveBeenCalledWith(scope, 'tbl1');
  });
});
