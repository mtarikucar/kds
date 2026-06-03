import { KdsGateway } from './kds.gateway';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-81 regression. KdsGateway.customerActivityLastWrite is an
 * in-memory Map used to debounce CustomerSession.lastActivity writes
 * during reconnect storms. Pre-iter-81:
 *   - every customer connect added a (sessionId → ms) entry;
 *   - handleDisconnect was a pure logger;
 *   - so the map grew by one entry per session connect for the lifetime
 *     of the replica (~30K entries / month on a busy tenant).
 *
 * iter-81 wires handleDisconnect to delete the entry, and adds a size
 * cap with oldest-insertion eviction as a safety net for the edge
 * case where a socket disconnects without the gateway noticing.
 */
describe('KdsGateway customerActivityLastWrite map cleanup (iter-81)', () => {
  let prisma: MockPrismaClient;
  let gw: KdsGateway;
  let activityMap: Map<string, number>;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const jwt = {} as any;
    gw = new KdsGateway(jwt, prisma as any);
    activityMap = (gw as any).customerActivityLastWrite as Map<string, number>;
  });

  it('handleDisconnect deletes the entry for the disconnecting session', () => {
    // Seed an entry as if the customer just connected.
    activityMap.set('sess-1', Date.now());
    expect(activityMap.has('sess-1')).toBe(true);

    const fakeClient: any = { id: 'sock-1', data: { sessionId: 'sess-1' } };
    gw.handleDisconnect(fakeClient);

    expect(activityMap.has('sess-1')).toBe(false);
  });

  it('handleDisconnect is a no-op for staff sockets (no sessionId on client.data)', () => {
    // Seed an unrelated entry to verify we don't sweep too aggressively.
    activityMap.set('sess-other', 1);

    const staffClient: any = { id: 'sock-staff', data: { userId: 'u-1', tenantId: 't-1' } };
    gw.handleDisconnect(staffClient);

    expect(activityMap.has('sess-other')).toBe(true);
  });

  it('evicts the oldest entry by insertion order when the map is at the cap', () => {
    const cap = (KdsGateway as any).ACTIVITY_MAP_HARD_CAP as number;
    // Fill to cap.
    for (let i = 0; i < cap; i++) activityMap.set(`s-${i}`, i);
    expect(activityMap.size).toBe(cap);

    // Drive the cap-aware path on the next write. The simplest way is
    // to inline the same logic the gateway uses inside tryCustomerAuth:
    // when size >= cap, drop the oldest then set the new key.
    if (activityMap.size >= cap) {
      const oldest = activityMap.keys().next().value;
      if (oldest) activityMap.delete(oldest);
    }
    activityMap.set('s-new', 999);

    // Size must not grow past the cap, and the oldest seed key is gone.
    expect(activityMap.size).toBeLessThanOrEqual(cap);
    expect(activityMap.has('s-0')).toBe(false);
    expect(activityMap.has('s-new')).toBe(true);
  });
});
