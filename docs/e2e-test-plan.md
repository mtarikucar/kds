# KDS — Modül-Bazlı E2E Test Planı

Sistemin **her bir modülü** için: ne yaptığı, hangi tablolara dokunduğu,
hangi başka modülleri tetiklediği, hangi cron'ların/socket'lerin/SMS'lerin
ona bağlı olduğu, ve **bu davranışların hepsinin tek tek test edilmesi
için** atılması gereken adımlar.

Mevcut Playwright suite'i şu an **191 test** ile çalışıyor; bu doküman
hem o testlerin haritasını çıkarıyor hem de henüz kapsanmayan davranışlar
için açık görev listesi sunuyor.

---

## İçindekiler

1. [Önsöz — okuma rehberi](#önsöz)
2. [Bölüm A — Auth realm'leri](#bölüm-a--auth-realmleri)
3. [Bölüm B — Tenant çekirdek modeller](#bölüm-b--tenant-çekirdek-modeller)
4. [Bölüm C — POS çekirdek](#bölüm-c--pos-çekirdek)
5. [Bölüm D — Customer-facing (QR menü)](#bölüm-d--customer-facing-qr-menü)
6. [Bölüm E — Operasyon (rezervasyon + personel + KDS)](#bölüm-e--operasyon)
7. [Bölüm F — Envanter (stock + stock-management)](#bölüm-f--envanter)
8. [Bölüm G — Ayarlar](#bölüm-g--ayarlar)
9. [Bölüm H — Raporlama](#bölüm-h--raporlama)
10. [Bölüm I — Abonelik & faturalandırma](#bölüm-i--abonelik--faturalandırma)
11. [Bölüm J — Customer Self-Pay](#bölüm-j--customer-self-pay)
12. [Bölüm K — Delivery entegrasyonları](#bölüm-k--delivery-entegrasyonları)
13. [Bölüm L — Platform (SuperAdmin)](#bölüm-l--platform-superadmin)
14. [Bölüm M — Marketing CRM](#bölüm-m--marketing-crm)
15. [Bölüm N — Misc (notifications + contact + upload + public-stats)](#bölüm-n--misc)
16. [Bölüm O — WebSocket gateway'leri](#bölüm-o--websocket-gatewayleri)
17. [Bölüm P — Cron job'lar](#bölüm-p--cron-jobler)
18. [Bölüm Q — Mevcut coverage haritası](#bölüm-q--mevcut-coverage-haritası)

---

## Önsöz

### Her modül için aynı şablon

```
N.X  <Modül adı>
─────────────────────────────────────────────────────────────────
Amaç:           Modülün tek cümlelik tanımı.
Sahip olduğu:   Prisma model(ler)i — bu modül writer.
Endpoint'ler:   METHOD /path — açıklama (gruplandırılmış).
Yan etkiler:    Her WRITE'ın diğer hangi tablo/event/SMS/cron'a dokunduğu.
Bağımlılıklar:  Hangi tabloları okur, hangi servislere çağrı atar.
İnvariant'lar:  Bozulması bug olan kurallar.
Test planı:     Senaryo listesi — happy + error + edge + cross-module.
Coverage:       ✅ test edildi / ⚠️ kısmen / ❌ yok — referans spec.
```

### Test ortamı

- Backend: `:50080` (CORS izole, dev env'de auto-start)
- Frontend: `:5179` (Vite, /app/ base path)
- Seed: `npm run prisma:seed && npm run seed:demo && npx ts-node prisma/seed-platform-users.ts`
- Çalıştırma: `npm run test:e2e` (root)
- Workers: 1 — sıralı çalışır, suite ~3 dakikada biter

### "Business logic" testinin ne demek olduğu

Sadece endpoint'in 200 dönmesi değil:
1. **Kendisi** doğru veriyi yazıyor mu (DB state değişti mi)
2. **Etkilediği yerler** — diğer tabloları update etti mi (örn. order ödenince table.status AVAILABLE'a düştü mü)
3. **Yayınlanan event'ler** — KDS socket emit yapıyor mu, SMS uçtu mu, audit log yazıldı mı
4. **Tarayıcıda UI** ayar değişikliğini yansıtıyor mu

---

## Bölüm A — Auth realm'leri

Sistemde **üç ayrı JWT realm'i** var. Hiçbir token diğerinin endpoint'ine erişemez.
Her realm'in kendi secret'ı, refresh-rotation'ı, password-change akışı var.

---

### A.1  `auth` — Tenant staff

**Amaç:** Restoran çalışanlarının (ADMIN/MANAGER/WAITER/KITCHEN/COURIER) JWT
ile sisteme bağlanması.

**Sahip olduğu modeller:** `User`, `RefreshToken`, `PendingApproval`,
`EmailVerificationToken`, `PasswordResetToken`.

**Endpoint'ler:**
| METHOD | Path | Açıklama |
|---|---|---|
| POST | `/auth/login` | Email+şifre → accessToken + refreshToken (httpOnly cookie) |
| POST | `/auth/refresh` | Cookie'deki refresh ile yeni accessToken |
| POST | `/auth/logout` | Tüm refresh token'ları revoke et |
| POST | `/auth/register` | Yeni tenant + admin user yarat veya mevcut tenant'a katıl |
| POST | `/auth/google` | OAuth flow |
| POST | `/auth/forgot-password` | Sıfırlama e-postası gönder |
| POST | `/auth/reset-password` | Token ile şifre değiştir |
| POST | `/auth/verify-email` | Email verification token tüket |
| POST | `/auth/resend-verification` | Yeni doğrulama maili gönder |
| GET | `/auth/profile` | Mevcut user bilgisi |

**Yan etkiler:**
- `login` → `RefreshToken.create` (hashed); cookie `Set-Cookie: refreshToken=...; HttpOnly; SameSite=Strict; Path=/api/auth`
- `register` (yeni tenant): `Tenant.create` + `Subscription.create(FREE)` + `User.create(ADMIN)` + welcome email (best-effort)
- `register` (mevcut tenant): `User.create(role)` with `status=PENDING_APPROVAL` → admin'lere notification + email
- `forgot-password`: `PasswordResetToken.create` + email send (1 saatlik TTL, tek kullanımlık)
- `refresh`: Eski token revoke + yeni token mint (rotation); reuse-detection: aynı token tekrar gelirse user'ın tüm refresh'leri iptal edilir
- `logout`: `RefreshToken.updateMany({revokedAt: now})` + cookie clear

**İnvariant'lar:**
- `tokenHash` unique; her token unik `jti` ile imzalanır (collision koruması)
- Refresh-token reuse → "token theft" sinyali, full revocation
- `User.status` `SUSPENDED` ise login reddedilir, varolan access token sonraki istekte de reddedilir
- `tenant.status !== ACTIVE` → login reddedilir
- `pendingApproval` user → login başarısız, "ADMIN onayı bekleniyor" yanıtı
- `emailVerified=false` → abonelik ödemesi (`/payments/create-intent`) blocked

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| A.1.1 | Demo admin login → /dashboard'a iniyor | ✅ `auth.spec.ts` |
| A.1.2 | Yanlış şifre → 401 + URL stays /login | ✅ |
| A.1.3 | Logout → protected route redirect /login | ✅ |
| A.1.4 | Refresh rotation (single + parallel) — TOKEN_REUSE değil | ✅ `cross-cutting/refresh-rotation` |
| A.1.5 | Reload sonrası session korunuyor (ProtectedRoute bootstrap) | ✅ |
| A.1.6 | Register (new tenant) → tenant + admin + FREE sub | ❌ — yeni tenant oluşturma testi yok |
| A.1.7 | Register (existing tenant, role≠ADMIN) → `PENDING_APPROVAL` | ❌ |
| A.1.8 | Pending approval user login → "ADMIN onayı" mesajı | ❌ |
| A.1.9 | Forgot-password → email gönderildi (mock) + token üretildi | ❌ |
| A.1.10 | Reset-password → eski refresh'ler iptal edildi | ❌ |
| A.1.11 | Reset-password expired token → 4xx | ❌ |
| A.1.12 | Verify-email → user.emailVerified=true, sonra `/payments/create-intent` blocked değil | ❌ |
| A.1.13 | OAuth Google flow → user yarat + login | ❌ — Google sandbox creds gerekir |
| A.1.14 | Tenant SUSPENDED iken login reddi | ✅ `extra/tenant-suspension` |
| A.1.15 | Refresh-token reuse — tüm token revoke + login zorunlu | ⚠️ — direkt assert yok, üretilen davranış ile gözleniyor |

---

### A.2  `superadmin/auth` — Platform admin

**Amaç:** Platform sahibi (KDS şirketinin sahibi) için ayrı JWT realm'i.

**Sahip olduğu modeller:** `SuperAdmin`, `SuperAdminRefreshToken`,
`SuperAdminAuditLog` (her giriş loglanır).

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/superadmin/auth/login` → tempToken (henüz aktive değil) |
| POST | `/superadmin/auth/verify-2fa` → final accessToken (TOTP veya backup-code) |
| POST | `/superadmin/auth/refresh` |
| POST | `/superadmin/auth/logout` |
| GET  | `/superadmin/auth/2fa/setup` — TOTP secret + QR data URL |
| POST | `/superadmin/auth/2fa/enable` — secret'i aktifleştir |
| POST | `/superadmin/auth/2fa/disable` |
| POST | `/superadmin/auth/2fa/backup-codes/regenerate` |
| POST | `/superadmin/auth/2fa/recover` — backup kod ile |

**Yan etkiler:**
- Login 2 aşamalı: password → tempToken (5dk TTL) → TOTP verify
- TOTP_REPLAY guard: aynı 30s step bir kez kabul edilir, ikinci girişte "Invalid 2FA code" + lockout sayacı artar
- failedLogins + lockedUntil — 5 başarısız sonrası 30dk lock
- Her endpoint çağrısı → `AuditLog.create` (action, actorId, ip, userAgent)
- Backup codes: bcrypt-hashed, kullanılan kod silinir

**İnvariant'lar:**
- 2FA zorunlu (`twoFactorEnabled=true` olmayan superadmin login yapamaz)
- TempToken yalnızca verify-2fa endpoint'inde geçerli; başka endpoint'lerde reddedilir
- TOTP step replay → 401 + audit log

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| A.2.1 | Login + 2FA full flow → /superadmin/tenants reachable | ✅ `superadmin/full-flow` |
| A.2.2 | Yanlış creds → 401 | ✅ |
| A.2.3 | Yanlış TOTP → 401, audit log written | ⚠️ audit-log assert yok |
| A.2.4 | TOTP replay → 401 "Invalid 2FA code" | ⚠️ helper içinde test ediliyor (retry logic kanıtı) |
| A.2.5 | Tenant ADMIN superadmin endpoint'ine erişemez | ✅ |
| A.2.6 | 2FA setup → QR data URL + secret üretilir | ❌ |
| A.2.7 | 2FA enable → twoFactorEnabled flip | ❌ |
| A.2.8 | 2FA disable → twoFactorEnabled=false ama sonraki login yine reddedilir (politika gereği) | ❌ |
| A.2.9 | Backup code ile recover → kod silinir, tek kullanımlık | ❌ |
| A.2.10 | failedLogins 5'i aşınca lockedUntil set, sonraki login 423 | ❌ |

---

### A.3  `marketing/auth` — Sales/Marketing realm

**Amaç:** Sales-manager/sales-rep rollerinin lead'leri yönettiği ayrı realm.

**Sahip olduğu modeller:** `MarketingUser`, `MarketingRefreshToken`.

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/marketing/auth/login` |
| POST | `/marketing/auth/refresh` |
| POST | `/marketing/auth/logout` |
| POST | `/marketing/auth/change-password` |

**Yan etkiler:**
- failedLogins + lockedUntil (5/30dk)
- tokenVersion bumping: change-password sonrası tüm aktif token'lar invalidate
- Login başarılı → `MarketingUser.lastLogin`, `lastLoginIp` update

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| A.3.1 | SALES_MANAGER login → /marketing/dashboard reachable | ✅ `marketing/full-flow` |
| A.3.2 | Yanlış creds → 401 | ✅ |
| A.3.3 | Tenant ADMIN marketing endpoint'ine erişemez | ✅ |
| A.3.4 | Refresh rotation | ❌ |
| A.3.5 | Change-password → eski token'lar invalidate | ❌ |
| A.3.6 | failedLogins lockout | ❌ |

---

## Bölüm B — Tenant çekirdek modeller

### B.1  `tenants`

**Amaç:** Restoran (tenant) ayarları.

**Sahip olduğu modeller:** `Tenant` (currency, timezone, subdomain, logo, sosyal medya alanları, taxId vs.)

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| GET | `/tenants/public` — public listede aktif tenant'lar (register dropdown için) |
| GET | `/tenants/settings` |
| PATCH | `/tenants/settings` |

**Yan etkiler:**
- `currency` değişimi → **tüm** para alanlarını etkiler: receipt snapshot, Z-report `CURRENCY_SYMBOLS[currency]`, sales invoice, e-fatura
- `timezone` → Z-report günlük sınırları (`getTenantDayBounds`), report-email cron'u (`closingTime`)
- `subdomain` → QR menü URL'i, kayıt-zamanı subdomain çakışma kontrolü
- `logoUrl` → QR menü header, receipt PDF logosu
- `closingTime` → günlük rapor email cron'u tetikleme saati

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| B.1.1 | GET /tenants/settings → seeded tenant döner | ✅ `settings-effects/tenant-currency-timezone` |
| B.1.2 | currency=EUR → /tenants/settings döner EUR | ✅ |
| B.1.3 | timezone=Europe/London → /tenants/settings döner London | ✅ |
| B.1.4 | currency=EUR → yeni Z-Report `€` sembolü kullanır | ❌ |
| B.1.5 | timezone değişimi → Z-Report günlük sınırları yeni TZ'ye göre hesaplanır | ❌ |
| B.1.6 | logoUrl set → QR menü browser'da `<img src=...>` render | ✅ `browser/qr-menu-branding` |
| B.1.7 | subdomain çakışması → register reddedilir | ❌ |
| B.1.8 | WAITER /tenants/settings'i PATCH edemez | ❌ |

---

### B.2  `users` (tenant)

**Amaç:** Tenant içi staff user yönetimi.

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/users` — yeni staff |
| GET | `/users` |
| GET | `/users/:id` |
| PATCH | `/users/:id` |
| PATCH | `/users/:id/approve` — pendingApproval onayı |
| PATCH | `/users/:id/role` |
| PATCH | `/users/:id/status` — ACTIVE/SUSPENDED |
| DELETE | `/users/:id` |

**Yan etkiler:**
- `approve` → `User.status=ACTIVE`, welcome email
- `role` değişimi → `tokenVersion` bump (mevcut access token invalidate)
- `status=SUSPENDED` → kullanıcının sonraki API isteği 401
- `delete` → soft-delete (status=DELETED) ya da hard-delete (cascade ile audit risk)

**İnvariant'lar:**
- maxUsers plan limiti (CheckLimit guard) — kapasiteye dolu tenant 6. user yaratamaz
- ADMIN kendisini silemez (last admin guard)
- Email unique per tenant

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| B.2.1 | Admin yeni waiter yaratabiliyor | ❌ |
| B.2.2 | Pending approval user onaylanınca status=ACTIVE + login OK | ❌ |
| B.2.3 | maxUsers=2 → 3. user create reddedilir | ❌ |
| B.2.4 | Role değişimi → eski token invalidate (sonraki istek 401) | ❌ |
| B.2.5 | Last admin silinemez | ❌ |
| B.2.6 | WAITER user listini göremez (role-gated) | ⚠️ — admin-users.spec.ts kısmen test ediyor |
| B.2.7 | Email çakışması → 409 | ❌ |

---

### B.3  `customers`

**Amaç:** Müşteri kayıt + loyalty + CRM.

**Sahip olduğu modeller:** `Customer`, `LoyaltyTransaction`.

**Endpoint'ler (admin):**
| METHOD | Path |
|---|---|
| POST | `/customers` |
| GET | `/customers` (paginated + search) |
| GET | `/customers/:id` |
| PATCH | `/customers/:id` |
| DELETE | `/customers/:id` |

**Yan etkiler:**
- Order ödendiğinde (`finalizeFullyPaid` POS payments flow): müşteri linklenir, `totalOrders++`, `totalSpent += amount`, `lastVisit=now`, **+ loyalty puanı kazanılır + tier promotion check**
- Loyalty earn idempotent (`LoyaltyTransaction.findFirst({customerId, orderId, type:EARNED})`)

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| B.3.1 | Create customer → list'te görünür | ✅ `customers.spec.ts` |
| B.3.2 | Search → uniqueName ile filtrelenir | ✅ |
| B.3.3 | Order ödenince linkli müşteri puan kazanır | ✅ `loyalty/earn-points` |
| B.3.4 | Aynı orderID iki kez ödenirse loyalty double-credit yok | ✅ |
| B.3.5 | Tier eşiği aşılınca BRONZE→SILVER promotion | ✅ `behavior/loyalty-tier-promotion` |
| B.3.6 | Customer search backend-side (name/email/phone contains) | ⚠️ |
| B.3.7 | Phone E.164 validation reddi | ❌ |
| B.3.8 | Cross-tenant customer ID lookup reddi | ⚠️ tenant-isolation testi var |

---

## Bölüm C — POS çekirdek

### C.1  `orders` (core)

**Amaç:** POS sipariş yaşam döngüsü.

**Sahip olduğu modeller:** `Order`, `OrderItem`, `OrderItemModifier`, `OrderItemPayment`, `PendingPlanChange`.

**State machine:**
```
PENDING_APPROVAL ──→ PENDING ──→ PREPARING ──→ READY ──→ SERVED ──→ PAID
       │                │            │           │          │
       └──→ CANCELLED ──┴────────────┴───────────┴──────────┴──→ CANCELLED (terminal)

PAID → CANCELLED da izinli (refund/void için)
```

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/orders` (create) |
| GET | `/orders` (filter: tableId/status/dateRange/pagination) |
| GET | `/orders/:id` |
| PATCH | `/orders/:id` (items update) |
| PATCH | `/orders/:id/status` |
| POST | `/orders/:id/approve` (pending customer order onayı) |
| DELETE | `/orders/:id` (pending/cancelled only) |
| DELETE | `/orders/:orderId/items/:itemId` |
| POST | `/orders/transfer-table` |
| POST | `/orders/sync-table-statuses` |
| GET | `/orders/group-bill-summary/:groupId` |

**Yan etkiler — create:**
1. `Order` + `OrderItem`(+`OrderItemModifier`) atomically (`prisma.order.create`)
2. `Table.status = OCCUPIED` (post-tx, fix bizim eklediğimiz)
3. `kitchenTicketSnapshot` JSON üretilir (reprint için)
4. `KdsGateway.emitNewOrder` → `order:new` event (`kitchen-{tenantId}` + `pos-{tenantId}` room'larına)
5. `StockDeductionService.deductForOrder` (recipe-based, opt-in)
   - Düşük stok varsa `KdsGateway.emitLowStockAlert`
   - `Order.stockDeducted=true` (idempotent flag)
6. SMS: `smsOnOrderCreated` ON ise + müşteri telefon set ise → SMS

**Yan etkiler — status change:**
- PREPARING/READY/SERVED → Table OCCUPIED kalır
- PAID/CANCELLED → Aktif başka sipariş yoksa Table AVAILABLE
- Cancellation: stock reversal (`StockDeductionService.reverseForOrder`)
- KDS socket: `order:status-changed`
- DeliveryPlatform: sync status (Yemeksepeti/Trendyol için)
- SMS: per-status togglar (`smsOnOrderPreparing`, `smsOnOrderReady`, …)

**Yan etkiler — payment closes order (PAID):**
- Bkz. C.2 (payments)
- Müşteri linklenmişse `Customer` stats + loyalty earn + tier check
- Sales-invoice auto-generation (Accounting modülü)
- Receipt snapshot final
- KDS socket: `payment:success` (auto-print için)

**İnvariant'lar:**
- `idempotencyKey` ile retry → aynı order döner
- `validateTransition` — illegal status atlama (PENDING→READY skip PREPARING) 400
- PAID order immutable (items/discount değiştirilemez)
- Discount > subtotal → 400 ("Discount cannot exceed order total")
- finalAmount asla negatif olamaz
- Table cannot be OCCUPIED if all orders terminal; cannot be AVAILABLE if active exist

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| C.1.1 | PENDING → PREPARING → READY → SERVED → PAID full happy path | ✅ `orders/lifecycle` |
| C.1.2 | Illegal transition (PENDING→READY) 400 | ✅ |
| C.1.3 | PAID immutable (status→PREPARING reddedilir) | ✅ |
| C.1.4 | PAID → CANCELLED izinli (refund) | ✅ `orders/cancellation` |
| C.1.5 | CANCELLED terminal | ✅ |
| C.1.6 | Discount > subtotal 400, equal 0₺ OK | ✅ |
| C.1.7 | Idempotency: aynı key → aynı order | ✅ `orders/idempotency` |
| C.1.8 | Order create → table.status OCCUPIED | ✅ `tables/auto-status-sync` |
| C.1.9 | Last order paid → table AVAILABLE | ✅ |
| C.1.10 | Two active orders → table stays OCCUPIED until both close | ✅ |
| C.1.11 | Cancel order → table AVAILABLE | ✅ |
| C.1.12 | transfer-table → orders + table.status sync | ✅ `tables/transfer` |
| C.1.13 | Transfer to RESERVED table reddedilir | ✅ |
| C.1.14 | Modifier priceAdjustment finalAmount'a yansır | ✅ `menu/modifier-pricing` |
| C.1.15 | Required modifier seçilmeden order kabul/red | ⚠️ test contract lock'ladı |
| C.1.16 | requiresApproval=true order PENDING_APPROVAL'da kalır, approve sonrası PENDING | ❌ |
| C.1.17 | KDS socket order:new emit | ✅ `kds/socket-broadcast` |
| C.1.18 | KDS socket order:status-changed emit | ✅ |
| C.1.19 | Item-level status change (KDS) | ✅ `extra/kds-item-status` |
| C.1.20 | Per-item paid → item silinemez (allocation guard) | ❌ |
| C.1.21 | stockTracked product: ordering > stock → 400 (no order created) | ⚠️ manual decrement test edildi |

---

### C.2  `orders/payments` (POS-side)

**Amaç:** POS'tan ödeme alma — CASH / CARD / DIGITAL.

**Sahip olduğu modeller:** `Payment`, `OrderItemPayment` (per-item allocations).

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/orders/:orderId/payments` (single) |
| GET | `/orders/:orderId/payments` |
| POST | `/orders/:orderId/payments/split` |
| POST | `/orders/:orderId/payments/items` (Dutch-style) |
| GET | `/orders/:orderId/payments/payable-items` |
| POST | `/orders/:orderId/payments/write-off` (ADMIN/MANAGER only) |
| PATCH | `/payments/:id/status` (REFUND) |

**Yan etkiler — payment creation:**
1. `Payment.create` (status COMPLETED veya PENDING)
2. `receiptSnapshot` JSON (reprint için)
3. Order tam ödenmişse:
   - `Order.status=PAID`
   - `finalizeFullyPaid`:
     - Customer link (`customerPhone` → upsert)
     - `Customer.totalOrders++`, `totalSpent+=amount`, `averageOrder`, `lastVisit`
     - **Post-commit:** Loyalty earn (idempotent on customerId+orderId) + tier promotion check
4. Table → AVAILABLE (eğer aktif order kalmamışsa)
5. KDS socket: `payment:success`
6. Sales invoice auto-generation (`accounting` modülü)
7. PayTR webhook'tan geldiyse: stock deduction trigger

**İnvariant'lar:**
- `idempotencyKey` → aynı payment row
- amount > remaining → 400
- PAID order üzerine yeni payment 400
- CANCELLED order üzerine payment 400
- Per-item payment quantity > unpaid quantity → 400
- write-off: ADMIN/MANAGER only, kalan borcu sıfırlar, order PAID olur, audit trail

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| C.2.1 | Single cash payment full → order PAID | ✅ `payments/single-payment` |
| C.2.2 | Idempotency aynı key → aynı row | ✅ |
| C.2.3 | Overpayment 400 | ✅ |
| C.2.4 | Pay-by-items Dutch — iki diner 1/2 ödeme | ✅ `payments/pay-by-items` |
| C.2.5 | Pay-by-items overpay (quantity > unpaid) 400 | ✅ |
| C.2.6 | Mixed-payment guard (single payment varsa self-pay reddedilir) | ❌ |
| C.2.7 | write-off: kalan borç sıfırlanır, order PAID | ❌ |
| C.2.8 | write-off WAITER reddedilir | ❌ |
| C.2.9 | Refund: PAID order → CANCELLED transition + payment.status REFUNDED | ❌ |
| C.2.10 | Order PAID olunca loyalty puan kazanılır | ✅ `loyalty/earn-points` |
| C.2.11 | requireServedForDineInPayment=true → SERVED öncesi 400 | ✅ `settings-effects/pos-toggles` |

---

### C.3  `tables`

**Amaç:** Masa CRUD + merge/unmerge + bill flow.

**Sahip olduğu modeller:** `Table`, `TableGroup`.

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/tables` |
| GET | `/tables` |
| GET | `/tables/public/:tenantId` (auth'suz, QR menü için) |
| GET | `/tables/:id` |
| PATCH | `/tables/:id` |
| PATCH | `/tables/:id/status` |
| DELETE | `/tables/:id` |
| POST | `/tables/merge` |
| POST | `/tables/unmerge` |
| POST | `/tables/unmerge-all/:groupId` |
| GET | `/tables/group/:groupId` |

**Yan etkiler:**
- Status değişimi: orders.service ile bidirectional sync
- Merge: orders TableGroup'a bağlanır, combined bill summary üzerinden
- Unmerge: order'lar bireysel table'a geri döner
- maxTables plan limiti CheckLimit guard

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| C.3.1 | Create table + count artar | ✅ `admin-tables.spec.ts` |
| C.3.2 | maxTables limit (plan veya override) → 6. red | ✅ `behavior/plan-limits` |
| C.3.3 | maxTables=0 override → 1. bile red | ✅ `extra/plan-limits-all-keys` |
| C.3.4 | RESERVED → OCCUPIED status manual update | ❌ |
| C.3.5 | Merge → combined-bill-summary tüm order'ları döner | ❌ |
| C.3.6 | Unmerge → order'lar tek tek table'a döner | ❌ |
| C.3.7 | Table delete: aktif order varken reddedilir | ❌ |

---

### C.4  `menu` (categories + products)

**Amaç:** Menü kataloğu.

**Sahip olduğu modeller:** `Category`, `Product`, `ProductImage`, `ProductImageJunction`.

**Endpoint'ler:** Tipik CRUD (yukarıda listelendi). Ek olarak:
- `PATCH /menu/products/:id/stock` — manuel stock adjustment
- `PATCH /menu/products/:id/images/reorder`
- `DELETE /menu/products/:id/images/:imageId`

**Yan etkiler:**
- `stockTracked` flag → manuel `PATCH /stock` ile decrement; recipe-based modifiye STK yok
- Sipariş create → recipe varsa StockDeductionService trigger (Bölüm F)
- Product image upload → filesystem + ProductImage row + ProductImageJunction (display order)
- maxCategories, maxProducts plan limitleri

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| C.4.1 | Create category + product | ✅ `admin-menu`, factory testleri |
| C.4.2 | maxCategories cap → red | ✅ `extra/plan-limits-all-keys` |
| C.4.3 | maxProducts cap → red | ✅ |
| C.4.4 | Product price → orderItem subtotal'a yansır | ✅ |
| C.4.5 | Modifier priceAdjustment finalAmount'a eklenir | ✅ |
| C.4.6 | stockTracked manuel decrement (PATCH /stock) | ✅ `behavior/stock-deduction` |
| C.4.7 | stockTracked decrement < 0 → 400 | ✅ |
| C.4.8 | Image upload → ProductImage row + filesystem | ❌ |
| C.4.9 | Image reorder displayOrder güncellenir | ❌ |
| C.4.10 | SVG upload (XSS vector) reddedilir | ❌ |
| C.4.11 | Path traversal filename → UUID'ye normalize | ❌ |

---

### C.5  `modifiers`

**Amaç:** Ekstra/varyasyon (ör. soslar, ekstra peynir).

**Sahip olduğu modeller:** `ModifierGroup`, `Modifier`, `ProductModifierGroup` (junction + display order).

**Endpoint'ler:** Standart CRUD + `POST /modifiers/products/:productId/assign`.

**Yan etkiler:**
- `isRequired=true` ve `minSelections>=1` → order create'de validation
- Modifier `priceAdjustment` → orderItem subtotal'a eklenir (server-side, client-trust yok)
- SelectionType SINGLE/MULTIPLE — maxSelections gate

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| C.5.1 | Modifier price → order finalAmount'a yansır | ✅ |
| C.5.2 | Required modifier seçilmeden order — contract pinned | ⚠️ |
| C.5.3 | Modifier removed from product → mevcut orderItem'lar etkilenmez | ❌ |
| C.5.4 | SelectionType MULTIPLE + maxSelections > → 400 | ❌ |

---

### C.6  `kds` (Kitchen Display)

**Amaç:** Mutfak görünümü — real-time order kuyruğu.

**Sahip olduğu modeller:** Yok (Order/OrderItem üzerinden çalışır).

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| GET | `/kds/orders` (filter: PENDING/PREPARING/READY) — hard cap 200 |
| PATCH | `/kds/orders/:id/status` |
| PATCH | `/kds/order-items/:id/status` |
| PATCH | `/kds/orders/:id/cancel` |

**WebSocket gateway** (`/kds` namespace):
- Staff auth: JWT Bearer
- Customer auth: sessionId
- Rooms: `kitchen-{tenantId}`, `pos-{tenantId}`, `personnel-{tenantId}`, `customer-session-{sessionId}`
- Emit edilen event'ler:
  - `order:new`, `order:updated`, `order:status-changed`, `order:item-status-changed`
  - `payment:success`
  - `table:merged`, `table:unmerged`, `table:orders-transferred`
  - `bill-request:new`/`updated`, `waiter-request:new`/`updated`
  - `personnel:attendance-update`, `personnel:swap-request-update`
  - `low-stock-alert`
  - `customer:order-approved`

**Yan etkiler — item status:**
- Item all-READY → parent order auto-promote READY (eğer requiresApproval değilse)
- Item PENDING→PREPARING parent order'ı henüz değiştirmez

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| C.6.1 | KDS sayfası KITCHEN role ile reach | ✅ `kitchen.spec.ts` |
| C.6.2 | Socket order:new emit on POST /orders | ✅ `kds/socket-broadcast` |
| C.6.3 | Socket order:status-changed emit on PATCH status | ✅ |
| C.6.4 | Item-level PENDING→PREPARING | ✅ `extra/kds-item-status` |
| C.6.5 | All items READY → parent order auto-READY | ❌ |
| C.6.6 | KDS cap 200 (pathological queue) | ❌ |
| C.6.7 | Customer socket joins `customer-session-{id}` room | ❌ |
| C.6.8 | low-stock-alert socket emit on stock < threshold | ❌ |

---

## Bölüm D — Customer-facing (QR menü)

### D.1  `customer-public`

**Amaç:** QR-menü konuk yüzeyi — auth yok, sessionId üzerinden tenant bağlamı.

**Sahip olduğu modeller:** `CustomerSession`, `PhoneVerification`, `ReferralCode`.

**Endpoint'ler:**
| METHOD | Path | Throttle |
|---|---|---|
| POST | `/customer-public/sessions` | 20/dk |
| GET | `/customer-public/sessions/:sessionId` | 60/dk |
| POST | `/customer-public/sessions/validate` | 60/dk |
| POST | `/customer-public/identify` | — |
| GET | `/customer-public/profile` | — |
| GET | `/customer-public/loyalty/balance` | 60/dk |
| GET | `/customer-public/loyalty/transactions` | 30/dk |
| GET | `/customer-public/loyalty/config` | 60/dk |
| GET | `/customer-public/loyalty/tier` | 30/dk |
| POST | `/customer-public/phone/send-otp` | rate-limited |
| POST | `/customer-public/phone/verify-otp` | rate-limited |
| GET | `/customer-public/phone/verification-status/:id` | — |
| POST | `/customer-public/referral/generate` | — |
| POST | `/customer-public/referral/apply` | — |
| GET | `/customer-public/referral/stats` | — |

**Yan etkiler:**
- Session create: sessionId 64-hex (`randomBytes(32)`); CustomerSession.create
- OTP send: Twilio (mocked in dev), PhoneVerification.create + SMS
- OTP verify: PhoneVerification.update(verified=true) + (identify call) → Customer linklenir, session.customerId set
- Referral apply: ReferralCode.update(usedBy), her iki taraf (referrer + referee) için LoyaltyTransaction.create

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| D.1.1 | Session create (auth'suz) | ✅ implicit factory |
| D.1.2 | Loyalty config public read | ✅ `extra/customer-public` |
| D.1.3 | Anonymous session: balance identified=false, points=0 | ✅ |
| D.1.4 | OTP send + valid response | ✅ |
| D.1.5 | OTP verify bogus code reddedilir | ✅ |
| D.1.6 | OTP verify gerçek code → PhoneVerification.verified=true | ❌ |
| D.1.7 | identify → session.customerId set, balance identified=true | ❌ |
| D.1.8 | Referral generate → kod döner, ReferralCode row | ❌ |
| D.1.9 | Referral apply → her iki tarafa loyalty puanı düşer | ❌ |
| D.1.10 | Public-controller class-level `@Public()` (JWT guard bypass) | ✅ implicit (fix landed) |
| D.1.11 | sessionId 64-hex format guard (32 < len < 128) | ❌ |

---

### D.2  `customer-orders` (QR menü siparişi + requests)

**Amaç:** QR menüden müşterinin sipariş + waiter çağırma + hesap isteme.

**Endpoint'ler:**
| METHOD | Path |
|---|---|
| POST | `/customer-orders` |
| GET | `/customer-orders/session/:sessionId` |
| GET | `/customer-orders/:orderId` |
| POST | `/customer-orders/waiter-requests` |
| GET | `/customer-orders/waiter-requests/session/:sessionId` |
| PATCH | `/customer-orders/waiter-requests/:id/acknowledge` (STAFF) |
| PATCH | `/customer-orders/waiter-requests/:id/complete` (STAFF) |
| GET | `/customer-orders/waiter-requests/tenant/active` (STAFF) |
| POST | `/customer-orders/bill-requests` |
| GET | `/customer-orders/bill-requests/session/:sessionId` |
| PATCH | `/customer-orders/bill-requests/:id/acknowledge` (STAFF) |
| PATCH | `/customer-orders/bill-requests/:id/complete` (STAFF) |
| GET | `/customer-orders/bill-requests/tenant/active` (STAFF) |

**Yan etkiler:**
- Customer order create:
  - Status: `enableCustomerOrdering=true` ise `PENDING_APPROVAL` veya `PENDING`
  - Approval gerekli ise approveOrder ile staff PENDING'e geçirir
  - SMS: `smsOnOrderCreated` ON ise + phone set ise SMS
  - KDS socket: `order:new`
- Waiter-request: KDS socket `waiter-request:new` → POS terminallerinde uyarı
- Bill-request: KDS socket `bill-request:new` → POS terminallerinde uyarı

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| D.2.1 | Public guest create customer-order | ⚠️ implicit (self-pay flow) |
| D.2.2 | enableCustomerOrdering=false → reddedilir | ✅ `behavior/tableless-and-customer-ordering` |
| D.2.3 | Customer order requiresApproval → staff approve sonra hazırlanır | ❌ |
| D.2.4 | Waiter-request lifecycle (create→ack→complete) | ✅ `extra/customer-requests` |
| D.2.5 | Bill-request lifecycle | ✅ |
| D.2.6 | Socket waiter-request:new emit | ❌ (gateway test edilmedi) |

---

### D.3  `qr` (codes generation + settings)

**Amaç:** Tenant ve table-bazlı QR kod üretimi + QR menü ayarları.

**Sahip olduğu modeller:** `QrMenuSettings`.

**Endpoint'ler:**
- `GET/POST/PATCH/DELETE /qr/settings`
- `GET /qr/codes` — tüm tenant QR kodlarını + table QR'larını üretir (data URLs)

**Yan etkiler:**
- Settings değişimi → QR menü sonraki render'da yeni renkler/logo
- enableTableQR=false → /qr/codes table'lara QR üretmez
- 500-table cap (DoS koruma)

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| D.3.1 | Settings update (color/logo/show*) | ✅ `settings-effects/qr-menu-toggles` |
| D.3.2 | QR menü browser: showImages OFF → image wrapper yok | ✅ `browser/qr-menu-rendering` |
| D.3.3 | showPrices=false → ₺ sembolleri yok | ✅ |
| D.3.4 | primaryColor → button bg renk | ✅ |
| D.3.5 | logoUrl set/empty → img/fallback toggle | ✅ `browser/qr-menu-branding` |
| D.3.6 | enableTableQR=false → /qr/codes'ta table QR'ları yok | ❌ |
| D.3.7 | 500'den fazla table → 400 (DoS guard) | ❌ |

---

### D.4  `reservations` (public side)

**Amaç:** Müşteri rezervasyon talebi + telefon ile lookup/cancel.

**Endpoint'ler:**
- `POST /public/reservations/:tenantId`
- `GET /public/reservations/:tenantId/lookup?phone=...&number=...`
- `PATCH /public/reservations/:tenantId/:id/cancel`

**Yan etkiler:**
- Create → `Reservation.create(status=PENDING/CONFIRMED auto-approval setting'ine bağlı)`
- Auto-approval ON ise direkt CONFIRMED + SMS bildirim
- requireApproval ON ise PENDING_CUSTOMER_RESPONSE → staff onayı bekler

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| D.4.1 | Public reservation create | ✅ `reservations-flow/lifecycle` |
| D.4.2 | Past date reddedilir | ✅ |
| D.4.3 | Lookup phone+number → reservation döner | ❌ |
| D.4.4 | Cancel: yanlış phone → reddedilir | ✅ `extra/public-reservation-lookup` |
| D.4.5 | Cancel: doğru phone+number → status=CANCELLED, masa serbest | ✅ |
| D.4.6 | maxAdvanceDays sınırı server-side | ❌ |
| D.4.7 | maxReservationsPerSlot ulaşılınca yeni reservation reddedilir | ❌ |
| D.4.8 | requireApproval=true → PENDING_CUSTOMER_RESPONSE | ❌ |

---

## Bölüm E — Operasyon

### E.1  `reservations` (admin)

**Endpoint'ler:** `GET / PATCH /reservations[/:id]` + lifecycle PATCH'leri (`/confirm`, `/reject`, `/seat`, `/complete`, `/no-show`, `/cancel`).

**State machine:**
```
PENDING_CUSTOMER_RESPONSE / TENTATIVE
   ├─→ CONFIRMED ──→ SEATED ──→ COMPLETED
   │                     └────→ NO_SHOW
   └─→ REJECTED
   └─→ CANCELLED
```

**Yan etkiler:**
- CONFIRMED → Table → RESERVED + SMS gönderim (`smsOnReservationConfirmed`)
- SEATED → Table OCCUPIED, isteğe bağlı order auto-create
- COMPLETED → Table AVAILABLE
- NO_SHOW → Table AVAILABLE + opsiyonel müşteri istatistik düşmesi
- REJECTED → SMS (`smsOnReservationRejected`)

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| E.1.1 | confirm: status CONFIRMED + SMS | ✅ lifecycle test (SMS assert yok) |
| E.1.2 | reject: REJECTED | ✅ |
| E.1.3 | no-show: NO_SHOW | ✅ |
| E.1.4 | seat → table OCCUPIED | ❌ |
| E.1.5 | complete → table AVAILABLE | ❌ |
| E.1.6 | reservationSystem=false override → endpoint 403 | ✅ `behavior/plan-feature-override` |

---

### E.2  `personnel/attendance`

**Sahip olduğu modeller:** `Attendance`.

**Endpoint'ler:**
- `POST /personnel/attendance/{clock-in,clock-out,break-start,break-end}`
- `GET /personnel/attendance/my-status`
- `GET /personnel/attendance/today` (ADMIN/MANAGER)

**Yan etkiler:**
- Clock-in: ShiftAssignment varsa late kontrolü (`shiftStart + grace < now`)
- Clock-out: totalWorkedMinutes + overtime hesabı
- Break: totalBreakMinutes cumulative
- KDS socket: `personnel:attendance-update`

**İnvariant'lar:**
- (userId, date, tenantId) unique — günde tek attendance row
- "Already clocked out today, cannot clock in again" — bir gün içinde tek session
- gracePeriodMinutes — late detection eşiği

**Test planı:** ✅ `extra/personnel-shifts` + `personnel/clock-in-out`

| # | Senaryo | Coverage |
|---|---|---|
| E.2.1 | Clock-in → status CLOCKED_IN | ✅ |
| E.2.2 | Clock-out → CLOCKED_OUT | ✅ |
| E.2.3 | Already clocked out → cannot clock in again 400 | ✅ |
| E.2.4 | Clock-out without prior clock-in 4xx | ✅ |
| E.2.5 | Late detection (gracePeriod < now-shiftStart → isLate=true) | ❌ |
| E.2.6 | Break start/end → totalBreakMinutes accumulates | ❌ |
| E.2.7 | personnelManagement=false override → 403 | ✅ |

---

### E.3  `personnel/shift-templates` + `schedule`

**Sahip olduğu modeller:** `ShiftTemplate`, `ShiftAssignment`.

**Endpoint'ler:**
- Templates: `POST / GET / PATCH /personnel/shift-templates[/:id]`
- Schedule: `GET / POST(assign) / POST(assign-bulk) /personnel/schedule`

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| E.3.1 | Create template (HH:mm format) | ✅ |
| E.3.2 | List + Update | ✅ |
| E.3.3 | Schedule date-range query | ✅ |
| E.3.4 | Assign shift to user | ❌ |
| E.3.5 | Bulk assign (multiple users → multiple dates) | ❌ |
| E.3.6 | Çakışan shift → 409 | ❌ |

---

### E.4  `personnel/shift-swap`

**Sahip olduğu modeller:** `ShiftSwapRequest`.

**Endpoint'ler:**
- `POST /personnel/shift-swap/request`
- `PATCH /personnel/shift-swap/:id/target-accept`
- `PATCH /personnel/shift-swap/:id/target-reject`
- `PATCH /personnel/shift-swap/:id/approve`
- `PATCH /personnel/shift-swap/:id/reject`
- `GET /personnel/shift-swap`

**State machine:**
```
PENDING ──→ TARGET_ACCEPTED ──→ APPROVED
   │              │                  │
   └──→ TARGET_REJECTED              └──→ REJECTED
```

**Yan etkiler:**
- Approve (transactional): iki user'ın ShiftAssignment'ları swap edilir
- KDS socket: `personnel:swap-request-update`

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| E.4.1 | Request → PENDING | ❌ |
| E.4.2 | Target accept → TARGET_ACCEPTED | ❌ |
| E.4.3 | Target reject → TARGET_REJECTED (terminal) | ❌ |
| E.4.4 | Manager approve → APPROVED + assignments swap atomically | ❌ |
| E.4.5 | Self-approval reddedilir | ❌ |
| E.4.6 | Çift booking guard (requester'ın target tarihinde başka shift varsa) | ❌ |

---

### E.5  `personnel/performance`

**Endpoint:** `GET /personnel/performance?startDate=...&endDate=...`

Read-only aggregation: order count per user, sales total per user, ortalama servis süresi.

| # | Senaryo | Coverage |
|---|---|---|
| E.5.1 | Date-range query döner | ❌ |
| E.5.2 | User-level sales totals | ❌ |

---

## Bölüm F — Envanter

### F.1  `stock` (simple POS stock)

**Sahip olduğu modeller:** `StockMovement`.

**Endpoint'ler:**
- `POST /stock/movements` (manual adjustment)
- `GET /stock/movements?productId=&type=&from=&to=&page=`
- `GET /stock/alerts` (low-stock list)

**Yan etkiler:**
- Movement create → `Product.currentStock += quantity` (type=IN) veya `-=` (type=OUT)
- currentStock=0 → Product.isAvailable=false
- Threshold altına düşerse → günlük cron'da alert email (Bölüm P)

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| F.1.1 | `PATCH /menu/products/:id/stock` ile manual decrement | ✅ `behavior/stock-deduction` |
| F.1.2 | Decrement < 0 → 400 | ✅ |
| F.1.3 | stockTracked=false product reddedilir | ✅ |
| F.1.4 | StockMovement row oluşur | ❌ |
| F.1.5 | GET /stock/alerts threshold altındakileri döner | ❌ |
| F.1.6 | inventoryTracking=false override → 403 | ✅ |

---

### F.2  `stock-management` (recipe-based, deep)

**Sahip olduğu modeller:** `StockItem`, `StockBatch`, `StockItemCategory`,
`Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `IngredientMovement`,
`WasteLog`, `StockCount`, `Recipe`, `RecipeIngredient`.

**Endpoint'ler (her biri için tipik CRUD):**
- `/stock-management/items`
- `/stock-management/categories`
- `/stock-management/suppliers`
- `/stock-management/purchase-orders` + `POST .../:id/receive`
- `/stock-management/waste-logs`
- `/stock-management/counts` + `POST .../:id/reconcile`
- `/stock-management/ingredient-movements` (read-only)
- `/stock-management/recipes`
- `/stock-management/dashboard{,/valuation,/movement-summary}`

**Yan etkiler — Recipe-based deduction (en kritik kısım):**
1. Order create → `StockDeductionService.deductForOrder(orderId, status=PENDING)` çağrılır
2. Settings `deductOnStatus` kontrolü — sadece bu durumda deduction yapılır
3. Order.stockDeducted=true (idempotent, Serializable tx)
4. Her orderItem için → ürünün recipe'i → her RecipeIngredient için:
   - `(ingredient.quantity / recipe.yield) * orderItem.quantity` kadar düşür
   - StockItem.currentStock decrement
   - StockBatch FIFO drawdown (expiryDate ASC)
   - IngredientMovement.create(type=OUT, reason=ORDER, orderId)
5. Low-stock varsa KDS socket emit
6. allowNegativeStock=false ve yeterli stok yoksa → 409 ConflictException

**Yan etkiler — Purchase Order receive:**
- PO.status: SUBMITTED → PARTIALLY_RECEIVED → RECEIVED
- StockItem.currentStock += receivedQty
- StockItem.costPerUnit weighted-average güncellenir
- StockBatch.create(expiryDate, receivedAt)
- IngredientMovement.create(type=IN, reason=PO)
- Cannot exceed ordered quantity per line

**Yan etkiler — Stock Count reconcile:**
- StockCount.create(counted quantities)
- Eğer auto-adjust ON ise → StockItem.currentStock = counted
- IngredientMovement.create(type=ADJUSTMENT, reason=COUNT)

**Yan etkiler — Waste Log:**
- WasteLog.create (audit, write-only)
- StockItem.currentStock decrement
- IngredientMovement.create(type=OUT, reason=WASTE)

**İnvariant'lar:**
- Order.stockDeducted flag idempotency (Serializable isolation)
- FIFO batch order: oldest expiryDate first
- Weighted-average cost: `(oldQty*oldCost + newQty*newCost) / (oldQty+newQty)`
- Cannot receive more than ordered per PO line
- Recipe yield scaling: deduction = `(ingredientPerYield / yield) * orderQuantity`

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| F.2.1 | CRUD: StockItem | ❌ |
| F.2.2 | CRUD: Supplier | ❌ |
| F.2.3 | CRUD: Recipe + RecipeIngredient | ❌ |
| F.2.4 | Recipe attach to Product | ❌ |
| F.2.5 | Order create → recipe ingredients decrement | ❌ |
| F.2.6 | Order create → IngredientMovement row(s) yazılır | ❌ |
| F.2.7 | StockBatch FIFO drawdown | ❌ |
| F.2.8 | allowNegativeStock=false + yetersiz stok → 409 | ❌ |
| F.2.9 | Order cancel → IngredientMovement reverse (type=IN, reason=CANCEL) | ❌ |
| F.2.10 | Order.stockDeducted idempotent (iki paralel deduction call → bir tanesi exit) | ❌ |
| F.2.11 | PO submit → status SUBMITTED | ❌ |
| F.2.12 | PO receive partial → status PARTIALLY_RECEIVED | ❌ |
| F.2.13 | PO receive full → status RECEIVED + costPerUnit weighted-avg | ❌ |
| F.2.14 | PO receive > ordered quantity → 400 | ❌ |
| F.2.15 | Waste log → StockItem decrement + IngredientMovement(WASTE) | ❌ |
| F.2.16 | Stock count + reconcile → adjustments yazılır | ❌ |
| F.2.17 | Dashboard valuation (sum stockItem.currentStock × costPerUnit) | ❌ |

> **Açık dilim:** Bu modül en derin atlanan kısım. Recipe + ingredient + PO setup karmaşık; ayrı bir batch test (Batch 11 önerisi) gerekir.

---

## Bölüm G — Ayarlar

### G.1  `pos-settings`

**Alanlar:**
- `enableTablelessMode` — POS'ta takeaway hero kartı + tablesız COUNTER order
- `enableTwoStepCheckout` — UI: "Create Order" + ayrı "Payment" butonları; constraint olarak `enableCustomerOrdering=true` iken zorunlu
- `showProductImages`
- `enableCustomerOrdering` — QR menüden customer-order create gating
- `enableCustomerSelfPay` — QR menüden müşterinin direkt ödeme yapması
- `defaultMapView` (2d/3d)
- `requireServedForDineInPayment` — DINE_IN order SERVED olmadan ödenemez

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| G.1.1 | enableTablelessMode ON: POS'ta takeaway hero görünür | ✅ `browser/pos-tableless-mode` |
| G.1.2 | enableTablelessMode OFF: hero yok | ✅ |
| G.1.3 | requireServedForDineInPayment ON: SERVED öncesi ödeme 400 | ✅ |
| G.1.4 | requireServedForDineInPayment OFF: READY iken ödenebilir | ✅ |
| G.1.5 | enableCustomerSelfPay OFF: /pay-intent reddedilir | ✅ `self-pay/dine-in-webhook` |
| G.1.6 | enableCustomerOrdering OFF: /customer-orders reddedilir | ✅ `behavior/tableless-and-customer-ordering` |
| G.1.7 | enableTwoStepCheckout disable while customerOrdering ON → 400 | ✅ `behavior/two-step-checkout` |
| G.1.8 | showProductImages → POS menu UI bool | ❌ |

---

### G.2  `sms-settings`

**Alanlar:** master `isEnabled` + her event için ayrı toggle (reservation, order × 4 status).

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| G.2.1 | PATCH /sms-settings persist | ⚠️ implicit |
| G.2.2 | smsOnOrderCreated ON: order create → SMS gönderildi (mock) | ❌ |
| G.2.3 | master isEnabled OFF → hiçbir event SMS göndermez | ❌ |
| G.2.4 | Phone null/empty → SMS sessizce atlanır | ❌ |

---

### G.3  `tenant` settings (currency, timezone, branding, social)

Bölüm B.1 zaten kapsadı.

---

### G.4  `settings/integrations` (API key management)

**Endpoint'ler:** Standart CRUD + `PATCH .../:id/toggle` + `POST .../:id/sync`.

| # | Senaryo | Coverage |
|---|---|---|
| G.4.1 | Create integration (ADMIN only) | ❌ |
| G.4.2 | apiAccess feature OFF → 403 | ❌ |
| G.4.3 | toggle isEnabled → bool flip | ❌ |
| G.4.4 | sync timestamp update | ❌ |

---

### G.5  `stock-management/settings`

**Alanlar:** `enableAutoDeduction`, `deductOnStatus`, `lowStockAlertDays`, `poNumberPrefix`, `allowNegativeStock`.

| # | Senaryo | Coverage |
|---|---|---|
| G.5.1 | deductOnStatus=READY → PENDING'de düşmez, READY'de düşer | ❌ |
| G.5.2 | allowNegativeStock=false → yetersiz stok 409 | ❌ |
| G.5.3 | poNumberPrefix → yeni PO number prefix'i bu | ❌ |

---

### G.6  `reservations/settings`

| # | Senaryo | Coverage |
|---|---|---|
| G.6.1 | isEnabled=false → public reservation create 403 | ❌ |
| G.6.2 | requireApproval=true → status PENDING_CUSTOMER_RESPONSE | ❌ |
| G.6.3 | maxAdvanceDays sınırı reddi | ❌ |

---

### G.7  `accounting-settings`

| # | Senaryo | Coverage |
|---|---|---|
| G.7.1 | Provider connection test | ❌ |
| G.7.2 | autoSync → invoice create sonrası async sync trigger | ❌ |

---

### G.8  `desktop-app`/`hardware`

| # | Senaryo | Coverage |
|---|---|---|
| G.8.1 | GET /hardware/config | ✅ `extra/hardware-and-notifications` |
| G.8.2 | POST /hardware/devices/:id/status | ❌ |
| G.8.3 | POST /hardware/devices/:id/events | ❌ |
| G.8.4 | Release management (DesktopRelease CRUD) | ❌ |
| G.8.5 | trackDownload increment | ❌ |

---

## Bölüm H — Raporlama

### H.1  `reports`

**Endpoint'ler:** `GET /reports/{sales,top-products,payments,orders-by-hour,customers,inventory,staff-performance}`.

Read-only aggregations; her biri `advancedReports` feature gate'i altında.

**İnvariant'lar:**
- Decimal-to-cents conversion (IEEE-754 yuvarlama önleme)
- Tenant timezone'da "today" hesabı
- PAID order filter
- Top products: `_sum.subtotal DESC, take 10`

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| H.1.1 | /reports/sales 200 + JSON shape | ⚠️ smoke |
| H.1.2 | advancedReports OFF → 403 | ✅ override testi |
| H.1.3 | top-products limit cap 100 | ❌ |
| H.1.4 | Tenant timezone'a göre "today" bounds | ❌ |
| H.1.5 | Cross-tenant product leakage yok | ❌ |

---

### H.2  `z-reports`

**Sahip olduğu modeller:** `ZReport`.

**Endpoint'ler:**
- `POST /z-reports`
- `GET /z-reports[/:id]`
- `GET /z-reports/:id/pdf`
- `POST /z-reports/:id/send-email`

**Yan etkiler:**
- Tenant timezone'a göre `[start, end)` bounds
- PAID + REFUNDED ayrımı, refunds netSales'ten düşülür
- Payment method breakdown
- Tax breakdown (KDV oranlarına göre)
- Cash reconciliation: `expectedCash = opening + cashPayments + cashInOut`
- Staff performance
- Top products
- Category breakdown
- PDF üretimi (pdfkit)
- Email send (tenant.reportEmails)
- Unique constraint: (tenantId, reportDate)

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| H.2.1 | Aynı tarih için ikinci Z-Report 4xx | ✅ `reports/z-report` |
| H.2.2 | Liste 200 | ✅ |
| H.2.3 | Tenant timezone Istanbul: 23:59 order bu güne sayılır | ❌ |
| H.2.4 | currency=EUR → PDF `€` sembolü kullanır | ❌ |
| H.2.5 | Cash reconciliation difference flagged | ❌ |
| H.2.6 | Email send → SendGrid/mailer call | ❌ |

---

### H.3  `analytics`

**Sahip olduğu modeller:** `Camera`, `OccupancyRecord`, `TrafficFlowRecord`, `TableAnalytics`, `AnalyticsInsight`, `AnalyticsHeatmapCache`, `EdgeDevice`.

**WebSocket gateway:** `/analytics-edge` namespace (canlı metrikler).

**Mostly read-only;** heatmap + insight cron'larıyla refresh.

| # | Senaryo | Coverage |
|---|---|---|
| H.3.1 | Heatmap cache refresh cron | ❌ |
| H.3.2 | Insight generation | ❌ |
| H.3.3 | WebSocket emit | ❌ |

---

## Bölüm I — Abonelik & faturalandırma

### I.1  `subscriptions`

**Sahip olduğu modeller:** `SubscriptionPlan`, `Subscription`, `SubscriptionPayment`, `PendingPlanChange`, `Invoice` (subscription invoice — order invoice ile farklı).

**Endpoint'ler:** (bölüm 2'deki tüm liste — current, plans, change-plan, cancel, reactivate, scheduled-downgrade, invoices).

**Yan etkiler — change-plan:**
- PayTR payment intent + PendingPlanChange row
- Webhook success → Subscription.plan değişir + Tenant.currentPlanId update
- Trial trial-eligible plan ise (usedTrialPlanIds'a bakılır) → Trial activation (no charge), planı TRIALING'e
- Audit: SubscriptionPaymentSchedulerService cron'u recurring renewal'ları işler

**Plan feature/limit precedence:**
- effective = `featureOverrides[key] ?? plan[key]`
- limit effective = `limitOverrides[key] ?? plan[key]`
- maxX=-1 → unlimited

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| I.1.1 | GET current/effective-features/plans | ✅ `subscriptions/current-subscription` |
| I.1.2 | FREE plan intent reddi | ✅ |
| I.1.3 | Unverified email → intent reddi | ✅ |
| I.1.4 | Plan limits override (maxTables, maxProducts, …) | ✅ |
| I.1.5 | Plan features override OFF → routes 403 | ✅ |
| I.1.6 | Plan = FREE: maxUsers=2, maxTables=5, maxProducts=25, reservationSystem OFF, etc. → fresh seed ile assertion | ❌ |
| I.1.7 | Plan = BASIC: inventoryTracking=true, advancedReports=false | ❌ |
| I.1.8 | Plan = PRO: tüm features ON, maxTables=50 | ❌ |
| I.1.9 | Plan değişimi PRO→FREE (downgrade) → scheduled-downgrade row | ❌ |
| I.1.10 | scheduled-downgrade cancel | ❌ |
| I.1.11 | Subscription cancel immediate vs at-period-end | ❌ |
| I.1.12 | Reactivate cancelled | ❌ |

---

### I.2  `payments` (subscription PayTR intent)

**Endpoint:** `POST /payments/create-intent` (rate-limited 5/dk).

**Yan etkiler:**
- PayTR `getIframeToken` API call
- SubscriptionPayment.create(PENDING) + paytrMerchantOid (cryptographically unique)
- PendingPlanChange row (upgrade) veya PENDING Subscription pre-create (first-time)
- Trial-eligible ise PayTR'a uğramadan TRIAL aktive olur (no charge)
- Webhook callback → flip to ACTIVE / cleanup orphans

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| I.2.1 | FREE plan reddedilir | ✅ |
| I.2.2 | Unverified email reddi | ✅ |
| I.2.3 | Trial eligible → TRIAL activated, no PayTR call | ❌ (verified email + plan setup gerekir) |
| I.2.4 | PayTR success webhook → Subscription ACTIVE | ❌ (PayTR sandbox gerekir) |
| I.2.5 | PayTR fail webhook → SubscriptionPayment.status=FAILED | ❌ |
| I.2.6 | Webhook HMAC invalid → 'FAIL' response | ❌ |
| I.2.7 | Orphan cleanup cron → eski PENDING'ler silinir | ❌ |

---

### I.3  `invoices` (subscription tarafı)

| # | Senaryo | Coverage |
|---|---|---|
| I.3.1 | GET /invoices/:id | ❌ |
| I.3.2 | PDF download | ❌ |
| I.3.3 | Generate-pdf re-create | ❌ |

---

### I.4  `webhooks/paytr`

**Endpoint:** `POST /webhooks/paytr` (public, HMAC SHA256 validated).

**Dispatch:** merchantOid prefix `SP*` → customer self-pay; diğeri → subscription.

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| I.4.1 | Subscription success webhook → Subscription ACTIVE | ❌ |
| I.4.2 | Self-pay success webhook → OrderItemPayment allocations | ❌ |
| I.4.3 | Failed webhook → status FAILED + failureReason | ❌ |
| I.4.4 | Invalid HMAC → 'FAIL' return | ❌ |
| I.4.5 | Unknown merchantOid → 'OK' (idempotent silent) | ❌ |
| I.4.6 | Aynı webhook iki kez → idempotent (replay) | ❌ |

---

### I.5  `accounting/sales-invoice` (per-order tax invoice)

**Sahip olduğu modeller:** `SalesInvoice`, `SalesInvoiceItem`, `InvoiceCounter`.

**Yan etkiler:**
- Order ödenince auto-generate (autoSync ise external accounting provider'a push)
- InvoiceCounter atomically increments (race-free invoice numbering)
- One invoice per Order (unique constraint)
- Per-Payment invoice (separate, idempotent on partial unique index)
- Tax breakdown JSON per taxRate

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| I.5.1 | Order PAID → SalesInvoice oluşur | ❌ |
| I.5.2 | InvoiceCounter atomik increment | ❌ |
| I.5.3 | Aynı order için ikinci create reddedilir | ❌ |
| I.5.4 | Per-Payment invoice idempotent | ❌ |
| I.5.5 | Tax breakdown JSON doğru | ❌ |
| I.5.6 | autoSync ON → external provider'a HTTP push (mock) | ❌ |

---

## Bölüm J — Customer Self-Pay

**Endpoint'ler:**
- `GET /customer-orders/sessions/:sessionId/payable-items`
- `POST /customer-orders/sessions/:sessionId/pay-intent`
- `GET /customer-orders/sessions/:sessionId/pay-status`

**Sahip olduğu modeller:** `PendingSelfPayment` (15dk TTL, itemsByOrder JSON).

**Yan etkiler:**
- Pay-intent → PayTR call → merchantOid `SP*` prefix
- PendingSelfPayment.create(itemsByOrder snapshot, expiresAt = +15min)
- Reservations counter: customers can't double-pay same item (reservation lock)
- Webhook success → OrderItemPayment allocations per orderId in itemsByOrder
- Webhook fail → PendingSelfPayment.status=FAILED
- Lazy expiry: getPayStatus PENDING'ı geçen TTL ile EXPIRED'a çevirir
- Sweeper cron her 30dk

**İnvariant'lar:**
- Dine-in: customer can pay any item on their table
- Takeaway: only orders created by their session
- Mixed-payment guard: legacy single-payment varsa self-pay reddedilir
- Idempotency: webhook key `selfpay:${merchantOid}:${orderId}`

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| J.1 | Session create + payable-items list | ✅ `self-pay/dine-in-webhook` |
| J.2 | enableCustomerSelfPay=false → /pay-intent 4xx | ✅ |
| J.3 | Full pay-intent → webhook → allocations | ❌ (PayTR sandbox) |
| J.4 | TTL expiry → status EXPIRED, reservations released | ❌ |
| J.5 | Mixed-payment block (single payment order) | ❌ |
| J.6 | Webhook idempotency (replay) | ❌ |
| J.7 | Takeaway: only own-session orders visible | ❌ |

---

## Bölüm K — Delivery entegrasyonları

### K.1  `delivery-platforms`

**Platforms:** YEMEKSEPETI, GETIR, TRENDYOL, MIGROS.

**Sahip olduğu modeller:** `DeliveryPlatformConfig` (per-tenant + per-platform), `DeliveryPlatformLog` (audit), `MenuItemMapping`.

**Endpoint'ler:** (Bölüm 1'de listelendi).

**Yan etkiler — inbound order webhook:**
1. Platform → POST /webhooks/delivery/yemeksepeti/order/:remoteId
2. processIncomingOrder:
   - MenuItemMapping ile externalItemId → productId resolve
   - Unmapped items → requiresApproval=true, notes'a kaydet
   - Totals validation (5% drift veya 1₺) → requiresApproval=true
   - Order.create(status=PENDING_APPROVAL veya PENDING)
   - OrderItem bulk-create
   - KDS socket order:new
   - DeliveryPlatformLog
   - autoAccept=true → platform API'a acceptOrder
3. Circuit breaker: errorCount >= 10 → isEnabled=false (auto-disable)

**İnvariant'lar:**
- Unique (tenantId, source, externalOrderId) → duplicate webhook idempotent
- Totals drift → manual approval zorunlu
- Unmapped items → notes'a yazılır, line item olarak yaratılmaz

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| K.1.1 | Config CRUD | ❌ |
| K.1.2 | Test connection endpoint | ❌ |
| K.1.3 | Inbound order webhook (mock) → Order + OrderItems oluşur | ❌ |
| K.1.4 | Unmapped item → requiresApproval=true | ❌ |
| K.1.5 | Totals drift → requiresApproval=true | ❌ |
| K.1.6 | Duplicate externalOrderId → idempotent (P2002) | ❌ |
| K.1.7 | Circuit breaker: 10 fail → isEnabled=false | ❌ |
| K.1.8 | Manual menu sync | ❌ |
| K.1.9 | deliveryIntegration feature OFF → endpoints 403 | ❌ |

> **Açık dilim:** Tüm K.1 testleri PayTR-mock benzeri bir HTTP-mock servisi gerektirir. Ayrı batch.

---

## Bölüm L — Platform (SuperAdmin)

### L.1  `superadmin/tenants`

**Endpoint'ler:** Tenant list, detail, users, orders, stats, status update, overrides.

**Yan etkiler:**
- Status değişimi → tenant operasyonları reddedilir (JwtAuthGuard tenant.status check)
- featureOverrides JSON merge logic (key=null → delete)
- limitOverrides aynı
- Her mutation → AuditLog.create

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| L.1.1 | List tenants | ✅ `superadmin/full-flow` |
| L.1.2 | Suspend tenant → tenant ops 401/403 | ✅ `extra/tenant-suspension` |
| L.1.3 | Re-activate tenant | ✅ |
| L.1.4 | featureOverrides flip → tenant'ın effective-features yansır | ✅ |
| L.1.5 | limitOverrides → CheckLimit guard yeni cap'i uygular | ✅ |
| L.1.6 | Tenant detail (users/orders/stats) | ⚠️ smoke |
| L.1.7 | DELETED status → tenant tamamen erişilemez | ❌ |

---

### L.2  `superadmin/users`

**Endpoint'ler:** Cross-tenant user list, activity, detail.

| # | Senaryo | Coverage |
|---|---|---|
| L.2.1 | List users | ✅ `extra/superadmin-extra` |
| L.2.2 | Activity feed | ❌ |
| L.2.3 | Cross-tenant user filter | ❌ |

---

### L.3  `superadmin/subscriptions` + `superadmin/plans`

**Endpoint'ler:** Plan CRUD + subscription extend/cancel.

| # | Senaryo | Coverage |
|---|---|---|
| L.3.1 | Plan CRUD | ❌ |
| L.3.2 | Subscription extend (period uzatma) | ❌ |
| L.3.3 | Subscription cancel immediate | ❌ |
| L.3.4 | Subscription cancel AT_PERIOD_END | ❌ |

---

### L.4  `superadmin/audit-logs`

**Endpoint'ler:** `GET /superadmin/audit-logs[?filters]`, `GET /superadmin/audit-logs/export` (CSV).

| # | Senaryo | Coverage |
|---|---|---|
| L.4.1 | Audit log list paginated | ✅ |
| L.4.2 | CSV export — CSV injection defense (`=`, `+`, `-`, `@` prefix escape) | ❌ |
| L.4.3 | Filter by actorId, action, date range | ❌ |
| L.4.4 | Every superadmin write → audit row | ❌ |

---

### L.5  `superadmin/dashboard`

**Endpoint'ler:** stats, revenue, growth, plans, recent, alerts, audit-recent.

| # | Senaryo | Coverage |
|---|---|---|
| L.5.1 | stats endpoint | ✅ |
| L.5.2 | revenue chart data | ✅ |
| L.5.3 | growth metrics | ❌ |
| L.5.4 | audit-recent | ✅ (no-5xx assertion) |

---

## Bölüm M — Marketing CRM

### M.1  `marketing/leads`

**Sahip olduğu modeller:** `MarketingLead`, `MarketingLeadActivity`.

**State machine:**
```
NEW → CONTACTED → DEMO_SCHEDULED → OFFER_SENT → WAITING → WON / LOST
```

**Yan etkiler — WON conversion:**
- Tenant.create + admin User.create + Trial Subscription
- Subdomain allocation (mirror of auth.service)
- MarketingCommission.create (signup commission 10% × planMonthlyPrice)
- Lead.tenantId set (idempotency)

**Test planı:**

| # | Senaryo | Coverage |
|---|---|---|
| M.1.1 | Create lead | ✅ `marketing/full-flow` |
| M.1.2 | Status transitions | ❌ |
| M.1.3 | WON conversion → tenant + admin user + trial sub + commission | ❌ |
| M.1.4 | Idempotency: aynı lead iki kez convert | ❌ |
| M.1.5 | Activity log per status change | ❌ |
| M.1.6 | Subdomain çakışması → retry 5 + 409 | ❌ |

---

### M.2  `marketing/tasks`

| # | Senaryo | Coverage |
|---|---|---|
| M.2.1 | CRUD | ❌ |
| M.2.2 | Complete → status COMPLETED | ❌ |

---

### M.3  `marketing/offers`

| # | Senaryo | Coverage |
|---|---|---|
| M.3.1 | CRUD | ❌ |
| M.3.2 | Send offer → email + tracking | ❌ |

---

### M.4  `marketing/commissions`

**State machine:** `PENDING → APPROVED → PAID`

| # | Senaryo | Coverage |
|---|---|---|
| M.4.1 | Approve → status APPROVED | ❌ |
| M.4.2 | Pay → status PAID, paidAt set | ❌ |
| M.4.3 | Recurring commission (monthly 5%) cron'la oluşur | ❌ |

---

### M.5  `marketing/users` + dashboard + reports

| # | Senaryo | Coverage |
|---|---|---|
| M.5.1 | Sales-manager creates sales-rep | ❌ |
| M.5.2 | Dashboard stats endpoint | ✅ smoke |
| M.5.3 | Reports endpoints | ❌ |

---

## Bölüm N — Misc

### N.1  `notifications`

**Sahip olduğu modeller:** `Notification`, `UserNotificationRead`.

**WebSocket gateway:** `/notifications` namespace.

| # | Senaryo | Coverage |
|---|---|---|
| N.1.1 | GET /notifications | ✅ `extra/hardware-and-notifications` |
| N.1.2 | Mark-as-read upsert | ⚠️ |
| N.1.3 | Mark-all-read | ✅ |
| N.1.4 | isGlobal=true → tüm tenant userları görür | ❌ |
| N.1.5 | Cross-tenant notification ID lookup reddi | ❌ |
| N.1.6 | Expired notification filtered out | ❌ |
| N.1.7 | notifyAdmins → her ADMIN/MANAGER için ayrı row + WS emit | ❌ |
| N.1.8 | Real-time socket emit on create | ❌ |

---

### N.2  `contact` (landing page form)

**Sahip olduğu modeller:** `ContactMessage`.

| # | Senaryo | Coverage |
|---|---|---|
| N.2.1 | Public submit → DB row + admin email | ❌ |
| N.2.2 | Honeypot (website field doldurursa) → sessiz kabul, satır yok | ❌ |
| N.2.3 | Mark as read | ❌ |
| N.2.4 | Rate limit (3/saat per IP) | ❌ |
| N.2.5 | CRLF-guarded fields | ❌ |

---

### N.3  `public-stats`

**Sahip olduğu modeller:** `PublicStatsCache` (singleton), `PageView`, `PublicReview`.

| # | Senaryo | Coverage |
|---|---|---|
| N.3.1 | GET /public-stats → cache snapshot | ❌ |
| N.3.2 | trackPageView → PageView row (ipHash) | ❌ |
| N.3.3 | submitReview → PublicReview status=PENDING | ❌ |
| N.3.4 | Cron refreshes cache | ❌ |
| N.3.5 | totalRevenue field masking (sensitive) | ❌ |

---

### N.4  `upload`

**Sahip olduğu modeller:** `ProductImage`, `ProductImageJunction`.

| # | Senaryo | Coverage |
|---|---|---|
| N.4.1 | Upload product image → file + DB row | ❌ |
| N.4.2 | SVG rejected (XSS) | ❌ |
| N.4.3 | Path traversal in filename reddedilir | ❌ |
| N.4.4 | File size > 5MB → 413 | ❌ |
| N.4.5 | Delete image → file + row | ❌ |
| N.4.6 | Logo upload (separate path) | ❌ |

---

### N.5  `qr` codes generation

Bkz. D.3.

---

## Bölüm O — WebSocket gateway'leri

### O.1  `/kds`

Bkz. C.6.

### O.2  `/notifications`

Bkz. N.1.

### O.3  `/analytics-edge`

Bkz. H.3.

**Yaygın testler:**

| # | Senaryo | Coverage |
|---|---|---|
| O.1 | Auth: bad JWT → disconnect | ❌ |
| O.2 | Customer-session room joining | ❌ |
| O.3 | Role-based room joining (kitchen vs pos vs personnel) | ❌ |
| O.4 | Reconnect → re-fetch state via getKitchenOrders | ❌ |

---

## Bölüm P — Cron job'lar

Her biri Postgres advisory lock ile horizontal-scale safe.

| Cron name | Cadence | İş | Test |
|---|---|---|---|
| `trial-expirations` | 00:00 UTC | Trial bitenleri EXPIRED yap | ❌ |
| `subscription-renewals` | 02:00 UTC | PayTR recurring veya PAST_DUE | ❌ |
| `pending-cancellations` | 00:00 UTC | period-end iptaller | ❌ |
| `past-due-subscriptions` | 03:00 UTC | PAST_DUE → EXPIRED | ❌ |
| `trial-reminders` | 10:00 UTC | Trial bitiş öncesi email | ❌ |
| `scheduled-downgrades` | 01:00 UTC | Plan downgrade uygula | ❌ |
| `paytr-orphan-cleanup` | hourly | Stale PENDING subscription payments | ❌ |
| `self-pay-orphan-cleanup` | every 30 min | Stale PENDING self-pay intents | ❌ |
| `stock-alerts` | hourly | Low-stock email | ❌ |
| `delivery-platforms/order-polling` | every 5 min | Platform sipariş polling | ❌ |
| `delivery-platforms/token-refresh` | per platform TTL | Platform auth token rotation | ❌ |
| `email-reports` | tenant.closingTime | Günlük rapor email | ❌ |

**Test stratejisi:** Cron'ları doğrudan service method invoke ederek tetiklemek (Nest test utility ile DI). Veya backend'e test-mode endpoint açıp `POST /test/cron/:name` ile manuel tetikleme.

---

## Bölüm Q — Mevcut coverage haritası

### Hatırlatma: 191 test yeşil, 11 batch tamamlandı

| Batch | Konu | Test sayısı | Durum |
|---|---|---|---|
| Baseline | Smoke (login, basit CRUD) | 45 | ✅ |
| 2 | Orders + Payments + Self-Pay gating | +18 | ✅ |
| 3 | Stock manual + KDS sockets + Tables | +8 | ✅ |
| 4 | Reservations + Personnel + Menu mod + Loyalty + Z-Reports | +13 | ✅ |
| 5 | Subscriptions (read) + SuperAdmin/Marketing gating | +12 | ✅ |
| 6 | Settings cross-module (API-level) | +11 | ✅ |
| 7 | Cross-cutting (IDOR, role grid, refresh) | +29 | ✅ |
| Platform | SuperAdmin 2FA + Marketing tam akış | +2 | ✅ |
| 8 | API-level real behavior (loyalty fix vb.) | +14 | ✅ |
| 9 | Browser-driven UI verification | +12 | ✅ |
| 10 | Tenant susp/personnel/customer/plan-limits/KDS | +27 | ✅ |
| **TOPLAM** | | **191** | ✅ |

### Eksik kalan batch'ler (öncelik sırasına göre)

| Batch | Konu | Tahmini test | Engel |
|---|---|---|---|
| 11 | Stock-management recipe + ingredient + PO + waste + count | ~25 | Karmaşık setup, ayrı bir oturum işi |
| 12 | Auth full lifecycle (register, approve, verify, reset, OAuth) | ~15 | Email mock + Google sandbox |
| 13 | Delivery platforms (Yemeksepeti/Trendyol/Getir/Migros) | ~20 | HTTP-mock servisi gerekir |
| 14 | Accounting sales-invoice + provider sync | ~10 | External provider mock |
| 15 | Plans behavior (FREE/BASIC/PRO real plan-driven gating) | ~15 | Tenant.currentPlanId değiştirme + reset |
| 16 | PayTR webhook full (subscription + self-pay) | ~12 | Test-mode bypass flag backend'e eklenmeli |
| 17 | Cron job tetiklenmeleri | ~12 | Backend'e test-mode invoke endpoint'i |
| 18 | Shift swap full + performance + audit log assertions | ~15 | — |
| 19 | Notifications + Contact + Upload + Public-stats | ~15 | — |
| 20 | WebSocket gateway derin (auth, room mgmt, reconnect) | ~10 | — |

**Tahmini ek:** 159 test. Hedef: ~350 toplam test.

---

## Sonsöz

Bu doküman **iki amaca** hizmet eder:
1. **Bakım rehberi**: Yeni bir özellik eklendiğinde, ilgili modülün bölümüne
   bakıp "hangi yan etkileri test etmeliyim" sorusunu hızlıca yanıtlamak.
2. **Eksik test envanteri**: ❌ işaretli her satır kapatılabilir bir görev.

Hangi batch'e öncelik vereceğin senin kararın — yukarıdaki tabloda
batch 11 (stock-management deep) muhtemelen iş değeri en yüksek olan
çünkü recipe-based deduction bir sürü davranışı tetikliyor ve hiç
test edilmedi.
