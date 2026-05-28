import 'reflect-metadata';
import { DesktopAppController } from './desktop-app.controller';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { IS_SUPERADMIN_ROUTE_KEY } from '../superadmin/decorators/superadmin.decorator';

/**
 * Iter-70 regression — DesktopRelease is a platform-level model (the
 * global installer catalog the Tauri auto-updater pulls from for
 * every tenant), but the admin moderation endpoints used to be gated
 * by tenant-realm @Roles(UserRole.ADMIN). Any restaurant admin could
 * publish a release pointing at attacker-hosted binaries that the
 * updater would auto-pull for ALL restaurants. Same privilege
 * escalation shape iter-51 closed on PublicReview and iter-58 on
 * ContactMessage.
 *
 * These tests inspect the route metadata directly (the same metadata
 * NestJS's Reflector consults at request time), so a future refactor
 * that quietly swaps the guard back to the tenant realm fails the
 * suite before it lands.
 */
describe('DesktopAppController guard wiring (iter-70)', () => {
  function method<K extends keyof DesktopAppController>(name: K): Function {
    return DesktopAppController.prototype[name] as unknown as Function;
  }
  function guardNames(handler: Function): string[] {
    const guards = Reflect.getMetadata('__guards__', handler) as Array<{ name: string }> | undefined;
    return (guards ?? []).map((g) => g.name);
  }

  describe('admin routes use SuperAdminGuard', () => {
    const adminRoutes: Array<keyof DesktopAppController> = [
      'createRelease',
      'getAllReleases',
      'getReleaseById',
      'updateRelease',
      'publishRelease',
      'unpublishRelease',
      'deleteRelease',
    ];

    for (const name of adminRoutes) {
      it(`${name} is guarded by SuperAdminGuard + @SuperAdminRoute`, () => {
        const handler = method(name);
        expect(guardNames(handler)).toContain(SuperAdminGuard.name);
        expect(Reflect.getMetadata(IS_SUPERADMIN_ROUTE_KEY, handler)).toBe(true);
      });
    }
  });

  describe('public + CI routes keep their existing gates', () => {
    it('checkForUpdates stays public (no guards)', () => {
      const handler = method('checkForUpdates');
      // Public routes have no per-handler @UseGuards.
      expect(guardNames(handler)).not.toContain(SuperAdminGuard.name);
    });

    it('createReleaseCI is guarded by ApiKeyGuard (CI/CD entry point)', () => {
      const handler = method('createReleaseCI');
      const names = guardNames(handler);
      // ApiKeyGuard is the load-bearing gate for GitHub Actions — keep it.
      expect(names).toContain(ApiKeyGuard.name);
      // And it must NOT have picked up a SuperAdminGuard by accident
      // (CI doesn't have a superadmin JWT, only an API key).
      expect(names).not.toContain(SuperAdminGuard.name);
    });
  });
});
