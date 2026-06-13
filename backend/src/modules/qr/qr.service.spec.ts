import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

// Mock the qrcode lib so specs are deterministic and don't burn CPU rendering
// real PNGs. We capture the URL each QR is generated from so we can assert on
// the (load-bearing) URL construction the service performs.
jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async (url: string) => `data:image/png;base64,${url}`),
}));

import * as QRCode from 'qrcode';
import { QrService } from './qr.service';

const toDataURL = QRCode.toDataURL as jest.Mock;

describe('QrService', () => {
  let prisma: MockPrismaClient;
  let svc: QrService;

  const tenantId = 't-1';

  // A complete-enough settings row. The service reads primaryColor +
  // enableTableQR off it.
  const settingsRow = (overrides: Partial<any> = {}) => ({
    id: 'qs-1',
    tenantId,
    branchId: null,
    primaryColor: '#3B82F6',
    enableTableQR: false,
    ...overrides,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new QrService(prisma as any);
    toDataURL.mockClear();
  });

  describe('getSettings', () => {
    it('scopes the lookup to the tenant-wide row (tenantId + branchId:null)', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(
        settingsRow(),
      );

      const result = await svc.getSettings(tenantId);

      const where = (prisma.qrMenuSettings.findFirst as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(tenantId);
      expect(where.branchId).toBeNull();
      expect(result).toEqual(settingsRow());
      expect(prisma.qrMenuSettings.create).not.toHaveBeenCalled();
    });

    it('lazily creates a tenant-wide settings row when none exists', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(null);
      (prisma.qrMenuSettings.create as any).mockResolvedValue(settingsRow());

      await svc.getSettings(tenantId);

      const data = (prisma.qrMenuSettings.create as any).mock.calls[0][0].data;
      expect(data).toEqual({ tenantId });
    });

    it('recovers from a P2002 create race by re-fetching the existing row', async () => {
      // first findFirst (pre-create) -> none; create races and conflicts;
      // second findFirst (post-conflict) -> the winning row.
      (prisma.qrMenuSettings.findFirst as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(settingsRow());
      (prisma.qrMenuSettings.create as any).mockRejectedValue({ code: 'P2002' });

      const result = await svc.getSettings(tenantId);

      expect(result).toEqual(settingsRow());
    });

    it('rethrows non-P2002 create errors', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(null);
      (prisma.qrMenuSettings.create as any).mockRejectedValue({ code: 'P2003' });

      await expect(svc.getSettings(tenantId)).rejects.toMatchObject({
        code: 'P2003',
      });
    });
  });

  describe('createSettings', () => {
    it('creates a new tenant-scoped row when none exists', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(null);
      (prisma.qrMenuSettings.create as any).mockResolvedValue(
        settingsRow({ primaryColor: '#000000' }),
      );

      await svc.createSettings(tenantId, { primaryColor: '#000000' } as any);

      const data = (prisma.qrMenuSettings.create as any).mock.calls[0][0].data;
      expect(data.tenantId).toBe(tenantId);
      expect(data.primaryColor).toBe('#000000');
    });

    it('updates instead of creating a duplicate when a row already exists', async () => {
      // findFirst is hit by createSettings AND by the delegated update path;
      // always returns an existing row.
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());
      (prisma.qrMenuSettings.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.qrMenuSettings.findFirstOrThrow as any).mockResolvedValue(
        settingsRow({ primaryColor: '#FFFFFF' }),
      );

      await svc.createSettings(tenantId, { primaryColor: '#FFFFFF' } as any);

      expect(prisma.qrMenuSettings.create).not.toHaveBeenCalled();
      expect(prisma.qrMenuSettings.updateMany).toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('updates the tenant-wide row and returns the re-fetched value', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());
      (prisma.qrMenuSettings.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.qrMenuSettings.findFirstOrThrow as any).mockResolvedValue(
        settingsRow({ primaryColor: '#123456' }),
      );

      const result = await svc.updateSettings(tenantId, {
        primaryColor: '#123456',
      } as any);

      const where = (prisma.qrMenuSettings.updateMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(tenantId);
      expect(where.branchId).toBeNull();
      expect(result.primaryColor).toBe('#123456');
    });

    it('throws NotFound when updateMany matches zero rows', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());
      (prisma.qrMenuSettings.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(
        svc.updateSettings(tenantId, { primaryColor: '#123456' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteSettings', () => {
    it('deletes the tenant-wide row and returns the deleted count', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());
      (prisma.qrMenuSettings.deleteMany as any).mockResolvedValue({ count: 1 });

      const result = await svc.deleteSettings(tenantId);

      const where = (prisma.qrMenuSettings.deleteMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(tenantId);
      expect(where.branchId).toBeNull();
      expect(result).toEqual({ count: 1 });
    });

    it('throws NotFound when no settings row exists', async () => {
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(null);

      await expect(svc.deleteSettings(tenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.qrMenuSettings.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('getQrCodes', () => {
    const tenant = (overrides: Partial<any> = {}) => ({
      id: tenantId,
      name: 'Acme Diner',
      subdomain: 'acme',
      ...overrides,
    });

    it('throws NotFound for an unknown tenant', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(null);

      await expect(
        svc.getQrCodes(tenantId, 'https://hummytummy.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('caps generation at MAX_TABLES_PER_REQUEST (501 rows -> BadRequest)', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      // service does take: MAX+1 (=501) to detect the overflow.
      const tables = Array.from({ length: 501 }, (_, i) => ({
        id: `tbl-${i}`,
        number: i,
      }));
      (prisma.table.findMany as any).mockResolvedValue(tables);

      await expect(
        svc.getQrCodes(tenantId, 'https://hummytummy.com'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('scopes the table lookup to the tenant', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());

      await svc.getQrCodes(tenantId, 'https://hummytummy.com');

      const where = (prisma.table.findMany as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe(tenantId);
    });

    it('builds a subdomain-based tenant URL in production', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());

      const result = await svc.getQrCodes(
        tenantId,
        'https://hummytummy.com',
      );

      const tenantQr = result.qrCodes.find((q: any) => q.type === 'TENANT');
      expect(tenantQr.url).toBe('https://acme.hummytummy.com');
    });

    it('builds a subdomain-based URL nested under staging', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());

      const result = await svc.getQrCodes(
        tenantId,
        'https://staging.hummytummy.com',
      );

      const tenantQr = result.qrCodes.find((q: any) => q.type === 'TENANT');
      expect(tenantQr.url).toBe('https://acme.staging.hummytummy.com');
    });

    it('falls back to a path-based URL on localhost even with a valid subdomain', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());

      const result = await svc.getQrCodes(tenantId, 'http://localhost:3000');

      const tenantQr = result.qrCodes.find((q: any) => q.type === 'TENANT');
      expect(tenantQr.url).toBe(`http://localhost:3000/qr-menu/${tenantId}`);
    });

    it('falls back to a path-based URL when the subdomain fails the regex (defensive)', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(
        tenant({ subdomain: 'EVIL.com#' }),
      );
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(settingsRow());

      const result = await svc.getQrCodes(tenantId, 'https://hummytummy.com');

      const tenantQr = result.qrCodes.find((q: any) => q.type === 'TENANT');
      expect(tenantQr.url).toBe(`https://hummytummy.com/qr-menu/${tenantId}`);
    });

    it('omits table QR codes when enableTableQR is false', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: 1 },
      ]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(
        settingsRow({ enableTableQR: false }),
      );

      const result = await svc.getQrCodes(tenantId, 'https://hummytummy.com');

      expect(result.qrCodes.some((q: any) => q.type === 'TABLE')).toBe(false);
    });

    it('emits a per-table QR with a tableId query param when enableTableQR is true', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: 7 },
      ]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(
        settingsRow({ enableTableQR: true }),
      );

      const result = await svc.getQrCodes(tenantId, 'https://hummytummy.com');

      const tableQr = result.qrCodes.find((q: any) => q.type === 'TABLE');
      expect(tableQr.tableId).toBe('tbl-1');
      expect(tableQr.tableNumber).toBe(7);
      expect(tableQr.url).toBe('https://acme.hummytummy.com?tableId=tbl-1');
    });

    it('passes the settings primaryColor through to the QR renderer', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(tenant());
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.qrMenuSettings.findFirst as any).mockResolvedValue(
        settingsRow({ primaryColor: '#abcdef' }),
      );

      await svc.getQrCodes(tenantId, 'https://hummytummy.com');

      const opts = toDataURL.mock.calls[0][1];
      expect(opts.color.dark).toBe('#abcdef');
    });
  });

  describe('generateQrCode', () => {
    it('renders the given URL with a default color and echoes the URL', async () => {
      const result = await svc.generateQrCode('https://example.com/menu');

      expect(result.url).toBe('https://example.com/menu');
      const [url, opts] = toDataURL.mock.calls[0];
      expect(url).toBe('https://example.com/menu');
      expect(opts.color.dark).toBe('#3B82F6');
    });

    it('honors a custom color override', async () => {
      await svc.generateQrCode('https://example.com/menu', { color: '#ff0000' });

      const opts = toDataURL.mock.calls[0][1];
      expect(opts.color.dark).toBe('#ff0000');
    });
  });
});
