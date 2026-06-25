# Branch-Centric Device & Network Hub — Design Spec

**Date:** 2026-06-25
**Goal:** Replace the 3 flat "Çoklu Şube" pages (Branches / Devices / Bridges) with a **branch-centric hub**: one Branches page where each branch (and a "Merkez/HQ" bucket) is managed with its own devices + local network (bridge topology) + health — and fix the "create slot → phantom device forever" problem so device management is *smart*, not an unbounded flat list.

**User intent (verbatim drivers):** "cihazlar zaten şubeye ya da merkeziyetsiz olabilir … bir tane şubeler sayfası olsun içinde cihazları da yönetebilelim şube içi ağları da" + "create slot dediğim anda device oluşuyor burda bi problem var."

**Approved approach (user: "sen ne öneriyorsan onu yap"):** Merkez-şube model (no risky `branchId`-nullable change), full consolidation, fix the slot lifecycle.

---

## Decisions

1. **Central / "Merkez" devices = the HQ branch (Merkez-şube model).** Add an additive, safe `Branch.isHeadquarters Boolean @default(false)`; backfill the seeded `MAIN` branch (per tenant) to `true` (fallback: earliest branch). Central/şubesiz devices live in the HQ branch and are presented as "Merkez". **No `Device.branchId`-nullable change** → the v3 branch-scope-strict guard + command-queue branchId chain are untouched. Branch capacity counting is unchanged (HQ still counts as today — pure label + bucket, zero behaviour change).
2. **Slot lifecycle (the real fix).** `createSlot` still mints an `unprovisioned` Device + 10-min pairCode, but:
   - The device-mesh sweep cron **prunes expired-unprovisioned devices** (status `unprovisioned` AND `pairCodeExpiresAt < now − grace`) → no phantom rows linger after a never-completed pairing.
   - A **soft per-branch pending-slot cap** (max N concurrent `unprovisioned`) in `createSlot` stops spam.
   - The hub shows a **meaningful device count** (real = not unprovisioned, not retired) and pending slots separately with a **live countdown**.
3. **Consolidation (IA).** One Branches hub → drill into `/admin/branches/:id` (devices · local network · health · edit). `/admin/devices` + `/admin/bridges` are removed from the sidebar and **redirect** to `/admin/branches`. The fleet-wide **Health** page stays (cross-branch overview).
4. **No hard per-plan device cap** in this iteration (would require a new plan-limit dimension across schema/projector/engine/override/superadmin — high mirror-risk for little gain vs the lifecycle fix). Tracked as a future option.

---

## Backend (`device-mesh`)

- **Schema:** `Branch.isHeadquarters Boolean @default(false)` (idempotent additive migration + backfill `code='MAIN'` → true, else earliest branch per tenant). `seed.ts` sets it on the MAIN upsert.
- **`device.service`:**
  - `createSlot`: reject when the branch already has ≥ `MAX_PENDING_SLOTS` (default 10) `unprovisioned` devices (`BadRequestException`, anti-spam).
  - `pruneExpiredUnprovisioned()`: delete `unprovisioned` devices with `pairCodeExpiresAt < now − grace`; emit nothing (silent cleanup), return count.
  - `list`: unchanged (still returns unprovisioned so the UI shows pending), but the **count helper** classifies real vs pending.
  - `countsByBranch(tenantId)`: returns per-branch `{ total, online, pending }` (real = status in online/offline/paired; pending = unprovisioned) for the hub cards.
- **`branches.service`:**
  - `overview(tenantId)`: branches (with `isHeadquarters`) + device counts + bridge counts in one call (hub cards, no N+1).
  - `network(tenantId, branchId)`: the branch's bridges + devices grouped by `bridgeId` (topology) + cloud-direct devices (bridgeId null). The "şube içi ağ".
- **`device-mesh.scheduler`:** add `pruneExpiredUnprovisioned` to the existing `withAdvisoryLock` sweep.
- **Endpoints (ADMIN/MANAGER, tenant-scoped @SkipBranchScope where cross-branch):** `GET /v1/branches/overview`, `GET /v1/branches/:id/network`.

## Frontend

- **BranchesPage → hub:** cards per branch (Merkez badge on HQ), each showing name/code/status + device online/total + pending + bridge count + a mini health pill; "Yönet" → detail. A "+ Şube" action (existing, multiLocation-gated).
- **BranchDetailPage (`/admin/branches/:id`, new):** header (name/code/status, Merkez badge, edit) + sections:
  - **Cihazlar:** branch-scoped device table; provision (live pairing countdown + pending-cap feedback), retire, command drawer (reuse existing device views).
  - **Yerel ağ:** bridges for the branch + devices grouped under each bridge + a "Buluta doğrudan" group (bridgeId null). Provision bridge.
  - **Sağlık:** the branch's health score (reuse health-dashboard per-branch).
- **Merkez:** the HQ branch is the first card, labeled "Merkez", and is where şubesiz/central devices live.
- **Nav:** remove Devices + Bridges sidebar items; keep Branches + Health. Redirect `/admin/devices` + `/admin/bridges` → `/admin/branches`.
- **i18n:** 5 locales (tr/en/ru/uz/ar).

## Phasing

Build backend + frontend together (the new endpoints are only consumed by the new UI → no value shipping backend alone), adversarially review (workflow), then ship **one** prod tag. Quality bar: backend tsc/jest/eslint, frontend tsc/eslint/vitest/build, i18n parity+value-drift, migration validated on throwaway Postgres, adversarial review of branch-scope correctness + slot-cleanup safety + central-device edges before the tag.
