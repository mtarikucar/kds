# ADR-0001: Record architecture decisions

- **Status:** accepted
- **Date:** 2026-06-11

## Context

Architecture decisions in this codebase live in two places today: dense
inline comments at the change site (excellent for local context) and
`docs/reviews/` (per-module audits). Neither captures *cross-cutting*
decisions — the kind that span modules, repos, or deploy infrastructure —
in a form a newcomer can find.

## Decision

We record cross-cutting architecture decisions as ADRs in
`docs/architecture/adr/`, numbered sequentially, using this format:
Context / Decision / Consequences. ADRs are immutable once accepted; a
reversal is a new ADR that supersedes the old one.

Inline comments remain the right place for module-local decisions — an
ADR is warranted when a decision constrains more than one module or
repo, or when "why didn't we just…" will be asked in a year.

## Consequences

- New cross-cutting decisions get a discoverable home.
- PR reviews can require an ADR for changes that alter system boundaries.
