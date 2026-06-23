# developer.hummytummy.com — Documentation Portal — Design

**Date:** 2026-06-23 · **Branch:** `feat/developer-docs-portal` · **Status:** Approved (goal-driven build)

## Problem
There is no single place documenting HummyTummy. We need a clean, professional, **bilingual (TR + EN)** documentation portal at **developer.hummytummy.com** covering the whole system: getting started, every admin page's purpose/details, plans & plan management, the marketplace add-ons, the developer/integration surface (API basics, Partner Display API, webhooks), and the desktop app.

## Stack & architecture
- New monorepo app **`developer/`** — Next.js + **Nextra** (`nextra-theme-docs`), MDX content. (Separate package; pins a Nextra-compatible Next version, independent of `landing/`'s Next 16.)
- **Bilingual** via Nextra i18n: locales `tr` (default) + `en`; per-page `*.tr.mdx` / `*.en.mdx`, `_meta.{tr,en}.json`, `nextra/locales` middleware.
- **Brand** = the warm landing/pricing language (cream `#faf6f0`, orange `#f97316`, ink `#1c1917`, Fraunces display) via `theme.config.tsx` (logo, primary hue, footer, head meta).
- Content sources: existing `docs/SISTEM_TANITIMI.md`, `docs/YONETICI_REHBERI.md`, `docs/partner-display-api.md`, and the live code (backend modules) for accuracy.

## Deploy (same VPS, mirrors landing/marketing)
- `developer/Dockerfile` (Next standalone) → container `developer` (port **3200**).
- `ops/nginx/developer.hummytummy.com.conf` → reverse-proxy to the container; versioned like the other vhosts.
- `docker-compose.prod.yml` + `docker-compose.staging.yml` service; image `ghcr.io/.../developer`.
- CI: build/push on tag in `release-deploy.yml`; `scripts/deploy.sh` swaps the container (staging via `test-deploy.yml`).
- **User-side (only external step):** Cloudflare DNS `developer` A/CNAME → VPS IP (proxied). Without it the subdomain won't resolve; everything else is automated.

## Information architecture (sidebar)
1. **Başlangıç / Getting Started** — what the system is, account creation, first-run setup, concepts (tenant, branch, roles).
2. **Yönetici Rehberi / Admin Guide** — per-page purpose + details: POS, QR Menu, KDS (kitchen), Tables, Orders, Stock/Inventory, Reports, Reservations, Personnel, Customers, Settings, Branches.
3. **Planlar / Plans** — the 3 packages (BASIC/PRO/BUSINESS), feature×plan matrix, choosing/upgrading/managing a plan, trial + TRIAL_ENDED, billing (TRY, monthly/yearly, havale).
4. **Marketplace** — every sellable add-on: what it grants, price, recurring/one-time, dependencies, how to purchase (checkout → PayTR → grant).
5. **Geliştirici / Developer** — API basics (base URL, auth realms, branch scope / X-Branch-Id, rate limits, error envelope, idempotency); **Partner Display API** (key → screen-session → /display + realtime, full recipe); **Webhooks** (subscribe, HMAC signature verification, event types, retries).
6. **Desktop Uygulaması / Desktop App** — install, auto-update (Tauri), hardware (printers, cash drawer), KDS/kiosk mode.
7. **Referans / Reference** — error codes, partner scopes, plan feature matrix, glossary.

## Phasing
- **Faz 1 — live skeleton:** Nextra app + brand theme + i18n + sidebar + home page + deploy infra (Dockerfile/compose/nginx/CI). developer.hummytummy.com live (pending DNS).
- **Faz 2 — core content (bilingual):** Webhooks, Developer/Integration (API + Partner Display), Marketplace, Plans & management, Desktop.
- **Faz 3 — expand:** full Admin guide (per page), Getting started, Reference.

Goal directive ("tüm sistem tamamlanana kadar durma") = build ALL three phases to completion + deploy to prod.

## Non-goals
- No auth on the docs (public). No live API console/playground (v1). No versioned docs (single current version). No search backend beyond Nextra's built-in flexsearch.
