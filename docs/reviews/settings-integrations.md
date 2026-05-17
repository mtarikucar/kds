# `settings/integrations/` — Deep Review (2026-05-11)

**Tier:** 2
**Reviewer:** Claude (Opus 4.7)
**Source paths reviewed:** `backend/src/modules/settings/integrations/**`, cross-reference `backend/src/common/helpers/encryption.helper.ts`, `backend/prisma/schema.prisma` (`IntegrationSettings`).
**Related upstream:** [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §4.12 (seed — clean), §8 (gold-standard callout), §7 P0 item M8 (accounting must adopt). This file expands the §4.12 seed end-to-end and documents the pattern other modules should copy.

---

## 1. Health & summary

🟢 **green.**

This module owns one job and does it well: store third-party integration configuration for a tenant (payment gateways, delivery apps, accounting providers, CRMs, plus hardware devices for the desktop app) such that credentials never leak to the HTTP surface and never sit at rest in plaintext. The three pillars are in place — AES-256-GCM envelope encryption on write (`integrations.service.ts:161, 188`), key-name-based redaction on every HTTP response surface (`integrations.service.ts:99-106`), and an explicit `findOneWithSecrets` method (`integrations.service.ts:136-142`) that is the *only* path returning decrypted credentials. Tenant scoping is enforced on every read and write, role gating is correctly tiered (ADMIN-only for writes, ADMIN/MANAGER for reads), and the sensitivity policy is locked to `integrationType` so an admin cannot smuggle plaintext into a previously-encrypted row by re-targeting it (the `UpdateIntegrationDto` omits `integrationType` and `provider` — `update-integration.dto.ts:10-12`). The status of this module has not changed since the §4.12 seed; this Tier-2 review confirms the seed verdict and elevates the module to **the reference template for credential storage** that the accounting module (M8) and any future third-party integration must adopt.

The findings below are minor — a credential-rotation read-modify-write race that loses an in-flight `name`/`notes` edit if two admins update the same row simultaneously, an audit-log gap on credential writes, and a small inconsistency in the `decryptConfig` mutation path. None of them break the security contract; they are the polish-pass items remaining after the pattern itself is sound.

---

## 2. Scope of this review

**Read end-to-end:**
- `backend/src/modules/settings/integrations/integrations.service.ts` (321 LOC) — encryption / redaction / CRUD / hardware sub-API.
- `backend/src/modules/settings/integrations/integrations.controller.ts` (152 LOC) — admin CRUD controller + `HardwareConfigController` for desktop-app.
- `backend/src/modules/settings/integrations/dto/create-integration.dto.ts` (40 LOC) — `CreateIntegrationDto`, `IntegrationType` enum.
- `backend/src/modules/settings/integrations/dto/update-integration.dto.ts` (12 LOC) — `OmitType` defence on `integrationType`/`provider`.
- `backend/src/modules/settings/settings.module.ts` (12 LOC) — wiring; exports `IntegrationsService`.

**Cross-referenced (skim):**
- `backend/src/common/helpers/encryption.helper.ts` (118 LOC) — `encryptJson`/`decryptJson`/`encryptString`/`isEncryptedPayload`. The line-level pattern reference for §3 invariants is `encryption.helper.ts:43-54` (encryptJson, AES-256-GCM + base64url envelope) and `:56-92` (decryptJson, GCM auth-tag verification + domain-specific `DecryptionError`).
- `backend/prisma/schema.prisma:1066-1094` — `IntegrationSettings` model: `tenantId` (cascade), compound unique `[tenantId, integrationType, provider]`, indexed on `tenantId` and `integrationType`, `config Json` (encrypted envelope or plain device JSON based on type).
- `backend/src/modules/delivery-platforms/services/delivery-config.service.ts` (288 LOC) — separate but parallel implementation of the same pattern (cross-link in §8); reads `encryptJson` on `credentials` (`:125, 168`) and `encryptString` on `accessToken` (`:221`).
- `backend/src/modules/auth/guards/tenant.guard.ts` — confirms `req.tenantId` injection from JWT (the source the controller hands to every service call).

**Skipped:**
- The desktop-app consumer of `/api/hardware/config` (`desktop/` Tauri shell, out of scope this round).
- The downstream adapters (`StripeAdapter`, `IyzicoAdapter`, etc.) — **not yet wired**: `grep -rn "findOneWithSecrets" backend/src --include="*.ts"` returns zero call sites outside `integrations.service.ts` itself. The method is provisioned, not yet exercised. Flagged in §7.

**Module-level facts:** 5 files, ~537 LOC. 0 spec files for the module itself (`encryption.helper.spec.ts` covers the helper but not the service). The exemplar status applies to the *implementation pattern*; test coverage is the same gap the rest of the backend has.

---

## 3. Business-logic invariants

The contracts this feature owes. Each row is testable via the §10 skeletons.

| # | Invariant | Enforced at (`file:line`) | Test coverage | Risk if violated |
|---|-----------|---------------------------|---------------|------------------|
| I-1 | **Secrets encrypted at rest via `encryptJson`.** For every `integrationType ∈ {PAYMENT_GATEWAY, THIRD_PARTY_API, DELIVERY_APP, ACCOUNTING, CRM}` the `config` column on disk is an `EncryptedPayload` envelope (`{ciphertext, iv, authTag}` base64url), not plain JSON. | Sensitivity gate `integrations.service.ts:23-29, 67-69` (`SENSITIVE_INTEGRATION_TYPES`); write enforcement `integrations.service.ts:160-162` (create) and `:187-189` (update). Envelope shape produced at `encryption.helper.ts:43-54`. | ❌ none for the service (helper has `encryption.helper.spec.ts`). | Database dump or read-replica compromise leaks every tenant's Stripe / Iyzico / Paraşüt / Foriba / HubSpot credentials. The whole point of the module. |
| I-2 | **Plaintext only via `findOneWithSecrets()` for adapter use.** No other code path returns decrypted credentials. `findOne`, `findAll`, `findByType`, `toggleStatus`, `create`, `update` all route through `toPublicView` (`integrations.service.ts:99-106`), which composes `decryptConfig` + `redactSensitiveKeys`. | `findOneWithSecrets` defined exactly once at `integrations.service.ts:136-142`; comment at `:132-135` warns *"Never call from controllers."* `toPublicView` returns redacted shape — `:99-106`. | ❌ none. Also: no production call site yet — see F-1 in §7. | An adapter that reads the row directly via `prisma.integrationSettings.findFirst` and forgets to call `decryptConfig` will treat the encrypted envelope as opaque JSON and the upstream API call will fail with a 401 from Stripe. The bigger risk is the inverse — a controller that exposes the row directly and leaks the envelope, which is at least an "encrypted blob in the response" rather than plaintext, but still a footgun. |
| I-3 | **HTTP responses ALWAYS redacted (`***REDACTED***`).** Every controller endpoint that returns an integration routes through `toPublicView` → `redactSensitiveKeys`, which masks any key matching `/api.?key/i`, `/secret/i`, `/token/i`, `/password/i`, `/client.?secret/i`, `/private.?key/i`. | Redaction list `integrations.service.ts:34-41`; redaction logic `:44-59`; routing through `toPublicView` for every public method — `findAll` (`:113`), `findByType` (`:121`), `findOne` (`:129`), `create` (`:176`), `update` (`:196`), `toggleStatus` (`:216`). Plus the typed-defence in `update-integration.dto.ts:10-12` prevents an admin from re-typing a sensitive row to hardware to leak the encrypted blob shape. | ❌ none. | A MANAGER-scoped UI reads its own integrations list and sees Stripe `sk_live_...` keys on screen. Past inflection point: the redaction pattern array is matched by `Object.entries(...)` key name, so a custom-named field like `xPlatformAuth` slips through — see F-3. |
| I-4 | **Tenant scoping on every read and write.** No row is read or mutated without a `where.tenantId = req.tenantId` clause. | `findAll` `:110`, `findByType` `:118`, `findOne` `:126`, `findOneWithSecrets` `:138`, `create` `:148` (compound unique), `update` `:181`, `delete` `:201` (`deleteMany`), `toggleStatus` `:209`, `updateLastSync` `:221`, `updateDeviceStatus` `:268`, `reportDeviceEvent` `:305`. `TenantGuard` (`auth/guards/tenant.guard.ts:17-22`) injects `req.tenantId` from the JWT; the controller passes it on every call. | ❌ none — no cross-tenant integration test exists in the repo. | Cross-tenant credential read or write. The compound unique `[tenantId, integrationType, provider]` at `schema.prisma:1090` provides DB-level protection against same-tenant duplicate registration but does not by itself enforce tenant isolation. |
| I-5 | **Role gating: ADMIN-only for writes, ADMIN/MANAGER for reads.** | Controller class-level guards `integrations.controller.ts:29` (`JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard`); per-route `@Roles(UserRole.ADMIN)` on POST/PATCH/DELETE/`toggle` (`:55, 64, 77, 86`); `@Roles(UserRole.ADMIN, UserRole.MANAGER)` on GET (`:35, 46`) and `POST /:id/sync` (`:98`). Plan-gate `@RequiresFeature(PlanFeature.API_ACCESS)` at `:30` — tenants on the free plan see 403. | ❌ none. | A WAITER or KITCHEN role mutates payment-gateway credentials. Confirmed not possible via the controller; route-level `@Roles` lists exclude these roles on every write. |
| I-6 | **Sensitivity policy is keyed to `integrationType`, immutable post-create.** A row created as `PAYMENT_GATEWAY` (encrypted) cannot be flipped to `THERMAL_PRINTER` (plaintext) — which would otherwise let a tenant smuggle plaintext credentials into an encrypted-typed row by toggling. | `UpdateIntegrationDto = PartialType(OmitType(CreateIntegrationDto, ['integrationType', 'provider']))` — `update-integration.dto.ts:10-12`. Comment at `:1-9` explicitly documents the threat model this defence closes. | ❌ none. | A previously-encrypted row's `config` shape changes mid-life; future reads via `decryptConfig` see plain JSON, hit `isEncryptedPayload` false, and pass through as-is — meaning the response surface returns plaintext credentials with no redaction. The DTO defence shuts this down. |
| I-7 | **Hardware-only paths refuse to merge into sensitive integrations.** `updateDeviceStatus` and `reportDeviceEvent` are reachable by WAITER/KITCHEN roles for the desktop app; they must not be usable to overwrite or read credentials in `PAYMENT_GATEWAY`/`ACCOUNTING`/etc. rows. | Hard refusal at `integrations.service.ts:272-278` — `if (isSensitive) throw new BadRequestException`. The block-comment at `:273-274` documents the prior bug ("previously any WAITER could write keys into a stripe config"). | ❌ none. | A WAITER POSTs `{apiKey:'attacker'}` to `/api/hardware/devices/:stripeId/status` and overwrites the Stripe config. The throw at `:275` makes this impossible — verified. |

Invariants I-1, I-2, I-3 are the gold-standard contract the rest of this review references; I-4, I-5, I-6, I-7 are the supporting defences.

---

## 6. Concurrency hazards

**Critical sections + lock strategy:** none. The module does not use `$transaction`, advisory locks, or row-level locks. For a credential-storage CRUD path that's defensible — credentials don't accumulate state — but the rotation path has one race window worth noting.

**Race windows still open:**

- **Credential rotation read-modify-write hazard.**
  *Sketch:* Admin A opens the "edit integration" UI for Stripe, which fetches the redacted row. Admin B does the same on another tab. A submits `{name: "Stripe Prod"}` (no `config` field — does not touch credentials). B submits `{config: {apiKey: "sk_live_NEW"}}` rotating the key. Both arrive within milliseconds; `update()` does `findFirst` (`:180-182`) then `update` (`:192-195`) with no version field, no compare-and-swap, no row lock.
  *Where:* `integrations.service.ts:179-197`. The Prisma `update` uses `where: { id: integration.id }`, not `where: { id, tenantId, updatedAt: <previously-read> }`.
  *Severity:* **Low Cor.** Each individual UPDATE is atomic at the row level (Postgres), so neither call loses *its own* fields. The hazard is the classic "last-writer-wins on the merged row": both A and B see the same pre-state; if both write `config`, only the later write lands. **Crucially, the encryption invariant (I-1) is NOT violated** — the policy is keyed off `integration.integrationType`, which is read at `:181` from the row that exists at the time of the update, and `integrationType` is omitted from the DTO (I-6). So even if A's read is stale, B's write to `config` is always encrypted because the type can't have changed.
  *Fix:* If credential-rotation collisions become a real complaint, add an `updatedAt` precondition to the update (`updateMany({ where: { id, tenantId, updatedAt: integration.updatedAt } })` + retry on `count === 0`) or surface a version field in the DTO. Until then, this is a noise-level race, not a security hazard. Captured in §7 as F-2.

- **`toggleStatus` and `updateLastSync` use `updateMany` + re-read.** `:207-217` and `:219-225` do `updateMany({ where: { id, tenantId } })` followed by `findFirst`. Two simultaneous toggles converge to the same final boolean (idempotent on truth value), and `updateLastSync` writes `new Date()` (last-writer-wins with no semantic harm). No race window worth flagging beyond the read-after-write being a non-transactional re-read — a third actor could mutate between the update and the re-read, so the returned shape may not reflect what the request just wrote. Cosmetic; not a security or correctness issue.

**Idempotency keys:**
- The compound unique `[tenantId, integrationType, provider]` (`schema.prisma:1090`) is the de-facto idempotency key for `create()` — a duplicate POST returns 409 (`integrations.service.ts:154-158`). Correct.
- `update()` has no idempotency key — a retry of a credential-rotation request will overwrite again, but with the same payload the result is identical, so the path is naturally idempotent at the application level.

---

## 7. Findings

Verified findings unmarked; unverified flagged `*(unverified)*`.

| ID | Sev | Dim | Location | Finding | Fix |
|----|-----|-----|----------|---------|-----|
| F-1 | Low | Arch | `integrations.service.ts:136-142` | `findOneWithSecrets()` is exported but has **zero call sites** outside the service itself (verified by `grep -rn "findOneWithSecrets" backend/src`). The method is provisioned for future Stripe/Iyzico/CRM adapter wiring; until those adapters land, the "plaintext path" exists but is exercised only by the helper-level spec. Not a defect — the method is what makes the pattern complete — but worth tracking: the day an adapter is wired, the integration test for I-2 (in §10) becomes critical. | Add a TODO comment with the planned adapter call site, or wire the first adapter (Stripe/Iyzico for `PAYMENT_GATEWAY`) and add an integration test that asserts plaintext flows out only through this method. |
| F-2 | Low | Cor | `integrations.service.ts:179-197` | `update()` does read (`:180-182`) then write (`:192-195`) with no optimistic-concurrency precondition. Two admins editing the same row simultaneously: last writer wins on the merged row, and `name`/`notes` from the earlier request can be silently lost. Encryption invariant (I-1) is **not** at risk because `integrationType` is immutable (I-6). Severity Low because the race is benign for security and only loses cosmetic fields. | Either add an `updatedAt` precondition + 409-on-mismatch retry, or accept last-writer-wins and document the trade-off. |
| F-3 | Low | Sec | `integrations.service.ts:34-41` | Redaction is regex-based on field names (`apiKey`, `secret`, `token`, `password`, `clientSecret`, `privateKey`). A custom-named credential field — e.g., `xPlatformAuth`, `signingMaterial`, `iv` — slips through and surfaces in the HTTP response in plaintext (after `decryptJson` has run inside `toPublicView`). The set covers the common providers (Stripe, Iyzico, Paraşüt, HubSpot) but is a **denylist, not an allowlist** for credential surface. | Invert the policy: for `SENSITIVE_INTEGRATION_TYPES`, return `config: { hasCredentials: !!Object.keys(plaintext).length }` only, mirroring the `stripSensitiveFields` shape in `delivery-config.service.ts:53-60`. Provider-specific UIs already know their own field names; they don't need them echoed back. |
| F-4 | Low | Sec | `integrations.service.ts:144-177` (create) and `:179-197` (update) | **No audit-log row written on credential create/update.** The `AuditLog` model exists (`schema.prisma:1780-1798`) and is intended for `CREATE`/`UPDATE`/`DELETE` actions with `previousData`/`newData` snapshots and `metadata.ip`. Today, an admin rotating a tenant's Stripe key leaves no trace in `audit_logs`. The §8 "what's solid" callout below lists "audit log on credential writes" as part of the template pattern — this is the one piece currently missing. | Inject an `AuditLogService` (or, until one exists, write directly to `prisma.auditLog`) and emit `{action: 'UPDATE'/'CREATE'/'DELETE', entityType: 'INTEGRATION_SETTINGS', entityId: id, actorId: req.user.id, previousData: <redacted>, newData: <redacted>, targetTenantId: tenantId, metadata: {ip, userAgent}}` on every write. **Redact `config` in both `previousData` and `newData`** — the audit log must not become the new plaintext sink. Easiest: pass the values through `redactSensitiveKeys` before serializing. |
| F-5 | Info | Arch | `integrations.service.ts:77-92` | `decryptConfig` **mutates** the row argument in place (`row.config = decryptJson(...)` at `:83`). `toPublicView` clones first (`{ ...row }` at `:101`) so the mutation is contained, but `findOneWithSecrets` (`:141`) passes the original `integration` returned by Prisma. Today both paths happen to be terminal (the result is returned to the caller and never reused), but it's the kind of footgun that bites the first time someone adds a "log the row before returning" line. | Make `decryptConfig` return a new object: `return { ...row, config: decrypted }`. Costs one shallow clone per read; eliminates the aliasing hazard. |
| F-6 | Info | Sec | `integrations.service.ts:85-89` | When `decryptJson` throws (corrupted ciphertext, wrong master key, tampered auth tag), the row's `config` is silently replaced with `{}` and an error log is emitted. This is the right *failure mode* for the controller path (don't 500 on a single corrupt row), but it means a tenant whose master key was rotated without re-encryption sees an empty `{}` in their UI with no signal that the data still exists encrypted on disk. | Add a sentinel field — e.g., `config: { __decryptionFailed: true }` — so the frontend can render "credentials need re-entry" rather than "no credentials configured". Optionally bubble a `DecryptionError` (the helper already defines this type at `encryption.helper.ts:23-28`) up to a Sentry breadcrumb. |

No findings above Low. The seed verdict in §4.12 ("Encryption + redaction are exemplary") stands.

---

## 8. What's solid (positive findings) — **THE TEMPLATE for credential storage**

This module is **the reference pattern** for storing third-party credentials in this codebase. The accounting module (M8) and any future module that stores third-party API credentials (HubSpot/Salesforce/Mailchimp/QuickBooks/Stripe Connect/etc.) **must** adopt this four-part shape:

### The pattern, in four parts

1. **`encryptJson` for storage** — every write that lands a credential bytes-level into Postgres goes through `encryption.helper.ts:43-54`. The on-disk shape is the `EncryptedPayload` envelope `{ciphertext, iv, authTag}` (base64url, AES-256-GCM, 12-byte nonce). The sensitivity gate is `integrations.service.ts:23-29` (set of integration types) wired into the create/update paths at `integrations.service.ts:160-162` and `:187-189`. The master key is read from `ENCRYPTION_MASTER_KEY` with a min-32-char check (`encryption.helper.ts:30-41`).

2. **`findOneWithSecrets` for adapter access (plaintext)** — `integrations.service.ts:136-142`. The *only* path that returns a decrypted row. Doc-comment at `:132-135` says explicitly *"Never call from controllers."* Adapter-side code (StripeAdapter, IyzicoAdapter, etc.) is the intended caller. The method is symmetric to `findOne` but skips the redaction step.

3. **`findOne` and HTTP response surface use sanitize/redact** — every public-facing method routes through `toPublicView` (`integrations.service.ts:99-106`), which calls `decryptConfig` (`:77-92`) then applies `redactSensitiveKeys` (`:44-59`). The `***REDACTED***` marker is the wire-level signal to the frontend that "this field exists, you can rotate it, but you don't see its value." The DTO defence at `update-integration.dto.ts:10-12` prevents an admin from re-typing the row to escape the encryption policy (I-6).

4. **Audit log on credential writes** — **currently the one gap** (F-4). The `AuditLog` model exists (`schema.prisma:1780-1798`) with exactly the right shape (`previousData`/`newData`/`actorId`/`targetTenantId`/`metadata.ip`). Any module adopting this template **must** add the audit-log write on create/update/delete; the seed module is otherwise complete.

### Cross-links — modules that should adopt the full pattern

- **`accounting/` — M8 (P0 in `../CODE_REVIEW.md §7`).** Verified plaintext storage in `schema.prisma:2937-2951` and `accounting-settings.service.ts:17-22`. The accounting review (`./accounting.md` §3 I-8, §7 F-1) prescribes adopting *this exact pattern*: either collapse the 11 plain-`String?` secret columns into a single `credentials Json` (encrypted envelope) or wrap each individual write in `encryptString` and the adapter read in `decryptString`. The `sanitize` step in `accounting-settings.service.ts:25-37` already mirrors `toPublicView` — just the storage half is missing. Note the partial adoption today: response-surface redaction is in place, encryption-at-rest is not.

- **`delivery-platforms/` — adopted independently.** `delivery-config.service.ts:40-60, 125, 168, 221` implements the same four-part shape with a slight variant: a *strip*-and-flag approach (`hasCredentials: boolean`, `hasAccessToken: boolean` — `:53-60`) rather than the `***REDACTED***` marker. Both shapes are valid; the strip-and-flag is actually safer for novel/custom credential field names (closes F-3). Has `findOneInternal` (`:80-88`) which is the analogue of `findOneWithSecrets`. Also adopts `encryptString` for the cached OAuth `accessToken` (`:221`) — a useful elaboration the `integrations/` module does not yet need.

- **`analytics/services/camera.service.ts:53, 139`** — uses `encryptString` for camera RTSP `streamUrl` (credentials embedded in URL). Partial adoption: the storage half is correct, but there is no redaction-on-response wrapper analogous to `toPublicView`. Worth a follow-up to confirm the camera-list endpoint isn't echoing `streamUrl` back in plaintext. Out of scope for this review.

- **Future modules that will need this pattern:** any Stripe/Iyzico/PayTR webhook signing-secret store, any SSO/SAML IdP metadata store, any outbound SMS provider credential store beyond the existing `sms-settings/`. When wiring those, copy the four-part shape verbatim, do not invent a new one.

### Other things this module gets right

- **`integrationType`-keyed sensitivity** (`integrations.service.ts:23-29`) — a single source of truth for "is this row credentials or device config?" Avoids per-field flags that drift over time.
- **DTO-level immutability of the sensitivity discriminator** (`update-integration.dto.ts:10-12`) — closes a real attack path with a one-line `OmitType`.
- **Hard refusal on the hardware sub-API** (`integrations.service.ts:272-278`) — explicit, commented, and tied to a prior bug. The kind of defence-in-depth that survives a careless refactor.
- **Decryption failure is contained** (`integrations.service.ts:85-89`) — one corrupt row doesn't 500 the whole list endpoint. The `DecryptionError` type (`encryption.helper.ts:23-28`) makes corrupted-ciphertext distinguishable from a generic JSON error if a caller wants to.
- **Tenant-scoped cascade delete** (`schema.prisma:1069`) — `onDelete: Cascade` means a tenant offboard cleanly removes all their integration rows. No orphaned credential blobs.

---

## 9. Spot-checks performed

**Verified:**
- I-1 confirmed: `integrations.service.ts:160-162` writes `encryptJson(createDto.config)` when `isSensitive(integrationType)` is true; `:187-189` does the same on update. `encryptJson` shape verified at `encryption.helper.ts:43-54`.
- I-2 confirmed: `grep -rn "findOneWithSecrets" backend/src --include="*.ts"` returns one definition site and zero call sites outside the service. The "only path to plaintext" claim holds today by construction (no caller); see F-1.
- I-3 confirmed: `toPublicView` traced at `:99-106` and verified to be invoked at every controller-reachable return path: `findAll:113`, `findByType:121`, `findOne:129`, `create:176`, `update:196`, `toggleStatus:216`. `findOneWithSecrets:141` deliberately skips it — correct.
- I-6 confirmed: `UpdateIntegrationDto` source at `update-integration.dto.ts:10-12` does `PartialType(OmitType(CreateIntegrationDto, ['integrationType', 'provider']))`. Comment at `:1-9` documents the threat. Verified.
- I-7 confirmed: `updateDeviceStatus` at `:272-278` throws `BadRequestException` when `isSensitive(integration.integrationType)` — verified the path is reachable from WAITER/KITCHEN-role-allowed `HardwareConfigController.updateDeviceStatus` (`integrations.controller.ts:121-135`). The defence fires before any merge into `config`.

**Dropped (initial concern was unfounded):**
- "Hardware controller missing `RolesGuard`" — `HardwareConfigController` at `integrations.controller.ts:109` uses `@UseGuards(JwtAuthGuard, TenantGuard)` without `RolesGuard`, but the route-level `@Roles(...)` decorators (`:114, 122, 138`) are advisory-only without the guard. Verified by reading: the routes are gated by JWT+tenant only, meaning ANY authenticated user in the tenant can call `/api/hardware/config`. **However**, the response of `getHardwareConfig` is filtered to non-sensitive `hardwareTypes` (`integrations.service.ts:228-244`) and never returns credentials. `updateDeviceStatus`/`reportDeviceEvent` are gated by the I-7 sensitivity check. Net effect: no security boundary is broken — the missing guard is cosmetic, not a vuln. **Drop.**
- "`encryptJson` uses random IV that's reused across writes" — verified at `encryption.helper.ts:45` — `iv = randomBytes(12)` is generated fresh per encrypt call. Standard GCM. **Drop.**

**Downgraded:**
- F-2 — initially considered as Medium for the rotation race; downgraded to Low after verifying that `integrationType` immutability (I-6) means the encryption policy can never be skipped by a stale read.

---

## 10. Recommended tests

The 3 integration tests that would lock in the §3 invariants and §6 race. Skeletons only.

```ts
// backend/src/modules/settings/integrations/__tests__/integrations.integration.spec.ts
describe('settings/integrations — credential storage invariants', () => {
  it('I-1 + I-2: write+read roundtrip — plaintext never leaks via Prisma row', async () => {
    // arrange: tenant A admin, create PAYMENT_GATEWAY with config {apiKey:"sk_live_X"}
    // act: read the raw row directly via prisma.integrationSettings.findFirst
    // assert: row.config has shape {ciphertext, iv, authTag} (isEncryptedPayload === true)
    // assert: row.config.apiKey === undefined (no plaintext key on disk)
    // act: call service.findOneWithSecrets(id, tenantId)
    // assert: result.config.apiKey === "sk_live_X" (plaintext recovered)
    // assert: the only call site for findOneWithSecrets in production code is the
    //         adapter layer (smoke-grep, fail if controllers reference it)
  });

  it('I-3: redaction-on-HTTP-response — every controller path returns ***REDACTED***', async () => {
    // arrange: create PAYMENT_GATEWAY with config {apiKey, webhookSecret, clientSecret, privateKey}
    // act: hit each of: GET /admin/settings/integrations, GET /:id,
    //      POST (create response), PATCH (update response), PATCH /:id/toggle
    // assert for each: response.body.config.apiKey === '***REDACTED***'
    //                  response.body.config.webhookSecret === '***REDACTED***'
    //                  response.body.config.clientSecret === '***REDACTED***'
    //                  response.body.config.privateKey === '***REDACTED***'
    // assert: no response anywhere echoes a value starting with 'sk_live_' / 'whsec_'
  });

  it('I-3 (list): sanitize-on-list — list endpoint applies redaction to every row', async () => {
    // arrange: create 3 PAYMENT_GATEWAY rows (stripe, iyzico, paytr) for one tenant
    // act: GET /admin/settings/integrations
    // assert: response.body.length === 3
    // assert: every row's config.apiKey === '***REDACTED***' (no row slips through)
    // assert: a hardware row (THERMAL_PRINTER) in the same response has its
    //         non-sensitive config (connection_type, etc.) returned verbatim
  });

  it('I-4: cross-tenant — tenant B cannot read or rotate tenant A credentials', async () => {
    // arrange: tenant A integration; tenant B admin JWT
    // act: tenant B calls GET /:id, PATCH /:id, DELETE /:id, PATCH /:id/toggle
    // assert: all return 404 (NotFoundException — tenant scoping at every where clause)
    // assert: tenant A's row is untouched after the attempts
  });

  it('I-6: re-typing defence — admin cannot flip PAYMENT_GATEWAY to THERMAL_PRINTER mid-life', async () => {
    // arrange: create PAYMENT_GATEWAY (encrypted)
    // act: PATCH with body {integrationType: 'THERMAL_PRINTER', config: {apiKey: 'leaked'}}
    // assert: 400 from class-validator (integrationType not in DTO) OR
    //         field is silently dropped by ValidationPipe whitelist; either way,
    //         the row's integrationType is still PAYMENT_GATEWAY after the call
    // assert: raw row.config still has isEncryptedPayload shape
  });

  it('F-2 race (Low): two simultaneous credential rotations — last write wins, encryption preserved', async () => {
    // arrange: existing PAYMENT_GATEWAY row
    // act: Promise.all([
    //   service.update(id, tenantId, {config: {apiKey: 'sk_A'}}),
    //   service.update(id, tenantId, {config: {apiKey: 'sk_B'}}),
    // ])
    // assert: service.findOneWithSecrets(id, tenantId).config.apiKey ∈ {'sk_A','sk_B'}
    // assert: raw row.config still has isEncryptedPayload shape (I-1 not violated)
  });
});
```

Cross-tenant assertions follow the style from `../CODE_REVIEW.md §3.1` — *create two tenants, attempt cross-tenant access via every endpoint, assert zero leaks.* The credential-roundtrip test (the first one) is the **single most important** integration test in the entire codebase for the credential-storage contract: it locks plaintext to one specific call path and fails loudly the day someone forgets.
