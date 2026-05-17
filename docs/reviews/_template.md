# `<feature>` — Deep Review (YYYY-MM-DD)

> Template. Copy and rename. Delete this blockquote and any section that doesn't apply (see tier guidance in `README.md`).

**Tier:** 1 / 2 / 3
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/<feature>/...` (or frontend equivalent)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) — index, executive summary, cross-cutting observations

---

## 1. Health & summary

🔴 red / 🟡 yellow / 🟢 green

One paragraph. What this feature owns (business responsibility, not "files in the folder"). Where the risk concentrates. How the previous round of audits touched it. If health changed from the last review, say why.

---

## 2. Scope of this review

**Read end-to-end:**
- `path/to/file.ts` (LOC) — what's in it
- ...

**Skimmed only:**
- `path/to/file.ts` — reason (e.g., thin wrapper, generated, test fixtures)

**Skipped:**
- `path/to/file.ts` — reason (out of risk surface)

---

## 3. Business-logic invariants

The contract this feature is responsible for keeping. Each row should be **testable** — a property an integration test could assert.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | e.g., "Σ payments for an order ≤ order.totalAmount + 0.01" | `payments.service.ts:166` | ❌ none | overcharge customer, audit drift |
| I-2 | ... | ... | ✅ `payments.service.spec.ts:42` | ... |

Invariants are not invented — they are the contract the code is already trying to keep, written down.

---

## 4. State machine

*Skip this section if the feature has no state (pure CRUD or read-only).*

**Status enum:** `prisma/schema.prisma:NN` — list values.

| From → To | Trigger | Guard (`file:line`) | Idempotent? | Side effects |
|-----------|---------|---------------------|-------------|--------------|
| `PENDING → PAID` | payment write | `payments.service.ts:NN` | yes (externalReference) | invoice gen, KDS event |
| ... | | | | |

**Forbidden transitions** (must be guarded; flag any unguarded ones in §7):
- `COMPLETED → PENDING` — explicitly rejected at `...`
- `CANCELLED → *` — terminal

**Transitions that should be idempotent but aren't** — flag in §7.

---

## 5. Money & precision audit

*Tier-1 money paths only (orders, payments, accounting, subscriptions, z-reports, delivery-platforms). Otherwise skip.*

**Decimal entry points** (where `Prisma.Decimal` first appears in this flow):
- `path:line` — what enters

**Decimal-to-Number conversions** (every one is a precision-loss hazard):
- `path:line` — `Number(x.amount)` — used for `... comparison/log/...` — risk: ...

Reproduce with `grep -n 'Number(\|parseFloat(\|toNumber()' backend/src/modules/<feature>/`.

**Rounding policy + tolerance constants:**
- "± 0.01 tolerance on split-bill" — `path:line` — justified because: ... — sunset condition: ...

**Sum-of-parts reconciliation:**
- Σ items vs totalAmount — asserted at `...` (or **NOT asserted** — flag in §7).

---

## 6. Concurrency hazards

**Critical sections + lock strategy:**
- `path:line` — `$transaction` + `Serializable` + conditional `updateMany` — protects: ...
- `path:line` — `pg_advisory_lock(N)` — protects: cron uniqueness across instances

**Race windows still open** (each with a reproduction sketch):
- *Sketch:* request A reads X, request B reads X, both write X+1 → only one increment lands.
  *Where:* `path:line`
  *Severity:* High Cor
  *Fix:* row-level lock / Serializable / unique constraint with retry

**Idempotency keys:**
- Present at: `path:line` (key field: `externalReference`)
- Missing where needed: `path:line` (retry path: ...) — flag in §7

---

## 7. Findings

Same format as `docs/CODE_REVIEW.md`. Verified findings unmarked; unverified flagged `*(unverified)*` with the line they came from.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | High | Cor | `path:line` | ... | ... |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec (security/multi-tenant) · Cor (correctness/business logic) · Arch (architecture/quality) · Perf (performance/reliability).

---

## 8. What's solid (positive findings)

Patterns that already work — call them out so future readers know what to keep, and so other features know what to copy.

- `path:line` — pattern name — what it does well — candidates that should adopt it: ...

---

## 9. Spot-checks performed

What was opened and end-to-end verified vs what stayed at "agent-reported".

**Verified:**
- F-1 confirmed at `path:line` — exact condition matches finding.

**Dropped (initial report was wrong):**
- "X was unsafe" — verified at `path:line`, the surrounding code already handles it via `...`. Drop.

**Downgraded:**
- F-N — severity dropped from High → Medium because: ...

---

## 10. Recommended tests

The 3–10 integration tests that would catch the §3 invariants and §6 race risks. Skeletons only; not full implementations.

```ts
// backend/src/modules/<feature>/__tests__/<feature>.integration.spec.ts
describe('<feature> invariants', () => {
  it('I-1: Σ payments ≤ order.totalAmount + 0.01', async () => {
    // arrange: order $10, three payments $4.00, $3.00, $3.00
    // act: assert third payment writes succeed but a fourth $0.01 fails
    // assert: ...
  });

  it('I-2 race: two simultaneous renewals create exactly one record', async () => {
    // arrange: subscription due now
    // act: Promise.all([renew(), renew()])
    // assert: count(subscriptionRenewal) === 1
  });
});
```

Cross-tenant invariant tests should follow the style from `CODE_REVIEW.md §3.1`:
*create two tenants → attempt cross-tenant access via every endpoint → assert zero leaks.*
