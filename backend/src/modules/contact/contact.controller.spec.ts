import 'reflect-metadata';
import { ContactController } from './contact.controller';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { IS_SUPERADMIN_ROUTE_KEY } from '../superadmin/decorators/superadmin.decorator';

/**
 * Iter-58 regression — ContactMessage is a platform-level model (it has
 * no tenantId), but the admin moderation endpoints used to be gated by
 * the tenant-realm @Roles(UserRole.ADMIN). Any restaurant admin from
 * any tenant could enumerate every contact-form submission to the
 * platform, including name + email + phone + message body of leads,
 * partnership inquiries, and billing complaints.
 *
 * Same shape as iter-51 on PublicReview: escalate to SuperAdminGuard.
 *
 * These specs inspect the route metadata directly (the same metadata
 * NestJS's reflector consults at request time) so a future refactor
 * that quietly swaps the guard back to the tenant realm fails this
 * suite before it lands.
 */
describe('ContactController admin guard wiring (iter-58)', () => {
  function methodOf<K extends keyof ContactController>(name: K): Function {
    return ContactController.prototype[name] as unknown as Function;
  }

  it('GET / (findAll) is guarded by SuperAdminGuard and tagged as a SuperAdmin route', () => {
    const handler = methodOf('findAll');
    const guards = Reflect.getMetadata('__guards__', handler) as Array<{ name: string }> | undefined;
    expect(guards).toBeDefined();
    expect(guards!.map((g) => g.name)).toContain(SuperAdminGuard.name);
    expect(Reflect.getMetadata(IS_SUPERADMIN_ROUTE_KEY, handler)).toBe(true);
  });

  it('GET /:id (findOne) is guarded by SuperAdminGuard', () => {
    const handler = methodOf('findOne');
    const guards = Reflect.getMetadata('__guards__', handler) as Array<{ name: string }> | undefined;
    expect(guards).toBeDefined();
    expect(guards!.map((g) => g.name)).toContain(SuperAdminGuard.name);
    expect(Reflect.getMetadata(IS_SUPERADMIN_ROUTE_KEY, handler)).toBe(true);
  });

  it('PATCH /:id/read (markAsRead) is guarded by SuperAdminGuard', () => {
    const handler = methodOf('markAsRead');
    const guards = Reflect.getMetadata('__guards__', handler) as Array<{ name: string }> | undefined;
    expect(guards).toBeDefined();
    expect(guards!.map((g) => g.name)).toContain(SuperAdminGuard.name);
    expect(Reflect.getMetadata(IS_SUPERADMIN_ROUTE_KEY, handler)).toBe(true);
  });

  it('POST / (create) stays public — that is the marketing landing entry point', () => {
    const handler = methodOf('create');
    const guards = Reflect.getMetadata('__guards__', handler) as Array<{ name: string }> | undefined;
    // No SuperAdminGuard on the public-submit path.
    if (guards) {
      expect(guards.map((g) => g.name)).not.toContain(SuperAdminGuard.name);
    }
  });
});
