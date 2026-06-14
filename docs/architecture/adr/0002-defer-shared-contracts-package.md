# ADR-0002: Defer the shared contracts package; enforce mirrors with a drift guard

- **Status:** accepted
- **Date:** 2026-06-11

## Context

The frontend deliberately mirrors a handful of backend constants
(UserRole, HARD_RESTRICTED_ROLES, OrderStatus, OrderType, PaymentStatus)
because it cannot import backend source. The textbook fix is a shared
`packages/contracts` workspace package imported by both sides.

However, the production build pipeline builds each app from its own
Docker context (`docker-compose.prod.yml`: `context: ./backend`,
`context: ./frontend`; same in staging and both deploy workflows). A
shared package would not exist inside those contexts — adopting it means
moving every build context to the repo root, rewriting COPY layers in
each Dockerfile, and revalidating registry layer caching, all on the
production deploy path.

Real drift has already happened: the frontend `OrderType` enum was
missing `COUNTER` while the backend actively wrote it.

## Decision

1. **Now:** enforce the mirrors mechanically instead of structurally.
   `scripts/check-contract-drift.mjs` parses both sides from source and
   fails CI on any mismatch (wired into `quality-gates.yml`);
   `frontend/src/types/contract-drift.test.ts` pins the same values
   inside the frontend suite. The backend is the source of truth.
2. **Later, as its own change:** introduce npm workspaces + a
   `packages/contracts` package, moving Docker build contexts to the
   repo root. That migration must ship alone — never coupled to feature
   work — because its blast radius is the entire deploy pipeline.

## Consequences

- Drift is now a CI failure instead of a silent runtime mismatch.
- Adding a mirrored constant requires adding a `CHECKS` entry in the
  drift script (the script's header says so).
- The workspaces migration has a written prerequisite list when someone
  picks it up.
