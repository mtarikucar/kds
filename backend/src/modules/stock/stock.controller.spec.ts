import { BadRequestException } from '@nestjs/common';
import { StockController } from './stock.controller';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';
import { StockMovementType } from '../../common/constants/order-status.enum';

/**
 * Spec for StockController. Beyond forwarding, getMovements/getLowStockAlerts
 * carry real boundary logic: runtime enum validation of `type`, NaN-date
 * rejection (iter-87 trap), positive-int limit, and a bounded threshold.
 */
describe('StockController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: StockController;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };
  const req = { tenantId: 't1', user: { userId: 'u1' } };

  beforeEach(() => {
    svc = {
      createMovement: jest.fn().mockResolvedValue({ id: 'm1' }),
      getMovements: jest.fn().mockResolvedValue([]),
      getLowStockAlerts: jest.fn().mockResolvedValue([]),
    };
    ctrl = new StockController(svc as any);
  });

  it('createMovement forwards dto, userId, tenantId AND scope.branchId', () => {
    const dto = { productId: 'p1' } as any;
    ctrl.createMovement(dto, req as any, scope);
    expect(svc.createMovement).toHaveBeenCalledWith(dto, 'u1', 't1', 'b1');
  });

  describe('getMovements', () => {
    const someType = Object.values(StockMovementType)[0];

    it('forwards scope + parsed args for valid input', () => {
      ctrl.getMovements(scope, 'p1', someType, '2026-01-01', '2026-02-01', '50');
      expect(svc.getMovements).toHaveBeenCalledWith(
        scope,
        'p1',
        someType,
        new Date('2026-01-01'),
        new Date('2026-02-01'),
        50,
      );
    });

    it('passes undefined dates/limit when omitted', () => {
      ctrl.getMovements(scope);
      expect(svc.getMovements).toHaveBeenCalledWith(
        scope,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('rejects an unknown movement type (runtime enum guard)', () => {
      expect(() => ctrl.getMovements(scope, 'p1', 'TELEPORT')).toThrow(BadRequestException);
    });

    it('rejects a non-ISO startDate (NaN-date trap)', () => {
      expect(() => ctrl.getMovements(scope, undefined, undefined, 'soon')).toThrow(
        BadRequestException,
      );
    });

    it('rejects a non-positive limit', () => {
      expect(() =>
        ctrl.getMovements(scope, undefined, undefined, undefined, undefined, '0'),
      ).toThrow(BadRequestException);
    });
  });

  describe('getLowStockAlerts', () => {
    it('defaults threshold to 10 when omitted', () => {
      ctrl.getLowStockAlerts(req as any);
      expect(svc.getLowStockAlerts).toHaveBeenCalledWith('t1', 10);
    });

    it('forwards a parsed threshold', () => {
      ctrl.getLowStockAlerts(req as any, '25');
      expect(svc.getLowStockAlerts).toHaveBeenCalledWith('t1', 25);
    });

    it('rejects a negative threshold', () => {
      expect(() => ctrl.getLowStockAlerts(req as any, '-1')).toThrow(BadRequestException);
    });

    it('rejects a threshold above 1,000,000', () => {
      expect(() => ctrl.getLowStockAlerts(req as any, '1000001')).toThrow(BadRequestException);
    });
  });
});
