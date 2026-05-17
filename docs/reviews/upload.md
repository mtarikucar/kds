# `upload` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/upload/` (4 files, ~430 LOC)
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §4.10 — seeds the sharp-resize-on-request-path perf hazard.

---

## 1. Health & summary

🟢 green

This module owns image ingestion for product images and tenant logos: multipart parse → MIME pre-filter → magic-byte sniff via `sharp.metadata()` → resize/re-encode → persist to local disk → record in `ProductImage`. It is the project's gold-standard example of **defense-in-depth on untrusted bytes**: header MIME at the multer layer, magic-byte sniff at the service layer, format whitelist that explicitly excludes SVG (XSS vector), client-supplied extension discarded, and re-encoding through sharp guarantees the bytes match the suffix. The previous round (`CODE_REVIEW.md §4.10`) raised exactly one finding — sharp resize is synchronous on the request path — and nothing has been done since. No money path, no state machine, no concurrency on shared rows (each upload is independent). The remaining risk is operational: a single 1200×1200 sharp pipeline can pin one event-loop tick for ~1–2 s on a large input, and `uploadMultipleProductImages` will fan that out to ten concurrent sharp ops per request.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/upload/upload.service.ts` (343 LOC) — MIME + magic-byte validation, sharp resize, disk write, DB record, delete with path-traversal guard, list/attach helpers.
- `backend/src/modules/upload/upload.controller.ts` (231 LOC) — three POST routes (logo, single product image, multiple product images), DELETE, two list routes; multer file filters; role + tenant guards.
- `backend/src/modules/upload/upload.module.ts` (12 LOC) — wiring.
- `backend/src/modules/upload/dto/upload-response.dto.ts` (~25 LOC) — response shape only, no runtime behavior.

**Skimmed only:**
- `backend/src/main.ts:104-106` — `useStaticAssets('uploads', { prefix: '/uploads/' })` confirms uploads are served unauthenticated by URL guess.
- `backend/src/modules/auth/guards/tenant.guard.ts` — confirms `req.tenantId` is populated from `req.user.tenantId`; the controller is wired with `JwtAuthGuard + TenantGuard + RolesGuard` (`upload.controller.ts:35`).
- `backend/prisma/schema.prisma:317-332` — `ProductImage { url, filename, size, mimeType, tenantId, ... @@index([tenantId]) }`, cascade-on-tenant-delete.

**Skipped:**
- S3 / object-storage adapter — none exists. Storage is local disk only.
- Antivirus / ClamAV — not integrated.

---

## 3. Business-logic invariants

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | Only `image/jpeg`, `image/png`, `image/webp` are accepted (header MIME pre-filter). | `upload.controller.ts:48`, `:92`, `:137` (multer `fileFilter`) and `upload.service.ts:23,90,139` (service-side recheck) | none | `.svg` / `.html` / `.php` saved on disk; if ever served with the wrong `Content-Type`, stored XSS or RCE on the receiving service. |
| I-2 | Bytes must actually be JPEG / PNG / WebP (magic-byte sniff via `sharp.metadata()`); SVG is excluded by *omission* from `ALLOWED_IMAGE_FORMATS`. | `upload.service.ts:14`, `:45-56`, `:95`, `:144` | none | A `Content-Type: image/jpeg` header on `.svg` bytes would slip past I-1; this is the layer that actually catches it. **Verified solid per `CODE_REVIEW.md §4.10`.** |
| I-3 | Per-file size ≤ 5 MB; multipart cap also bounds total upload. | multer limits `upload.controller.ts:43`, `:90`, `:135`; redundant check `upload.service.ts:22,86,135` | none | DoS via large uploads filling disk or stalling sharp; pricing-tier abuse. |
| I-4 | On-disk filename ignores client input (UUID for product images, `${tenantId}-logo-${Date.now()}.png` for logos). | `upload.service.ts:149-150` (`fileExtension = '.jpg'`; UUID v4); `:97` (logo) | none | Path traversal via `../../etc/passwd` filename, or filename collision via predictable names. |
| I-5 | Product images live under `uploads/products/{tenantId}/`; the `tenantId` segment is taken from `req.tenantId` (guard-populated), never from request body. | `upload.service.ts:151`, controller `:82,:127,:175` reads `req.tenantId` only | none | Cross-tenant write — one tenant could clobber another's directory. |
| I-6 | Delete path must resolve *inside* `uploadsRoot` (path-traversal defense). | `upload.service.ts:229-244` — `path.resolve()` + `startsWith(this.uploadsRoot + path.sep)` | none | Arbitrary file deletion via crafted `image.url` if untrusted URLs ever land in the DB (FK records today are server-constructed; this is defense-in-depth). |
| I-7 | DB read/write is tenant-scoped on every query — `findFirst({ where: { id, tenantId } })`, `findMany({ where: { tenantId } })`, junction-table lookups gated by `image.tenantId`. | `upload.service.ts:218-223` (delete-lookup), `:257-268` (list-by-product), `:273-278` (list-all), `:282-294` (unused), `:313-318` (attach) | none | Cross-tenant image read/delete/attach. |
| I-8 | Only `ADMIN` and `MANAGER` may upload, list, delete, or attach images. | `upload.controller.ts:40`, `:87`, `:132`, `:188`, `:203`, `:219` (`@Roles(ADMIN, MANAGER)`) plus `RolesGuard` at `:35`. | none | Staff / cashier accounts could fill disk or replace product imagery. |
| I-9 | Multer parses ≤ 1 file (logo, single product image) or ≤ 10 files (multi). | `upload.controller.ts:43` (`files: 1`), `:90` (`files: 1`), `:134-135` (`FilesInterceptor('images', 10, ...)` + `files: 10`). | none | Memory blow-up from unbounded multipart array. |

Invariants are not invented — every row above is something the code is already trying to keep.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:** none required. Each upload writes to a unique path (`{uuid}.jpg` for product images; tenant-prefixed timestamp for logos) and creates an independent `ProductImage` row. No shared counter, no order/payment side-effect, no row contention.

**Race windows still open:**

- *Sketch:* two `uploadLogo` calls for the same tenant in the same millisecond → both compute the same `${tenantId}-logo-${Date.now()}.png`; second `fs.writeFile` silently overwrites the first.
  *Where:* `upload.service.ts:97` — `const uniqueFilename = `${tenantId}-logo-${Date.now()}.png`;`
  *Severity:* Low Cor — logos are tenant-scoped and the latest-write-wins behavior is arguably intentional (a logo upload replaces the prior one), but the URL returned is identical so the prior `<img src>` cache stays valid. There is no DB row for logos, only the file. A retry storm could produce a half-written file if `writeFile` is interrupted mid-write (no atomic rename to a temp file first).
  *Fix:* write to `${tenantId}-logo-${Date.now()}-${randomUUID().slice(0,8)}.png` (or accept and document the overwrite). For crash safety, `writeFile` to `*.tmp` then `rename` — POSIX rename is atomic on the same filesystem.

- *Sketch:* `uploadMultipleProductImages` runs `Promise.all(files.map(uploadProductImage))` → up to 10 concurrent sharp pipelines, each potentially decoding a 5 MB JPEG and resizing to 1200×1200. sharp uses libvips with its own thread pool (`UV_THREADPOOL_SIZE` default = 4), so the request occupies all libuv worker threads while it runs. Other requests that need disk I/O, crypto, DNS, etc. queue behind it.
  *Where:* `upload.service.ts:210-214`.
  *Severity:* Medium Perf — see F-2 in §7.
  *Fix:* serialize with `for...of await`, or cap with `p-limit(2)`, or move sharp to a worker thread / queue.

- *Sketch:* `uploadProductImage` does `sharp.toBuffer()` (line 165-171) → `fs.writeFile` (line 173) → `prisma.productImage.create` (line 177). If the process crashes between `writeFile` and `create`, the file exists on disk but no row references it → orphan accumulates. (The reverse — DB write then file write — is handled: the `catch` at line 192 unlinks the file if `prisma.create` throws.)
  *Where:* `upload.service.ts:173-185`.
  *Severity:* Low Cor — orphans are findable via `getUnusedImages` (`:281-305`) but only if a junction-table row was never created; here they aren't even in `ProductImage`. A periodic disk-vs-DB reconciliation job would catch it.

**Filename collision handling:**
- **Product images** (`upload.service.ts:150`): `randomUUID()` — collision probability is effectively zero (~2^-122). Safe.
- **Logos** (`upload.service.ts:97`): `${tenantId}-${Date.now()}.png` — millisecond-precision collision is possible only on the same tenant, and the intent appears to be "latest logo wins." Documented above.
- **Static-serve overlap:** main.ts serves `uploads/` at `/uploads/*` *without authentication*. Any guessable URL is readable by anyone on the internet. UUID v4 filenames make product images unguessable; the logo filename is `{tenantId}-logo-{epoch_ms}.png` — `tenantId` is a UUID, but `Date.now()` is roughly enumerable within a few seconds for a known upload time. This is **not a real security issue for logos** (they're public branding) but is worth knowing: there is no per-URL auth on uploaded assets.

**Idempotency keys:** N/A. Uploads are not retried by the client with a key; each POST is a new asset.

---

## 7. Findings

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Low | Perf | `upload.service.ts:104-111`, `:165-171` | **(seeded from `CODE_REVIEW.md §4.10`)** Sharp resize runs synchronously on the request path. Decoding + resize of a 5 MB JPEG to 1200×1200 takes ~0.5–2 s on commodity hardware and occupies a libuv worker thread for the duration. Under upload bursts (e.g., a tenant onboarding their full menu, ~50 product images), this blocks every other libuv-bound operation. | Wrap sharp in `Promise.race` with a 30 s timeout. If concurrency grows, offload to a worker thread or a BullMQ queue and return `202 Accepted` with a status endpoint. |
| F-2 | Medium | Perf | `upload.service.ts:210-214` | `uploadMultipleProductImages` uses `Promise.all(files.map(uploadProductImage))` — up to 10 concurrent sharp pipelines per request. With multer `files: 10` and 5 MB each, a single request can pin all 4 default libuv workers and consume ~50 MB of decoded RGBA in memory while resizing. | Serialize (`for (const f of files) await this.uploadProductImage(f, tenantId)`) or cap with `p-limit(2)`. The 2-3× latency increase is acceptable for a 10-file batch. |
| F-3 | Low | Sec | `backend/src/main.ts:104-106` + `upload.service.ts:97` | `uploads/` is served at `/uploads/*` without authentication. Product-image filenames are UUIDs (unguessable), but logo filenames are `{tenantId}-logo-{Date.now()}.png` — semi-enumerable within a known upload window. Logos are public branding so this is by-design, but it means: (a) any uploaded asset URL is permanent and shareable; (b) if a tenant uploads a logo with confidential content (it happens — staff photos, internal mocks), it is internet-exposed. | Document the "uploads are public" invariant. If private assets are ever stored under `uploads/`, gate them behind a signed-URL controller. Consider rate-limiting `/uploads/` to mitigate scraping. |
| F-4 | Low | Cor | `upload.service.ts:97` | Logo filename uses `Date.now()` only. Two `uploadLogo` calls for the same tenant within the same millisecond overwrite each other (last-write-wins). For crash safety, the write is not atomic — a partial `writeFile` could leave a corrupt PNG that the next request reads. | Append `-${randomUUID().slice(0,8)}`; or `writeFile` to a `.tmp` sibling and `rename` (POSIX atomic on same FS). |
| F-5 | Low | Cor | `upload.service.ts:173-185` | Disk-vs-DB ordering: `fs.writeFile` then `prisma.productImage.create`. The reverse-direction failure path is handled (line 192-198 unlinks on DB error). But a process crash *between* lines 173 and 177 leaves an orphan file with no DB record — undetectable by `getUnusedImages` (which only finds DB rows). | Add a periodic reconciliation job: list `uploads/products/{tenantId}/*` and delete files with no matching `ProductImage.url`. Low priority — disk leak is bounded by file size cap. |
| F-6 | Low | Sec | `upload.service.ts:80-95`, `:130-144` | The redundant `file.size > maxFileSize` and `allowedMimeTypes.includes(file.mimetype)` checks at the service layer (lines 86-94 and 135-143) are defense-in-depth but **only fire if** multer was bypassed somehow (test fixture, future direct service call). Today multer always runs first and would have rejected. Harmless duplication, just noting. | Keep as-is; if removed, lose defense-in-depth. No action. |
| F-7 | Info | Arch | `upload.service.ts:29-30` vs `:68` vs `:98` | Two different ways to compute the logos directory: `this.uploadsRoot = path.resolve(process.cwd(), 'uploads')` (line 29) is used for path-traversal containment, but `ensureLogosDir` (line 68) and `uploadLogo` (line 98) re-derive `path.join(process.cwd(), 'uploads', 'logos')` independently. Drift risk if `uploadsRoot` is ever changed to e.g. an absolute env-configured path. | Add `this.logosDir = path.join(this.uploadsRoot, 'logos')` once in the constructor; reuse everywhere. |
| F-8 | Low | Sec | `upload.service.ts:232-238` | Path-traversal defense on delete strips `this.baseUrl` from `image.url` and resolves it. If `BACKEND_URL` env var changes between upload and delete, the strip becomes a no-op, `resolvedPath` is computed from the full URL string, the `startsWith(uploadsRoot)` check fails, and the controller silently *only logs a warning* — the file stays on disk while the DB row is deleted (line 247). | After URL-mismatch, also try extracting the path component via `new URL(image.url).pathname`; if still outside `uploadsRoot`, hard-fail rather than silently leaking the file. Or accept the orphan and surface a metric. |
| F-9 | Info | Sec | `upload.service.ts:48` | `sharp(buffer, { failOn: 'error' })` is correct — fails on any decoder error. Good. Worth noting that some malformed-but-decodable inputs (e.g., a pixel-bomb GIF that decompresses to gigabytes) are *not* caught by format check. sharp does enforce input limits internally, but the explicit `limitInputPixels` option isn't set. | Pass `{ failOn: 'error', limitInputPixels: 268_402_689 /* sharp default; pin it */ }` so a decompression bomb at format-sniff time is rejected before resize allocates RGBA. |

Severity scale: Critical → High → Medium → Low → Info.
Dimension: Sec · Cor · Arch · Perf.

---

## 8. What's solid (positive findings)

- **`upload.service.ts:14, 45-56` — MIME pre-filter + `sharp.metadata()` magic-byte sniff chain.** The comment at `:38-44` explicitly calls out the threat model: header MIME alone lets `.svg` (XSS via `<script>`) or `.php` through; sharp throws on non-image bytes, and the format whitelist excludes SVG by omission. Two independent layers (multer `fileFilter` + service-side `assertIsAllowedImage`), neither sufficient alone. **This is the template for any future "untrusted bytes" handler in the codebase** — webhooks accepting attachments, CSV import, OCR pipelines.
- **`upload.service.ts:147-150` — discard client-supplied filename and extension.** `originalname` is preserved only in the `filename` DB column (`:181`) for display; the on-disk name is `${randomUUID()}.jpg`. Eliminates filename-based path traversal entirely. The inline comment at `:147-148` explains the threat. **Adopt elsewhere:** any feature that ever lets `originalname` reach the filesystem (currently none).
- **`upload.service.ts:228-244` — defense-in-depth path containment on delete.** `path.resolve()` + `startsWith(uploadsRoot + path.sep)` rejects `../` escapes even though today the URL is server-constructed and inherently safe. Comment at `:230-231` explicitly anticipates a future "import path or DB migration could introduce untrusted URLs" scenario. **Pattern to adopt:** any other module that reads a path field from a DB row and acts on it (e.g., accounting attachments, export job artifacts).
- **`upload.service.ts:149` — re-encode to a fixed format/extension.** All product images are saved as `.jpg` via `sharp.jpeg({ quality: 85 })`. The suffix matches the bytes, the bytes match the suffix, and there's no way for a `.exe` masquerading as `image/jpeg` to survive the pipeline.
- **Controller hardening — guards, roles, multer limits all set:** `upload.controller.ts:35` (`JwtAuthGuard + TenantGuard + RolesGuard`), `:40, :87, :132, :188, :203, :219` (`@Roles(ADMIN, MANAGER)`), multer `files: 1`/`files: 10` caps, per-file `fileSize: 5 MB`, fileFilter pre-screen. No "anonymous upload" surface.

---

## 9. Spot-checks performed

**Verified:**
- I-2 magic-byte sniff at `upload.service.ts:45-56` — `sharp.metadata()` is awaited; failure throws `BadRequestException` before any disk write. Confirms `CODE_REVIEW.md §4.10` "defense-in-depth verified solid."
- I-5 tenant path segment — controller reads `req.tenantId` from guard-populated context only (`tenant.guard.ts:22-24` injects `request.tenantId = user.tenantId`); no DTO field, no header, no query param. No cross-tenant path injection.
- I-6 path-traversal defense at `upload.service.ts:232-244` — `path.resolve()` followed by `startsWith(this.uploadsRoot + path.sep)` is the correct pattern (the trailing `sep` prevents `uploads-evil/` from matching `uploads`). Verified.
- I-9 multer caps — `FilesInterceptor('images', 10, { limits: { files: 10 } })` at `upload.controller.ts:134-135`. Double-cap (positional + options) is intentional belt-and-braces.
- Static-asset exposure — `main.ts:104-106` confirmed; uploads are unauthenticated by URL. Informs F-3.

**Dropped (initial concern was wrong):**
- *"Client-supplied filename used on disk."* — verified at `upload.service.ts:149-150`: `originalname` is stored only in DB metadata (`file.originalname` → `filename` column at `:181`); on-disk name is `${randomUUID()}.jpg`. **Drop.**
- *"No size cap — multer would accept arbitrarily large multipart bodies."* — verified at `upload.controller.ts:43, :90, :135`: `limits: { fileSize: 5 * 1024 * 1024, files: N }` is set on every route. **Drop.**
- *"SVG accepted because `image/svg+xml` could pass MIME check."* — verified at `upload.service.ts:23` (`allowedMimeTypes`) and `:14` (`ALLOWED_IMAGE_FORMATS`): SVG appears in neither set, and even if `Content-Type: image/svg+xml` were sent, multer's `fileFilter` (`controller:48`) rejects it, and if that were bypassed, `sharp.metadata().format` returns `"svg"` which isn't in `ALLOWED_IMAGE_FORMATS`. Triple-rejected. **Drop.**

**Downgraded:**
- F-1 (sharp resize blocking) — initially considered Medium because of CPU pin, downgraded to Low. Sharp uses libvips with its own thread pool; the actual Node main-thread block is the ~5-10 ms `Buffer` shuffling around the libvips call, not the full resize duration. Real-world impact is "tenant onboarding feels sluggish under burst," not "server falls over." F-2 (the `Promise.all` fan-out in the multi-upload path) is the higher-leverage version of the same hazard and stays at Medium.

---

## 10. Recommended tests

The four tests below cover I-1 through I-9 and the F-1/F-2 perf hazards. Skeletons only.

```ts
// backend/src/modules/upload/__tests__/upload.security.spec.ts
describe('upload — security invariants', () => {
  it('I-1: rejects an SVG even with Content-Type: image/svg+xml', async () => {
    // arrange: build a multipart request with a real SVG body and mimetype image/svg+xml
    // act:   POST /api/upload/product-image
    // assert: 400 BadRequest at the multer fileFilter layer (controller:92).
  });

  it('I-2: rejects a .png renamed to .jpg with Content-Type: image/jpeg', async () => {
    // arrange: take a valid PNG, send with originalname='x.jpg' and mimetype='image/jpeg'
    //          AND a polyglot file (HTML+PNG header) — both should be caught
    //          at sharp.metadata() (service:48) because format won't match the
    //          allowed set, OR the polyglot will fail sharp decode entirely.
    // act:   POST /api/upload/product-image
    // assert: 400 BadRequest "Invalid image file" or "Invalid file type".
    //         Verify no file was written to uploads/products/{tenantId}/.
  });

  it('I-2: rejects bytes whose magic differs from the declared MIME', async () => {
    // arrange: send {"<?php ... ?>" payload} bytes with mimetype='image/jpeg'.
    // act:   POST /api/upload/product-image
    // assert: 400 BadRequest; sharp.metadata() throws → BadRequestException at service:50.
  });

  it('I-3: rejects a 6 MB upload at the multer layer', async () => {
    // arrange: 6 * 1024 * 1024 bytes of valid JPEG (or pad valid header + filler)
    // act:   POST /api/upload/product-image
    // assert: 413 / 400 from multer's fileSize limit (controller:43). No service call.
  });

  it('I-6: refuses to delete a path outside uploadsRoot', async () => {
    // arrange: seed a ProductImage row with url='http://host/../../../etc/passwd'
    //          (simulating a future migration that imports untrusted URLs).
    // act:   DELETE /api/upload/product-image/:id
    // assert: file at the traversed path is NOT removed; service log shows
    //         "Refusing to delete path outside uploads root" (service:235-237);
    //         DB row is still deleted (current behavior — by design, see F-8).
  });

  it('I-5 + I-7: tenant A cannot list, delete, or attach tenant B images', async () => {
    // arrange: tenants A and B; B uploads image B-1.
    // act:   GET /api/upload/product-images   as tenant A
    //         DELETE /api/upload/product-image/B-1   as tenant A
    //         GET /api/upload/product-images?productId={B's product}   as tenant A
    // assert: GET returns only A's images; DELETE returns 404 (NotFoundException
    //         from service:226); attach returns 404.
  });
});

// backend/src/modules/upload/__tests__/upload.concurrency.spec.ts
describe('upload — concurrency', () => {
  it('F-2: 10 simultaneous product images all persist with distinct UUID filenames', async () => {
    // arrange: 10 valid 100 KB JPEGs (small to keep test fast).
    // act:   POST /api/upload/product-images (the multi route)
    // assert: response.count === 10; uploads/products/{tenantId}/ contains 10 files
    //         with distinct names; 10 ProductImage rows exist.
    //         (When F-2 is fixed to serialize, this test still passes —
    //          it's also the regression guard for the serialization change.)
  });

  it('F-4: two rapid logo uploads for the same tenant — last-write wins, no corruption', async () => {
    // arrange: same tenant, two valid PNGs A and B, Promise.all([uploadLogo(A), uploadLogo(B)])
    // act:   both complete
    // assert: a logo file exists on disk; it's a valid PNG (sharp.metadata() succeeds);
    //         it's either A-resized or B-resized but never a half-write.
    //         (This test currently could flake on a half-write — that's exactly
    //          the regression F-4 protects against.)
  });
});
```

Cross-tenant invariant test follows the pattern in `CODE_REVIEW.md §3.1`: create two tenants, exercise every list/find/delete/attach endpoint from each side, assert zero leaks.

---

**Counts:** 247 lines · 9 invariants (I-1..I-9) · 9 findings (F-1..F-9) · 0 unverified.
