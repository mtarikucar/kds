/**
 * Horizontal-scalability proof: cross-replica Socket.IO fan-out via Redis.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The RedisIoAdapter (backend/src/common/adapters/redis-io.adapter.ts) ships
 * and is active in prod, but the promised "emit on node A, receive on node B
 * through live Redis pub/sub" behaviour had no executable proof. Every KDS
 * gateway emit is `server.to('<room>').emit(...)`, which with the DEFAULT
 * in-memory adapter ONLY reaches sockets connected to the SAME replica. Under
 * any 2+ replica deployment that silently drops half the realtime events
 * unless the Redis adapter is wired and Redis is reachable. This spec proves
 * the adapter actually bridges replicas — and the NEGATIVE control proves the
 * in-memory fallback genuinely DROPS the cross-replica event (so the positive
 * test isn't passing for some unrelated reason).
 *
 * ── ENV FLAGS ─────────────────────────────────────────────────────────────
 *   RUN_MULTI_REPLICA=1   REQUIRED to run this file at all. Default CI/local
 *                         runs skip it entirely (no Redis, no second build),
 *                         so this spec never affects the standard suite.
 *   REDIS_URL=redis://…   REQUIRED by the POSITIVE test. Both spawned replicas
 *                         share this Redis instance; that shared pub/sub bus is
 *                         exactly what carries the broadcast from A to B. If
 *                         unset, the positive test is skipped (can't prove
 *                         fan-out with no bus). The NEGATIVE control DELIBERATELY
 *                         spawns its replicas with REDIS_URL UNSET on both.
 *   DATABASE_URL=…        Inherited from the env (Playwright loads backend/.env).
 *                         Both replicas share the SAME database so a token minted
 *                         against the suite DB authenticates on either replica and
 *                         the order created on A is visible to B's gateway.
 *
 * ── PRECONDITIONS / HOW IT WORKS ──────────────────────────────────────────
 *   1. Build the backend once (`npm run build`) if dist/main.js is absent.
 *   2. Spawn a SECOND backend replica with `node dist/main` on a fresh PORT,
 *      inheriting the suite's env (same DATABASE_URL + JWT/crypto secrets),
 *      and POLL its /api/health until it answers — we never sleep().
 *   3. POSITIVE: spawn replica A AND replica B, both pointed at the shared
 *      REDIS_URL. Connect a KDS client to replica B (via the new base-URL
 *      override on connectKdsAs). Trigger an order status change over HTTP on
 *      replica A. Assert B's socket receives `order:status-changed` within the
 *      timeout — only possible if Redis fanned the emit from A to B.
 *   4. NEGATIVE: spawn replica A' and replica B' with REDIS_URL UNSET on both
 *      (in-memory adapter). Same client-on-B', trigger-on-A' setup. Assert B'
 *      does NOT receive the event within a bounded window — the in-memory
 *      adapter cannot bridge processes.
 *
 * This spec changes NO application code. The only library touch is a small
 * additive `baseUrl` param on connectKdsAs (helpers/sockets.ts) so a client can
 * dial a specific replica. Spawned replicas are always torn down in afterAll.
 *
 * Run it locally with, e.g.:
 *   docker run -d -p 6379:6379 redis:7
 *   RUN_MULTI_REPLICA=1 REDIS_URL=redis://localhost:6379 \
 *     npx playwright test tests/e2e/specs/cross-cutting/multi-replica-broadcast.spec.ts
 */
import { spawn, ChildProcess, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { request, APIRequestContext } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { connectKdsAs } from '../../helpers/sockets';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  updateOrderStatus,
} from '../../helpers/factories';

// ── Gating ────────────────────────────────────────────────────────────────
// Anything but RUN_MULTI_REPLICA=1 skips the whole file so the default suite
// (no Redis, no second build) is completely unaffected.
const RUN = process.env.RUN_MULTI_REPLICA === '1';
const REDIS_URL = process.env.REDIS_URL;

const backendDir = path.resolve(__dirname, '../../../../backend');
const distMain = path.join(backendDir, 'dist', 'main.js');

// Ports for the spawned replicas. Chosen high + distinct from the suite's
// backend (:50080) and frontend (:5179) so nothing collides.
const PORT_A = 50091; // positive-test replica A (Redis on)
const PORT_B = 50092; // positive-test replica B (Redis on)
const PORT_NA = 50093; // negative-control replica A' (Redis off)
const PORT_NB = 50094; // negative-control replica B' (Redis off)

const baseHttp = (port: number) => `http://localhost:${port}`;
const apiBaseFor = (port: number) => `${baseHttp(port)}/api/`;

type Replica = { proc: ChildProcess; port: number };

/**
 * Spawn `node dist/main` on `port`. Inherits the current env (so DATABASE_URL,
 * JWT_SECRET, ENCRYPTION_MASTER_KEY etc. that the suite already has are present)
 * and overrides PORT. `redisUrl === null` UNSETS REDIS_URL for the child (forces
 * the in-memory adapter); otherwise the child uses the given/shared Redis URL.
 */
function spawnReplica(port: number, redisUrl: string | null): Replica {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: 'test' };
  if (redisUrl === null) {
    delete env.REDIS_URL;
    delete env.REDIS_HOST;
    delete env.REDIS_PORT;
  } else {
    env.REDIS_URL = redisUrl;
  }
  const proc = spawn('node', ['dist/main.js'], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Surface boot failures (bad env, port clash) instead of swallowing them in
  // a silent buffer that only manifests as a health-poll timeout.
  proc.stdout?.on('data', (d) => process.stdout.write(`[replica:${port}] ${d}`));
  proc.stderr?.on('data', (d) => process.stderr.write(`[replica:${port}] ${d}`));
  return { proc, port };
}

/**
 * Poll GET /api/health until it returns a 2xx (replica is listening) or the
 * deadline passes. NO sleep() of a fixed guess — we poll a real readiness
 * signal so the test is as fast as the boot allows and as reliable as the
 * probe.
 */
async function waitForHealthy(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const ctx = await request.newContext({ baseURL: apiBaseFor(port) });
  try {
    let lastErr = 'no response';
    while (Date.now() < deadline) {
      try {
        const res = await ctx.get('health', { timeout: 2_000 });
        if (res.ok()) return;
        lastErr = `status ${res.status()}`;
      } catch (e: any) {
        lastErr = e?.message ?? String(e);
      }
      // Short re-poll interval; we are awaiting an HTTP round-trip each loop
      // so this is a back-off, not a blind sleep substituting for readiness.
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`replica on :${port} never became healthy (${lastErr})`);
  } finally {
    await ctx.dispose();
  }
}

function killReplica(r: Replica | undefined): void {
  if (!r) return;
  try {
    r.proc.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

/**
 * Create an order on a SPECIFIC replica (by its API base) and return its id +
 * the admin context used. We re-login through `loginAsApi` to get a token, then
 * issue the create/setup HTTP calls against the chosen replica's base URL so the
 * action provably executes on that node (not the default suite backend).
 */
async function createOrderOnReplica(port: number): Promise<{ orderId: string; api: APIRequestContext }> {
  const { accessToken } = await loginAsApi('admin');
  const api = await request.newContext({
    baseURL: apiBaseFor(port),
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  const { product } = await createCategoryAndProduct(api, { price: 30 });
  const table = await createTable(api);
  const order = await createOrder(api, {
    tableId: table.id,
    items: [{ productId: product.id }],
  });
  return { orderId: order.id, api };
}

// describe.skip when the gate is off — zero impact on the default suite.
const describeMaybe = RUN ? test.describe : test.describe.skip;

describeMaybe('Horizontal scalability — cross-replica Socket.IO broadcast', () => {
  // Building once up front keeps each test's timeout focused on boot+probe,
  // not a cold TypeScript compile.
  test.beforeAll(() => {
    if (!fs.existsSync(distMain)) {
      // eslint-disable-next-line no-console
      console.log('[multi-replica] dist/main.js missing — running `npm run build`…');
      execSync('npm run build', { cwd: backendDir, stdio: 'inherit' });
    }
    if (!fs.existsSync(distMain)) {
      throw new Error(`backend build did not produce ${distMain}`);
    }
  });

  // Generous: two cold `node dist/main` boots (DB + Nest init) + a build on
  // first run can take a while on CI.
  test.setTimeout(240_000);

  test.describe('with shared Redis (positive: B receives A’s broadcast)', () => {
    let replicaA: Replica | undefined;
    let replicaB: Replica | undefined;

    test.beforeAll(async () => {
      test.skip(!REDIS_URL, 'REDIS_URL not set — cannot prove cross-replica fan-out without a shared bus');
      replicaA = spawnReplica(PORT_A, REDIS_URL!);
      replicaB = spawnReplica(PORT_B, REDIS_URL!);
      await Promise.all([waitForHealthy(PORT_A), waitForHealthy(PORT_B)]);
    });

    test.afterAll(() => {
      killReplica(replicaA);
      killReplica(replicaB);
    });

    test('order:status-changed emitted on replica A reaches a client on replica B via Redis', async () => {
      // Client connects specifically to replica B (NOT the suite backend, NOT A).
      const clientB = await connectKdsAs('kitchen', baseHttp(PORT_B));
      let setupApi: APIRequestContext | undefined;
      try {
        // The order itself can be created on either node; create it on A so the
        // whole lifecycle (create + status change) happens on the node the
        // listener is NOT attached to.
        const { orderId, api } = await createOrderOnReplica(PORT_A);
        setupApi = api;

        // Subscribe BEFORE the trigger to avoid racing the emit.
        const incoming = clientB.waitFor<{ orderId: string; status: string }>(
          'order:status-changed',
          (p) => p.orderId === orderId,
          15_000,
        );

        // Trigger the broadcast on replica A.
        await updateOrderStatus(api, orderId, 'PREPARING');

        // If Redis pub/sub bridges A → B, B's socket sees it.
        const event = await incoming;
        expect(event.orderId).toBe(orderId);
        expect(event.status).toBe('PREPARING');
      } finally {
        clientB.disconnect();
        await setupApi?.dispose();
      }
    });
  });

  test.describe('without Redis (negative control: B must NOT receive A’s broadcast)', () => {
    let replicaA: Replica | undefined;
    let replicaB: Replica | undefined;

    test.beforeAll(async () => {
      // REDIS_URL UNSET on BOTH → both replicas use the in-memory adapter, which
      // cannot bridge processes. This is the control that proves the positive
      // test passes BECAUSE of Redis, not for some incidental reason.
      replicaA = spawnReplica(PORT_NA, null);
      replicaB = spawnReplica(PORT_NB, null);
      await Promise.all([waitForHealthy(PORT_NA), waitForHealthy(PORT_NB)]);
    });

    test.afterAll(() => {
      killReplica(replicaA);
      killReplica(replicaB);
    });

    test('in-memory adapter drops the cross-replica event (B never sees A’s emit)', async () => {
      const clientB = await connectKdsAs('kitchen', baseHttp(PORT_NB));
      let setupApi: APIRequestContext | undefined;
      try {
        const { orderId, api } = await createOrderOnReplica(PORT_NA);
        setupApi = api;

        // Same listener as the positive test, but we EXPECT a timeout.
        const incoming = clientB.waitFor<{ orderId: string; status: string }>(
          'order:status-changed',
          (p) => p.orderId === orderId,
          5_000,
        );

        await updateOrderStatus(api, orderId, 'PREPARING');

        // Assert NON-delivery: the waitFor must reject (timeout). If it
        // resolves, cross-replica delivery happened without Redis — which would
        // mean the in-memory fallback is silently bridging processes and the
        // positive test proves nothing.
        await expect(incoming).rejects.toThrow(/timeout/i);
      } finally {
        clientB.disconnect();
        await setupApi?.dispose();
      }
    });
  });
});
