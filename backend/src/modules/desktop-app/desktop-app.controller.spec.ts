import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { DesktopAppController } from './desktop-app.controller';
import { DesktopAppService } from './desktop-app.service';
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

/**
 * PLATFORM_REGEX regression — every Windows and Linux client was getting a
 * 400 "Invalid platform" from BOTH public routes that take `:platform`,
 * because the regex (`/^[a-z0-9-]{1,32}$/i`) has no underscore while
 * Tauri v2's `{{target}}` template resolves to `windows-x86_64` /
 * `linux-x86_64` (and `darwin-x86_64`) — all of which contain one.
 * `darwin-aarch64` happened to pass only because it has no underscore.
 *
 * desktop-app.service.spec.ts calls `service.checkForUpdates('windows-x86_64', …)`
 * directly, which exercises the correct string but never passes through
 * the controller method body where PLATFORM_REGEX.test() actually runs —
 * so that suite could never have caught this. These tests instantiate the
 * controller itself (matching this repo's convention, e.g.
 * internal-entitlements.controller.spec.ts) and call the handlers exactly
 * as NestJS would, so the regex in the method body is the code under test.
 */
describe('DesktopAppController PLATFORM_REGEX — real Tauri target strings', () => {
  let service: {
    checkForUpdates: jest.Mock;
    trackDownload: jest.Mock;
  };
  let controller: DesktopAppController;

  beforeEach(() => {
    service = {
      checkForUpdates: jest.fn().mockResolvedValue(null),
      trackDownload: jest.fn().mockResolvedValue(undefined),
    };
    controller = new DesktopAppController(service as unknown as DesktopAppService);
  });

  // The exact set of `{{target}}` values Tauri v2's updater plugin sends.
  const realTauriTargets = [
    'windows-x86_64',
    'linux-x86_64',
    'darwin-x86_64',
    'darwin-aarch64',
  ];

  describe('GET /desktop/updates/:platform/:currentVersion', () => {
    for (const platform of realTauriTargets) {
      it(`accepts "${platform}" (does not throw, reaches the service)`, async () => {
        await expect(
          controller.checkForUpdates(platform, '1.0.0'),
        ).resolves.toBeNull();
        expect(service.checkForUpdates).toHaveBeenCalledWith(platform, '1.0.0');
      });
    }

    it('still rejects a genuinely malformed platform (path-traversal shape)', async () => {
      await expect(
        controller.checkForUpdates('../../etc/passwd', '1.0.0'),
      ).rejects.toThrow(BadRequestException);
      expect(service.checkForUpdates).not.toHaveBeenCalled();
    });

    it('still rejects a platform with disallowed characters (spaces)', async () => {
      await expect(
        controller.checkForUpdates('windows x86_64', '1.0.0'),
      ).rejects.toThrow(BadRequestException);
      expect(service.checkForUpdates).not.toHaveBeenCalled();
    });

    it('still rejects an over-long platform string', async () => {
      const tooLong = 'a'.repeat(33);
      await expect(
        controller.checkForUpdates(tooLong, '1.0.0'),
      ).rejects.toThrow(BadRequestException);
      expect(service.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  describe('POST /desktop/releases/:version/download/:platform', () => {
    for (const platform of realTauriTargets) {
      it(`accepts "${platform}" (does not throw, reaches the service)`, async () => {
        await expect(
          controller.trackDownload('1.0.0', platform),
        ).resolves.toEqual({ message: 'Download tracked' });
        expect(service.trackDownload).toHaveBeenCalledWith('1.0.0', platform);
      });
    }

    it('still rejects a genuinely malformed platform', async () => {
      await expect(
        controller.trackDownload('1.0.0', '../../etc/passwd'),
      ).rejects.toThrow(BadRequestException);
      expect(service.trackDownload).not.toHaveBeenCalled();
    });
  });
});
