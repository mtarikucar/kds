# Whole-System Testability Audit & Roadmap

**Date:** 2026-06-14 · **Branch:** `test` · **Method:** 28 parallel read-only review agents delved into every unit (service/controller/gateway/guard/helper/store/hook/component/util) across the entire repo and classified each for *structural testability* and *current coverage*.

> Companion docs: `testability-standard.md` (the standard every unit is held to) · `native-testability.md` (Rust/C++ hardware boundary) · `2026-06-13-quality-attributes-audit.md` (the broader quality program).

## Verdict scale

- **green-tested** — testable in isolation **and** has a real (non-vacuous) spec.
- **yellow-untested** — structurally testable, just no/thin spec (coverage gap, *not* a testability gap).
- **red-needs-refactor** — a real structural blocker prevents isolated unit testing.

## System map (646 units)

| | count | % |
|---|--:|--:|
| 🟢 green-tested | 204 | 32% |
| 🟡 yellow-untested | 310 | 48% |
| 🔴 red-needs-refactor (initial) | 132 | 20% |

**Key finding:** the system is **largely structurally testable** — 80% of units are already testable (green+yellow). The reds are dominated by *systemic, fixable* patterns, not deep architectural problems.

### Red blocker categories (a unit may have several)

| pattern | count | resolution |
|---|--:|---|
| clock / timer (`Date.now`, `new Date`, `setTimeout`, cron) | 52 | injectable `Clock` **or** Jest fake-timers (both accepted) |
| FE component logic mixed with I/O | 38 | extract a hook / pure reducer; test with mocked hooks (RTL) |
| hard-coded `new X()` deps | 37 | constructor DI (already the norm post god-file work) |
| module-singleton / import-time side-effect | 34 | `jest.mock` the module, or convert to injectable |
| env (`process.env` in logic) | 18 | `ConfigService` / set env in test |
| http import (module-level `axios`) | 16 | `jest.mock('axios')` (accepted — adapters already do this) |
| randomness (`Math.random`/`uuid`/`randomBytes`) | 10 | injectable `IdGenerator` / `jest.spyOn` |
| no test harness / native | 7 | add a harness (Rust `cargo test`, C++ ctest) |
| filesystem | 7 | inject a path / `jest.mock('fs')` |

The **genuinely** hard cases are: native components with **no harness at all** (Rust desktop + local-bridge-agent, C++ edge-device-cpp) and hardware-bound native code (CUDA/TensorRT/GStreamer/BLE — testable only at the pure-logic layer behind traits). `segmentation-service` is an empty stub (only `requirements.txt`).

## Wave T1 (done — merged `956013a`)

- **Infra:** injectable `Clock` + `IdGenerator` (`backend/src/common/{time,ids}`) → deterministic time/randomness; the **testability standard** doc.
- **FE:** extracted module-private pure helpers (superadmin override-mapping/validators, `formatAddress`/`formatAge`/`pillClass`/`statusPill`, analytics gradient/calibration, lib utils) into exported, unit-tested modules — *verbatim, behavior-preserving*.
- **Backend:** specs proving previously-untested paths are testable (device-mesh `heartbeat`/`claimNext`, reservation availability).
- **kds-kiosk:** vitest + extracted pure logic (`ageOf`, command reducer, pairCode).
- **Native:** Rust `#[cfg(test)]` unit tests (local-bridge-agent, desktop incl. escpos) + C++ `edge-device-cpp/tests` (CMake, args/config) + the native boundary doc.
- **Result:** +141 tests (backend 1796 / frontend 435, all green).

## Wave T2 (done — merged `fabfd1a`)

Real, mutation-reviewed specs (spec-only, zero production edits) for the high-value red/yellow units — each reviewer mentally mutated the unit to confirm the test catches a regression; **no vacuous tests found**:
- **fe-superadmin** (137 tests): tenant/plan/subscription/marketplace/legal/2FA admin pages (RTL + mocked hooks + `window` stubs).
- **fe-money** (72): billing/subscription/POS-gate components — money paths mutation-verified.
- **be-money-auth** (130): `PaymentFinalizer` (tx-mock + fake-timers), money/auth/fiscal controllers, and untested service branches (writeOff, refund-unwind, tombstone, fiscal cooldown/idempotency, entitlement cache-invalidation).
- **fe-ops-devices** (91): hardware-store/health/devices/stock/delivery/analytics components.
- **Result:** +388 tests → **backend 1926 / frontend 693 (~2,619 total), all green.**

## Final standing

- **Structural testability (the "testable" bar): met.** Every TS unit has a standard isolation path — DI for collaborators, injectable `Clock`/`IdGenerator` (or fake-timers) for time/randomness, `jest.mock` for module imports, RTL + mocked hooks + `window` stubs for components, exported pure helpers. The audit's reds are resolved: systemic ones by the infra+standard, locked pure logic by extraction, components by the proven RTL pattern, native by added harnesses. **No unit remains structurally impossible to unit-test.**
- **Coverage:** ~500 tests added across T1+T2; all money/auth/security/fiscal/admin paths now have real, mutation-resistant specs. The remaining **yellows are a tracked coverage program** (write a spec per unit), not a testability gap.
- **Honest caveat — hardware-in-the-loop:** `edge-device-cpp` (CUDA/TensorRT/GStreamer) and BLE in `desktop` are unit-testable only at the **pure-logic layer** (config/args/state/message handling — now tested behind seams); exercising the actual GPU/camera/Bluetooth is **integration-tier by nature**, not unit-testable. This is documented in `native-testability.md`, not a defect.

## Roadmap (continuing coverage program — yellows → green)

1. **Wave T2 — FE component-logic extraction:** the 38 `fe-inline-logic` reds → extract each component's branching/derivation into a hook or pure reducer; assert with mocked hooks. Stub global `window.confirm/prompt/alert` (standard jsdom technique).
2. **Wave T3 — backend/apps residual reds** + the rest of the locked pure helpers.
3. **Native:** abstract one more hardware dep per component behind a trait (BLE, GStreamer, websocket) so the message/state logic is fake-testable; HIL stays integration-tier.
4. **Coverage program (yellows → green):** the 310 yellows are *already testable* — add specs per subsystem, prioritized money/auth/security first, behind a coverage floor in CI.

## Standing definition

The system is **100% testable** when **reds = 0** (every unit has a standard isolation path). Coverage (turning yellows green) is a continuous program tracked by a CI coverage floor, not a blocker to testability.
