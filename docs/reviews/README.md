# `docs/reviews/` — Per-Feature Deep-Dive Code Reviews

This directory holds **one markdown file per feature** with a focused, business-logic-first code review. The top-level [`../CODE_REVIEW.md`](../CODE_REVIEW.md) is the index — read that first for the executive summary, the consolidated High findings table, cross-cutting observations, and the prioritized action plan.

The per-feature files exist because the previous round of review (2026-04-27, single-file) compressed every module into 3–6 rows of a findings table. That format scans well but **under-covers business logic** — invariants, state transitions, money-path precision, and concurrency hazards rarely fit in a one-line finding. This directory is where those live.

## How to read a per-feature file

Each file follows [`_template.md`](_template.md), with sections:

| § | Section | Purpose |
|---|---------|---------|
| 1 | Health & summary | One paragraph + emoji verdict. Read first. |
| 2 | Scope | What was read end-to-end vs skimmed vs skipped. |
| 3 | Business-logic invariants | Testable contracts the feature owes. **Most important — this is the business-logic core.** |
| 4 | State machine | States + transitions, guards, idempotency. Skip for pure CRUD. |
| 5 | Money & precision audit | Decimal path map. Tier-1 money paths only. |
| 6 | Concurrency hazards | Critical sections, race windows, idempotency keys. |
| 7 | Findings | Severity-tagged issues with `file:line` refs, same as the index format. |
| 8 | What's solid | Patterns to keep. Cross-links to other features that should adopt them. |
| 9 | Spot-checks performed | Verified / dropped / downgraded — keeps the audit honest. |
| 10 | Recommended tests | Test skeletons that would catch the §3 invariants + §6 races. |

## Tiers

Per-feature review depth is tiered. Tier defines which template sections are populated:

### Tier 1 — Business-logic critical (use **all 10** sections)

Features that own money flow, identity, or multi-tenant boundary state. Findings here are the highest leverage.

- [`orders.md`](orders.md), [`payments.md`](payments.md), [`accounting.md`](accounting.md), [`subscriptions.md`](subscriptions.md), [`z-reports.md`](z-reports.md), [`delivery-platforms.md`](delivery-platforms.md)
- [`auth.md`](auth.md), [`superadmin.md`](superadmin.md), [`tenants.md`](tenants.md)

### Tier 2 — Moderate (use **§1, §2, §3, §6, §7, §8, §9, §10**)

Features with non-trivial logic but no state machine / no money path. §3 invariants still required — tenant isolation, role gates, pagination caps all count.

- [`stock-management.md`](stock-management.md), [`marketing.md`](marketing.md), [`kds.md`](kds.md), [`analytics.md`](analytics.md), [`notifications.md`](notifications.md), [`customers.md`](customers.md), [`upload.md`](upload.md), [`settings-integrations.md`](settings-integrations.md)

### Tier 3 — Brief verdict (use **§1, §2, §7, §8** only)

Low-risk modules that have been scanned, with no significant findings. Grouped into one file:

- [`low-risk-modules.md`](low-risk-modules.md) — `modifiers`, `qr`, `layouts`, `tables`, `stock`, `contact`, `desktop-app`, `public-stats`, `pos-settings`, `personnel`, `reservations`, `reports`, `users`, `sms-settings`, `menu`, `customer-orders`, `customer-sessions`

### Schema audit (its own file)

- [`prisma-schema.md`](prisma-schema.md) — 87-model audit: FK constraints, compound indices, soft-delete consistency, multi-tenant column presence.

### Frontend parity

Same template adapted: §3 invariants become token/session/render contracts; §4 state machine applies to auth stores and socket lifecycle; §5 money audit skipped except where the client does price math.

- [`frontend-lib.md`](frontend-lib.md), [`frontend-auth-stores.md`](frontend-auth-stores.md), [`frontend-protected-routes.md`](frontend-protected-routes.md)
- [`frontend-pages-auth.md`](frontend-pages-auth.md), [`frontend-pages-subscription.md`](frontend-pages-subscription.md), [`frontend-pages-superadmin.md`](frontend-pages-superadmin.md)
- [`frontend-features-orders.md`](frontend-features-orders.md), [`frontend-features-kds.md`](frontend-features-kds.md), [`frontend-features-onboarding.md`](frontend-features-onboarding.md), [`frontend-features-marketing.md`](frontend-features-marketing.md), [`frontend-features-stock.md`](frontend-features-stock.md), [`frontend-features-analytics.md`](frontend-features-analytics.md)
- [`frontend-low-risk.md`](frontend-low-risk.md) — `voxel-world/` architectural note, UI primitives, hooks

### Landing

- [`landing.md`](landing.md) — `landing/` (Next.js marketing site); small surface, single file.

## Conventions

- **`file:line` refs everywhere.** Every claim — invariant, finding, state transition guard — pins to a path and line.
- **Severity scale:** Critical → High → Medium → Low → Info. Same as `../CODE_REVIEW.md`.
- **Dimensions:** **Sec** (security/multi-tenant), **Cor** (correctness/business logic), **Arch** (architecture/quality), **Perf** (performance/reliability).
- **Verified vs unverified:** untagged findings are verified end-to-end. `*(unverified)*` means the finding came from a targeted read against a snapshot, not yet confirmed at the line. Each Tier-1 file's §9 lists what was checked and what was dropped.
- **No new abstractions invented.** Findings are about what's there or what's missing; this directory does not propose redesigns. Action items live in `../CODE_REVIEW.md §7`.
- **No source code changes** are made when authoring or updating these files. They are documentation only. Fixes are picked up in follow-up PRs prioritized by the action plan.

## Adding a new per-feature file

1. Copy [`_template.md`](_template.md) → `<feature>.md`.
2. Set the Tier and trim unused sections per the tier table above.
3. Author §1 → §2 → §3 → §4 (if applicable) → §5 (if money) → §6 → §7 → §8 → §9 → §10 in that order. The invariants in §3 should fall out of reading §4/§5 first, not be invented up front.
4. Add a link to it from this README and from the TOC table in `../CODE_REVIEW.md`.
