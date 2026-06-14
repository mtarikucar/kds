import { Test, TestingModule } from '@nestjs/testing';
import { DesktopAppService } from './desktop-app.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

/**
 * Security regression — the Tauri auto-updater only installs a binary
 * whose minisign signature verifies against the pinned pubkey. A
 * manifest platform entry that carries a download `url` but an
 * empty/absent `signature` is therefore *not* installable: the updater
 * would either reject it or, worse, a misconfigured client could be
 * tricked into pulling an unverifiable binary.
 *
 * checkForUpdates() must NEVER emit such a half-populated entry. A
 * release row that has a platform URL but no signature is treated as
 * not-updatable for that platform (and logged), exactly as if the
 * platform were absent.
 */
describe('DesktopAppService.checkForUpdates — signature contract', () => {
  let service: DesktopAppService;
  let prisma: MockPrismaClient;

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DesktopAppService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DesktopAppService);
    // Silence the expected warning logs.
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  function release(overrides: Record<string, unknown>) {
    return {
      id: 'rel-1',
      version: '2.0.0',
      published: true,
      pubDate: new Date('2026-01-01T00:00:00Z'),
      releaseNotes: 'notes',
      windowsUrl: null,
      windowsSignature: null,
      macArmUrl: null,
      macArmSignature: null,
      macIntelUrl: null,
      macIntelSignature: null,
      linuxUrl: null,
      linuxSignature: null,
      ...overrides,
    };
  }

  it('omits a platform that has a url but a MISSING signature', async () => {
    (prisma.desktopRelease.findFirst as jest.Mock).mockResolvedValue(
      release({ windowsUrl: 'https://cdn/app.msi', windowsSignature: null }),
    );

    const manifest = await service.checkForUpdates('windows-x86_64', '1.0.0');

    // Requested platform is not updatable → whole response is null.
    expect(manifest).toBeNull();
  });

  it('omits a platform that has a url but an EMPTY signature', async () => {
    (prisma.desktopRelease.findFirst as jest.Mock).mockResolvedValue(
      release({
        // requested platform is signed & valid so we get a manifest back…
        linuxUrl: 'https://cdn/app.AppImage',
        linuxSignature: 'valid-sig',
        // …but windows has a url with an empty signature and MUST be dropped.
        windowsUrl: 'https://cdn/app.msi',
        windowsSignature: '',
      }),
    );

    const manifest = await service.checkForUpdates('linux-x86_64', '1.0.0');

    expect(manifest).not.toBeNull();
    // The empty-signature windows entry must never leak into the manifest.
    expect(manifest!.platforms['windows-x86_64']).toBeUndefined();

    // Belt-and-suspenders: no emitted platform may have a blank signature.
    for (const [, entry] of Object.entries(manifest!.platforms)) {
      expect(entry).toBeDefined();
      expect(entry!.signature).toBeTruthy();
    }
  });

  it('logs a warning when a platform url is present without a signature', async () => {
    const warn = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);
    (prisma.desktopRelease.findFirst as jest.Mock).mockResolvedValue(
      release({
        linuxUrl: 'https://cdn/app.AppImage',
        linuxSignature: 'valid-sig',
        macArmUrl: 'https://cdn/app.dmg',
        macArmSignature: null,
      }),
    );

    await service.checkForUpdates('linux-x86_64', '1.0.0');

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('darwin-aarch64'),
    );
  });

  it('still serves a fully-signed platform (positive path)', async () => {
    (prisma.desktopRelease.findFirst as jest.Mock).mockResolvedValue(
      release({ windowsUrl: 'https://cdn/app.msi', windowsSignature: 'sig' }),
    );

    const manifest = await service.checkForUpdates('windows-x86_64', '1.0.0');

    expect(manifest).not.toBeNull();
    expect(manifest!.version).toBe('2.0.0');
    expect(manifest!.platforms['windows-x86_64']).toEqual({
      url: 'https://cdn/app.msi',
      signature: 'sig',
    });
  });
});
