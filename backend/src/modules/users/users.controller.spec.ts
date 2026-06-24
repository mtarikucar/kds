import { UsersController } from './users.controller';

/**
 * Thin-controller spec for UsersController. Verifies each handler forwards
 * the actor / tenantId / dto to the right service (UsersService vs.
 * UserOnboardingService) and that findAll parses its paging query
 * (page/limit → number | undefined). A regression in the page/limit
 * parsing or in which service the onboarding routes target fails here.
 */
describe('UsersController', () => {
  let usersService: Record<string, jest.Mock>;
  let onboarding: Record<string, jest.Mock>;
  let ctrl: UsersController;

  const req = { tenantId: 't1', scope: { branchId: 'b1' } };
  const actor = { id: 'admin-1', role: 'ADMIN' };

  beforeEach(() => {
    usersService = {
      create: jest.fn().mockResolvedValue({ id: 'u1' }),
      findAll: jest.fn().mockResolvedValue({ data: [] }),
      findOne: jest.fn().mockResolvedValue({ id: 'u1' }),
      update: jest.fn().mockResolvedValue({ id: 'u1' }),
      remove: jest.fn().mockResolvedValue({ id: 'u1' }),
      getMyProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
      updateEmail: jest.fn().mockResolvedValue({ id: 'u1' }),
      approveUser: jest.fn().mockResolvedValue({ id: 'u1' }),
      rejectUser: jest.fn().mockResolvedValue({ id: 'u1' }),
      reactivateUser: jest.fn().mockResolvedValue({ id: 'u1' }),
    };
    onboarding = {
      getOnboarding: jest.fn().mockResolvedValue({ step: 1 }),
      updateOnboarding: jest.fn().mockResolvedValue({ step: 2 }),
    };
    ctrl = new UsersController(usersService as any, onboarding as any);
  });

  it('create forwards dto, tenantId, the current actor, and the branch scope', () => {
    const dto = { email: 'a@b.c' } as any;
    ctrl.create(dto, req as any, actor);
    expect(usersService.create).toHaveBeenCalledWith(dto, 't1', actor, 'b1');
  });

  it('findAll parses page/limit into numbers and forwards filters', () => {
    ctrl.findAll(req as any, 'ACTIVE', 'WAITER', 'ali', '2', '50');
    expect(usersService.findAll).toHaveBeenCalledWith('t1', {
      status: 'ACTIVE',
      role: 'WAITER',
      search: 'ali',
      page: 2,
      limit: 50,
    });
  });

  it('findAll leaves page/limit undefined when not supplied', () => {
    ctrl.findAll(req as any);
    expect(usersService.findAll).toHaveBeenCalledWith('t1', {
      status: undefined,
      role: undefined,
      search: undefined,
      page: undefined,
      limit: undefined,
    });
  });

  it('findOne forwards id + tenantId', () => {
    ctrl.findOne('u1', req as any);
    expect(usersService.findOne).toHaveBeenCalledWith('u1', 't1');
  });

  it('update forwards id, dto, tenantId and actor', () => {
    const dto = { name: 'X' } as any;
    ctrl.update('u1', dto, req as any, actor);
    expect(usersService.update).toHaveBeenCalledWith('u1', dto, 't1', actor);
  });

  it('remove forwards id, tenantId and the actor id only', () => {
    ctrl.remove('u1', req as any, 'admin-1');
    expect(usersService.remove).toHaveBeenCalledWith('u1', 't1', 'admin-1');
  });

  it('getMyProfile reads the current user id', () => {
    ctrl.getMyProfile('me-1');
    expect(usersService.getMyProfile).toHaveBeenCalledWith('me-1');
  });

  it('updateMyProfile forwards userId + dto', () => {
    const dto = { name: 'Y' } as any;
    ctrl.updateMyProfile('me-1', dto);
    expect(usersService.updateProfile).toHaveBeenCalledWith('me-1', dto);
  });

  it('updateMyEmail forwards userId + dto', () => {
    const dto = { email: 'z@b.c', password: 'pw' } as any;
    ctrl.updateMyEmail('me-1', dto);
    expect(usersService.updateEmail).toHaveBeenCalledWith('me-1', dto);
  });

  it('approveUser forwards id, approverId and tenantId', () => {
    ctrl.approveUser('u1', 'admin-1', req as any);
    expect(usersService.approveUser).toHaveBeenCalledWith('u1', 'admin-1', 't1');
  });

  it('rejectUser forwards id + tenantId', () => {
    ctrl.rejectUser('u1', req as any);
    expect(usersService.rejectUser).toHaveBeenCalledWith('u1', 't1');
  });

  it('reactivateUser forwards id, tenantId and actorId', () => {
    ctrl.reactivateUser('u1', req as any, 'admin-1');
    expect(usersService.reactivateUser).toHaveBeenCalledWith(
      'u1',
      't1',
      'admin-1',
    );
  });

  it('getMyOnboarding routes to the onboarding service (not UsersService)', () => {
    ctrl.getMyOnboarding('me-1');
    expect(onboarding.getOnboarding).toHaveBeenCalledWith('me-1');
  });

  it('updateMyOnboarding routes to the onboarding service with userId + dto', () => {
    const dto = { dismissedChecklist: true } as any;
    ctrl.updateMyOnboarding('me-1', dto);
    expect(onboarding.updateOnboarding).toHaveBeenCalledWith('me-1', dto);
  });
});
