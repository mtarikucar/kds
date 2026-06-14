import { FiscalController } from './fiscal.controller';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Thin-controller spec for FiscalController. `pending` parses the `limit`
 * query (defaulting to 100 when absent), and every handler forwards the
 * resolved BranchScope so recovery reads/writes stay branch-isolated.
 */
describe('FiscalController', () => {
  let fiscal: Record<string, jest.Mock>;
  let ctrl: FiscalController;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.ADMIN,
  };

  beforeEach(() => {
    fiscal = {
      listPending: jest.fn().mockResolvedValue([]),
      retryFailed: jest.fn().mockResolvedValue({ id: 'r1' }),
      cancelReceipt: jest.fn().mockResolvedValue({ id: 'r1' }),
      closeDay: jest.fn().mockResolvedValue({ z: true }),
    };
    ctrl = new FiscalController(fiscal as any);
  });

  it('pending defaults the limit to 100 when the query param is absent', () => {
    ctrl.pending(scope, undefined);
    expect(fiscal.listPending).toHaveBeenCalledWith(scope, 100);
  });

  it('pending parses the limit query string to a number', () => {
    ctrl.pending(scope, '25');
    expect(fiscal.listPending).toHaveBeenCalledWith(scope, 25);
  });

  it('retry forwards scope + receipt id', () => {
    ctrl.retry(scope, 'rcpt-9');
    expect(fiscal.retryFailed).toHaveBeenCalledWith(scope, 'rcpt-9');
  });

  it('cancel forwards scope, id and the reason from the body', () => {
    ctrl.cancel(scope, 'rcpt-9', { reason: 'wrong amount' } as any);
    expect(fiscal.cancelReceipt).toHaveBeenCalledWith(
      scope,
      'rcpt-9',
      'wrong amount',
    );
  });

  it('closeDay forwards scope + device id', () => {
    ctrl.closeDay(scope, 'dev-1');
    expect(fiscal.closeDay).toHaveBeenCalledWith(scope, 'dev-1');
  });
});
