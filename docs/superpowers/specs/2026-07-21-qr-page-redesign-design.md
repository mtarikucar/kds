# QR Management Page — Two-Pane Redesign

**Date:** 2026-07-21 · **Page:** `frontend/src/pages/admin/QRManagementPage.tsx` (`/admin/qr-codes`)
**Approved:** user picked the "two-pane layout" option (terminal A/B/C selection).

## Problem

The QR admin page is cluttered and wastes vertical space:

- A 3-tile statistics row (total QR / table QR / restaurant QR counts) conveys nothing actionable — the counts are visible from the grids themselves. **User explicitly asked to remove it.**
- Two separate "tips" surfaces (pro-tips box inside the hero card + a batch-tips strip at the bottom).
- The restaurant (hero) QR card spends half the screen on a 3-button size selector + 3-button format selector that are rarely used.
- Batch actions live in the page header, far from the table-QR grid they act on.
- No way to find a specific table once a restaurant has many tables.

## Design

Codes tab becomes a two-pane layout (`lg:` and up; stacked on mobile):

- **Left pane (sticky):** compact Restaurant QR hero card — QR preview, caption, menu URL with copy, one primary **Download** button opening a dropdown (PNG / SVG / PDF, always exported print-quality at 1200×1200), then Print / Preview (+ Share when supported). Size & format selector grids and the pro-tips box are removed.
- **Right pane:** Table QR codes card — header with count badge, a **search input** filtering tables by label, and the batch actions (Print sheet, Download all) moved here from the page header. Grid of existing compact cards. Empty states: no tables at all (existing) and no search match (new).
- **Removed entirely:** stats tile row, batch-tips strip, page-header batch buttons, page-level "download ALL codes incl. restaurant" action (the hero has its own download; the table section keeps its own download-all).
- **Kept:** page header (gradient icon is the shared admin-page convention), tabs (Codes / Design), Design tab untouched, guided-tour anchors `data-tour="qr-management" | "qr-codes-list" | "qr-download"`, operator caption rendering (pinned by `QrCodeDisplay.spec.tsx`), compact table-card variant, element IDs `qr-<id>-medium` / `qr-<id>-small` that the print/batch paths look up.
- When `enableTableQR` is off, the hero card centers alone (`max-w-xl mx-auto`).

## Implementation notes

- `QrCodeDisplay.tsx` non-compact branch rewritten as the hero card; `sizePresets` gone; downloads render the single on-screen SVG onto a 1200×1200 canvas (SVG is vector — crisp at any raster size). Single-QR print window sizes the SVG to `70mm` for predictable physical output.
- Search filter is local state, locale-insensitive `toLocaleLowerCase()` comparison.
- Uses existing UI primitives: `dropdown-menu.tsx`, `Input`, `Button`.
- i18n: new keys mirrored to **all 5 locales** (ar/en/ru/tr/uz): `admin.searchTablesPlaceholder`, `admin.noTablesMatchSearch`, `qr.downloadAs`. Now-unused keys removed from all 5: `admin.totalQRCodes`, `admin.batchTips`, `admin.batchTip1..3`, `admin.tableTent`, `admin.standard`, `admin.poster`, `qr.previewSize`, `qr.downloadFormat`, `qr.downloadFile`, `qr.proTipsTitle`, `qr.proTip1..3` (each verified unused by grep before removal).
- Tests: keep `QrCodeDisplay.spec.tsx` green (caption pins); add `QRManagementPage.test.tsx` (mocked `qrApi` hooks) covering: stat tiles absent, search filters the grid, batch actions live in the table section, tour anchors present.
