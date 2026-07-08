import { CashDrawerController } from './cash-drawer.controller';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Thin-controller spec for CashDrawerController. create destructures the
 * scope into (tenantId, branchId, userId, dto); approve/reject rebuild the
 * actor `{ id, role }` from the scope. A regression in that destructure /
 * actor-rebuild (the type→approval gate depends on the right actor) fails
 * here.
 */
describe('CashDrawerController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: CashDrawerController;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: 'm1' }),
      listPending: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'm1' }),
      approve: jest.fn().mockResolvedValue({ id: 'm1', status: 'APPROVED' }),
      reject: jest.fn().mockResolvedValue({ id: 'm1', status: 'REJECTED' }),
    };
    const sessions = {
      open: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      getCurrent: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'CLOSED' }),
    };
    ctrl = new CashDrawerController(svc as any, sessions as any);
  });

  it('create explodes the scope into (tenantId, branchId, userId, dto)', () => {
    const dto = { type: 'CASH_IN', amount: 50 } as any;
    ctrl.create(scope, dto);
    expect(svc.create).toHaveBeenCalledWith('t1', 'b1', 'u1', dto);
  });

  it('listPending forwards the whole scope', () => {
    ctrl.listPending(scope);
    expect(svc.listPending).toHaveBeenCalledWith(scope);
  });

  it('findOne forwards scope + id', () => {
    ctrl.findOne(scope, 'm1');
    expect(svc.findOne).toHaveBeenCalledWith(scope, 'm1');
  });

  it('approve rebuilds the actor {id, role} from the scope', () => {
    ctrl.approve(scope, 'm1');
    expect(svc.approve).toHaveBeenCalledWith(scope, 'm1', {
      id: 'u1',
      role: UserRole.MANAGER,
    });
  });

  it('reject rebuilds the actor and forwards the reason dto', () => {
    const dto = { reason: 'miscount' } as any;
    ctrl.reject(scope, 'm1', dto);
    expect(svc.reject).toHaveBeenCalledWith(
      scope,
      'm1',
      { id: 'u1', role: UserRole.MANAGER },
      dto,
    );
  });
});
