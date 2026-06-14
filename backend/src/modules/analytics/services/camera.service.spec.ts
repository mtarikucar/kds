import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { CameraService } from './camera.service';

/**
 * Track-1 branch-scope hardening (adjacent leak found during verification).
 *
 * Bug: the Camera model carries a NON-nullable `branchId`, but the READ /
 * UPDATE / DELETE paths filtered by `tenantId` ONLY. A branch-A admin could
 * therefore list, fetch, edit, or delete branch-B cameras (cross-branch
 * IDOR). The write path (`createCamera`) correctly derives `branchId` from
 * the edge device; only the read/mutate-by-id paths leaked.
 *
 * These specs lock the invariant: every camera read/mutate query carries
 * BOTH tenantId AND branchId in its `where`.
 */
describe('CameraService branch-scope', () => {
  let prisma: MockPrismaClient;
  let svc: CameraService;

  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'ADMIN',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CameraService(prisma as any);
  });

  it('getCameras scopes the findMany query by branchId + tenantId', async () => {
    (prisma.camera.findMany as any).mockResolvedValue([]);

    await svc.getCameras(scope);

    const where = (prisma.camera.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('t-1');
    expect(where.branchId).toBe('b-1');
  });

  it('getCameraById scopes the findFirst lookup by branchId + tenantId', async () => {
    (prisma.camera.findFirst as any).mockResolvedValue({
      id: 'cam-1',
      tenantId: 't-1',
      branchId: 'b-1',
      name: 'Front',
      description: null,
      streamUrl: '',
      streamType: 'RTSP',
      status: 'OFFLINE',
      rotationY: 0,
      fov: 90,
      calibrationData: null,
      lastSeenAt: null,
      errorMessage: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    await svc.getCameraById(scope, 'cam-1');

    const where = (prisma.camera.findFirst as any).mock.calls[0][0].where;
    expect(where.id).toBe('cam-1');
    expect(where.tenantId).toBe('t-1');
    expect(where.branchId).toBe('b-1');
  });

  it('updateCamera scopes both the claim updateMany and the re-fetch by branchId', async () => {
    (prisma.camera.findFirst as any).mockResolvedValue({
      id: 'cam-1',
      tenantId: 't-1',
      branchId: 'b-1',
      name: 'Front',
      streamUrl: '',
      streamType: 'RTSP',
      status: 'OFFLINE',
    });
    (prisma.camera.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.camera.findFirstOrThrow as any).mockResolvedValue({
      id: 'cam-1',
      tenantId: 't-1',
      branchId: 'b-1',
      name: 'Front',
      description: null,
      streamUrl: '',
      streamType: 'RTSP',
      status: 'OFFLINE',
      rotationY: 0,
      fov: 90,
      calibrationData: null,
      lastSeenAt: null,
      errorMessage: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    await svc.updateCamera(scope, 'cam-1', { status: 'ONLINE' } as any);

    const claimWhere = (prisma.camera.updateMany as any).mock.calls[0][0].where;
    expect(claimWhere.tenantId).toBe('t-1');
    expect(claimWhere.branchId).toBe('b-1');
    const refetchWhere = (prisma.camera.findFirstOrThrow as any).mock.calls[0][0]
      .where;
    expect(refetchWhere.tenantId).toBe('t-1');
    expect(refetchWhere.branchId).toBe('b-1');
  });

  it('deleteCamera scopes the deleteMany by branchId + tenantId', async () => {
    (prisma.camera.findFirst as any).mockResolvedValue({
      id: 'cam-1',
      tenantId: 't-1',
      branchId: 'b-1',
    });
    (prisma.camera.deleteMany as any).mockResolvedValue({ count: 1 });

    await svc.deleteCamera(scope, 'cam-1');

    const where = (prisma.camera.deleteMany as any).mock.calls[0][0].where;
    expect(where.id).toBe('cam-1');
    expect(where.tenantId).toBe('t-1');
    expect(where.branchId).toBe('b-1');
  });

  it('updateCalibration scopes the lookup, claim, and re-fetch by branchId + tenantId', async () => {
    (prisma.camera.findFirst as any).mockResolvedValue({
      id: 'cam-1',
      tenantId: 't-1',
      branchId: 'b-1',
      name: 'Front',
      streamUrl: '',
      streamType: 'RTSP',
      status: 'OFFLINE',
    });
    (prisma.camera.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.camera.findFirstOrThrow as any).mockResolvedValue({
      id: 'cam-1',
      tenantId: 't-1',
      branchId: 'b-1',
      name: 'Front',
      description: null,
      streamUrl: '',
      streamType: 'RTSP',
      status: 'CALIBRATING',
      rotationY: 0,
      fov: 90,
      calibrationData: null,
      lastSeenAt: null,
      errorMessage: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    await svc.updateCalibration(scope, 'cam-1', { points: [1, 2, 3] });

    const lookupWhere = (prisma.camera.findFirst as any).mock.calls[0][0].where;
    expect(lookupWhere.tenantId).toBe('t-1');
    expect(lookupWhere.branchId).toBe('b-1');
    const claimWhere = (prisma.camera.updateMany as any).mock.calls[0][0].where;
    expect(claimWhere.tenantId).toBe('t-1');
    expect(claimWhere.branchId).toBe('b-1');
    const refetchWhere = (prisma.camera.findFirstOrThrow as any).mock.calls[0][0]
      .where;
    expect(refetchWhere.tenantId).toBe('t-1');
    expect(refetchWhere.branchId).toBe('b-1');
  });

  it('getCameraHealthSummary scopes the groupBy by branchId + tenantId', async () => {
    (prisma.camera.groupBy as any).mockResolvedValue([]);

    await svc.getCameraHealthSummary(scope);

    const where = (prisma.camera.groupBy as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('t-1');
    expect(where.branchId).toBe('b-1');
  });

  it('createCamera writes the edge-device branch, looked up within scope', async () => {
    (prisma.camera.findFirst as any).mockResolvedValue(null); // no dup name
    (prisma.edgeDevice.findFirst as any).mockResolvedValue({ branchId: 'b-1' });
    (prisma.camera.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'cam-new',
      ...data,
      description: null,
      rotationY: 0,
      fov: 90,
      calibrationData: null,
      lastSeenAt: null,
      errorMessage: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));

    await svc.createCamera(scope, {
      name: 'New Cam',
      streamUrl: 'rtsp://u:p@host/stream',
      edgeDeviceId: 'edge-1',
    } as any);

    // The duplicate-name guard must be tenant-scoped at minimum.
    const dupWhere = (prisma.camera.findFirst as any).mock.calls[0][0].where;
    expect(dupWhere.tenantId).toBe('t-1');
    // The written branchId comes from the edge device, not the scope.
    const created = (prisma.camera.create as any).mock.calls[0][0].data;
    expect(created.branchId).toBe('b-1');
    expect(created.tenantId).toBe('t-1');
  });
});
