# 3D baskı figür hizmeti (Figurunica) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kiracı kendi menüsünden 1–50 ürün seçsin, her ürün için Figurunica'nın ürettiği bir 3D baskı figürü ₺1.500 taban + ₺50/ürün brüt fiyatla mevcut PayTR rayından satın alsın, üretim kuyruğu superadmin panelinde görünsün ve kargo mevcut `Shipment` rayıyla takip edilsin.

**Architecture:** Üç ray. **(1)** İki `HardwareProduct(category:'service')` SKU'su — `print3d_base` (qty 1) + `print3d_item` (qty N) — mevcut `QuoteService → CheckoutIntentService → PayTR → CheckoutSettlementService → CheckoutService.confirmAndProvision` para hattından geçer; adet **sunucuda** seçilen ürün id'lerinden türetilir, istemcinin `qty`'si yok sayılır. **(2)** Provizyon aynı `Serializable` tx içinde `Print3dJob` + N adet `Print3dJobItem` basar; her kalem ad/foto/`model3dUrl` anlık görüntüsü taşır, çünkü menü ürünleri gerçekten siliniyor. **(3)** SPA tarafında paylaşılan `cartStore` KULLANILMAZ; bağımsız üç adımlı bir sihirbaz kendi iki satırlık sepetini üretir, superadmin tarafında ayrı bir üretim paneli kuyruğu ve Figurunica manifestosunu gösterir.

**Tech Stack:** NestJS + Prisma + Postgres (backend), React + TanStack Query + Zustand (frontend), jest / vitest / supertest.

**Spec:** `docs/superpowers/specs/2026-08-20-3d-baski-figur-hizmeti-design.md`

## Global Constraints

- **Fiyat: `150_000` kuruş taban + `5_000` kuruş × N.** KDV **dahil** (brüt), kargo **dahil**. 1 ürün → ₺1.550 · 10 ürün → ₺2.000 · 50 ürün → ₺4.000. Minimum 1, maksimum 50 ürün.
- **Adet sunucu-otoriterdir.** `print3d_item.qty = productIds.length`; istemcinin gönderdiği `qty` **yok sayılır**. İstemci qty'sine güvenmek 50 figürü ₺50'ye satar.
- **Eşleşme zorunlu:** `print3d_base` ve `print3d_item` satırları ya birlikte vardır ya hiç. Her birinden **tam olarak bir tane**.
- **Çapraz-kiracı `productId` hata verir** (`PRINT3D_FOREIGN_PRODUCT`); **silinmiş** `productId` hata VERMEZ (tutar `ids.length`'ten türediği için değişmez, yerleşim anında fırlatmak "kart çekildi, hiçbir şey sağlanmadı" demektir).
- **Hizmet-yalnız sepette kargo ₺0'dır ve bu bilinçlidir** (`quote.service.ts` `hasHardware` dalı). "Düzeltmek" ilan edilen fiyatın üstüne ₺50 bindirir ve `checkout.service.ts`'in 1 kuruş toleransını patlatır.
- **`ALACARTE_CATALOG`'a (`backend/src/modules/marketplace/alacarte-catalog.const.ts`) HİÇ dokunulmaz** ve `alacarte-catalog-migration.spec.ts`'in `FOLLOW_UP_SQL` listesine giriş **eklenmez**. Print3d satırları `marketplace_addons`'ta değil `hardware_products`'tadır.
- **Yeni entitlement / feature flag YOK.** `FEATURE_KEYS` 14-nokta senkronu tetiklenmez.
- **Stil/tarz seçimi YOK. Meshy/AI 3D üretim hattı ÇALIŞTIRILMAZ.** Ürünün zaten sahip olduğu `model3dUrl` yalnızca kopyalanır.
- **Migration `20260820170000_print3d_service`.** v3.7.0 zincirinin **son halkasıdır**. Yetkili zincir: `20260820100000_tenant_country_code` (mevcut) → `20260820120000_reprice_licence_and_stock` (mevcut) → `20260820130000_widen_money_decimal_precision` (mevcut) → `20260820140000_delivery_platforms_bundle` (Change 1) → `20260820150000_card_shift_schema` (Change 2a) → `20260820160000_card_shift_catalog` (Change 2b) → **`20260820170000_print3d_service` (Change 3)**. Bu PR üç paralel değişikliğin **sonuncusudur**; merge sırası Change 1 → Change 2 → Change 3.
- **Her migration tersinir up/down çiftidir.** `migration.sql` + `down.sql`, `-- @doctor:idempotent verified=…` başlığıyla. Down idempotenttir, dar kapsamlıdır, tam olarak up'ın eklediğini kaldırır, ikinci koşuda hata vermez ve **operatör/kiracı verisine asla dokunmaz**. Ödenmiş `print3d_jobs` satırı varken down `RAISE EXCEPTION` ile durur.
- **Elle yazılan SQL snake_case `@@map` tablo adı kullanır** (`hardware_products`, `hardware_orders`, `products`, `print3d_jobs`, `print3d_job_items`) — CI `prisma db push` kullanır ve migration SQL'ini hiç çalıştırmaz, bu yüzden PascalCase yalnızca production deploy'da 42P01 verir.
- **`whitelist:true`** (`main.ts`) beyan edilmemiş DTO alanını **sessizce siler**. `CartItemDto.productIds` beyan edilmek ZORUNDADIR.
- Backend testi: `cd /home/tarik/Projects/kds/backend && npx jest <path>`. **Lint doğrulaması `npm run lint:ci`** — `npm run lint` `--fix` taşır ve hatayı gizler. Tip: `cd backend && npx tsc --noEmit`.
- Frontend testi: `cd /home/tarik/Projects/kds/frontend && npx vitest run <path>`. Tip: `cd frontend && npx tsc --noEmit -p tsconfig.json`.
- Repo kökünden: `node scripts/check-i18n-parity.mjs`, `node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`, `node scripts/check-contract-drift.mjs`.
- Boru hattı kullanırken **`set -o pipefail`** — yoksa `$?` `tail`'in kodudur.
- Kullanıcıya görünen her yeni metin **beş dile** (`tr`, `en`, `ru`, `ar`, `uz`) **gerçek çeviriyle** eklenir. `en` referans yereldir; İngilizce değere Türkçe yazmak parity'yi geçirir ama beş yerelin hepsi Türkçe render eder.
- Git commit mesajlarına **hiçbir AI/Claude izi eklenmez** (trailer yok, "Generated with" yok).

---

## File Structure

**Yeni — backend**

| Dosya | Sorumluluk |
|---|---|
| `backend/src/modules/print3d/print3d.const.ts` | SKU'lar, fiyat sabitleri, durum listeleri, ortak adı/URL varsayılanı. Hiçbir şey import etmez. |
| `backend/src/modules/print3d/print3d.service.ts` | `getOffer()`, kiracı iş okumaları, superadmin kuyruğu, durum geçiş makinesi, `sanitizePartnerUrl`. |
| `backend/src/modules/print3d/print3d.controller.ts` | Kiracı yüzeyi: `GET /v1/print3d/offer`, `/jobs`, `/jobs/:id`. |
| `backend/src/modules/print3d/superadmin-print3d.controller.ts` | `GET/PATCH /v1/superadmin/print3d/jobs…` (SuperAdminGuard). |
| `backend/src/modules/print3d/dto/print3d-ops.dto.ts` | `UpdatePrint3dJobStatusDto`, `UpdatePrint3dJobItemDto`. |
| `backend/src/modules/print3d/print3d.module.ts` | `imports: [PrismaModule]`, `exports: [Print3dService]`. |
| `backend/prisma/migrations/20260820170000_print3d_service/migration.sql` | İki tablo + iki katalog SKU'su + iki envanter satırı. |
| `backend/prisma/migrations/20260820170000_print3d_service/down.sql` | Fail-fast guard'lı, dar kapsamlı, idempotent geri alım. |
| `backend/src/modules/print3d/print3d.service.spec.ts` | Teklif + durum geçişleri + kiracı çiti. |
| `backend/src/modules/print3d/print3d-catalog-migration.spec.ts` | Migration ↔ sabit ↔ tohum sürüklenme tripwire'ı. |
| `backend/src/modules/checkout/quote-print3d.spec.ts` | Para: adet türetme, çift satır, çapraz kiracı, kargo ₺0. |
| `backend/src/modules/checkout/checkout-print3d-provision.spec.ts` | Provizyon: tek iş, N kalem, snapshot dondurma, outbox. |
| `backend/src/modules/catalog/dto/hardware-sku-regex.spec.ts` | Genişletilmiş SKU regex'i daralma yapmıyor. |
| `backend/test/print3d.e2e-spec.ts` | Gerçek Postgres: fiyat, çapraz kiracı, provizyon, SET NULL, kiracı çiti. |

**Yeni — frontend**

| Dosya | Sorumluluk |
|---|---|
| `frontend/public/products/_fallback-service.svg` | `landing/public/products/_fallback-service.svg` kopyası — SPA hizmet kartı görselinin 404'ünü kapatır. |
| `frontend/src/features/print3d/print3dSkus.ts` | Saf: `isPrint3dSku`, SKU sabitleri, `computePrint3dTotalCents`. |
| `frontend/src/features/print3d/partnerBadge.ts` | Saf: `safePartnerUrl`. |
| `frontend/src/features/print3d/PartnerBadge.tsx` | "Üretim ortağı: Figurunica" — link ya da düz metin, **asla boş**. |
| `frontend/src/features/print3d/print3dApi.ts` | `useGetPrint3dOffer`, `useListPrint3dJobs`, `useGetPrint3dJob`. |
| `frontend/src/features/print3d/Print3dStoreCard.tsx` | Mağazadaki tek 3D baskı kartı. |
| `frontend/src/features/print3d/Print3dProductPicker.tsx` | Sihirbaz adım 1 — menü ürünü çoklu seçimi + canlı fiyat. |
| `frontend/src/features/print3d/Print3dShippingStep.tsx` | Sihirbaz adım 2 — adres + üretim notu. |
| `frontend/src/features/print3d/Print3dSummary.tsx` | Sihirbaz adım 3 — satır dökümü + onam + Öde. |
| `frontend/src/features/print3d/Print3dWizardPage.tsx` | `/admin/store/print3d` — üç adımı birleştirir, intent'i gönderir. |
| `frontend/src/features/superadmin/api/superadminPrint3dApi.ts` | Superadmin kuyruğu + kargo kancaları. |
| `frontend/src/pages/superadmin/Print3dProductionPage.tsx` | `/superadmin/print3d` üretim paneli + CSV manifesto. |

**Değişen**

| Dosya | Değişiklik |
|---|---|
| `backend/prisma/schema.prisma` | `Print3dJob` + `Print3dJobItem`; `HardwareOrder.print3dJob`; `Product.print3dJobItems` |
| `backend/prisma/seeds/seed-marketplace.ts` | `SERVICES` **export** edilir + iki print3d girdisi |
| `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` | SKU regex alt çizgiyi kabul eder |
| `backend/src/modules/catalog/dto/hardware-quote-request.dto.ts` | Aynı regex |
| `backend/src/modules/checkout/checkout.types.ts` | `CartItemService.productIds`, `Print3dLineSnapshot`, `PricedLineMeta.print3d*` |
| `backend/src/modules/checkout/dto/cart.dto.ts` | `CartItemDto.productIds` (whitelist kurtarma) |
| `backend/src/modules/checkout/quote.service.ts` | `resolvePrint3dSelection` + sunucu-otoriter adet + eşleşme kapısı |
| `backend/src/modules/checkout/checkout.service.ts` | `Print3dJob` provizyon dalı + `print3d.job.created.v1` |
| `backend/src/modules/checkout/checkout-notifications.service.ts` | Sipariş e-postasına sentetik print3d kalemi |
| `backend/src/modules/checkout/hardware-orders.service.ts` | `listMine`/`getMine` `print3dJob` include eder |
| `backend/src/modules/checkout/checkout.module.ts`, `backend/src/app.module.ts` | `Print3dModule` kaydı |
| `backend/src/modules/outbox/event-types.ts` | `Print3dJobCreated` |
| `backend/src/common/helpers/env-validation.ts`, `backend/.env.example` | Opsiyonel `PRINT3D_PARTNER_URL` |
| `frontend/src/features/hardware-store/storeApi.ts` | `acceptedDocumentIds` **zorunlu**; `CartItem.productIds` |
| `frontend/src/features/hardware-store/StorePage.tsx` | Onam + print3d kartı + bölüm kapısı + derin bağlantı |
| `frontend/src/features/hardware-store/ShippingAddressForm.tsx` | Yeni `disabled` prop'u (dış kapı) |
| `frontend/src/features/hardware-store/ProductDetailPage.tsx` | Ham print3d SKU'su sihirbaza yönlendirilir |
| `frontend/src/features/hardware-store/HardwareOrderDetailPage.tsx`, `HardwareOrdersListPage.tsx`, `HardwareCheckoutResult.tsx` | Print3d siparişi dalı |
| `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx` | Kategori `<select>`'ine `service` |
| `frontend/src/features/superadmin/components/SuperAdminSidebar.tsx`, `frontend/src/App.tsx` | Nav girdisi + iki rota |
| `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/{hardware,superadmin}.json` | `print3d.*` blokları |
| `docs/SISTEM_TANITIMI.md`, `docs/PAZARLAMACI_REHBERI.md`, `help/pages/{tr,en}/marketplace/products.mdx` | Satılabilir kalem listelerine yeni satır |

---

## Görev 1: `acceptedDocumentIds` ön koşulu — donanım mağazası ödemesi bugün 400 alıyor

Bu **ilk** görevdir: sihirbaz aynı `useCreateCheckoutIntent` kancasını kullanacak, o yüzden bu düzeltme olmadan 3D baskı hiç satılamaz. `CreateCheckoutIntentDto.acceptedDocumentIds` backend'de **zorunlu** (`@IsArray` + `@ArrayMinSize(3)` + `@ArrayMaxSize(3)` + `@IsUUID`, `@IsOptional` yok) ama `frontend/src/features/hardware-store` dizininde bu alan **hiç geçmiyor** → `ValidationPipe` 400 veriyor.

**Files:**
- Modify: `frontend/src/features/hardware-store/storeApi.ts` (`CartItem` arayüzü ~78-90; `useCreateCheckoutIntent` ~285-304)
- Modify: `frontend/src/features/hardware-store/ShippingAddressForm.tsx` (`Props` ~97-102, imza ~127-133, submit düğmesi ~420-428)
- Modify: `frontend/src/features/hardware-store/StorePage.tsx` (importlar ~1-27, `startCheckout` ~195-224, ödeme modalı ~499-518)
- Test: `frontend/src/features/hardware-store/storeApi.test.tsx` (mevcut `useCreateCheckoutIntent POSTs the intent endpoint`, ~216-227)
- Test: `frontend/src/features/hardware-store/StorePage.test.tsx` (mevcut dosyaya ekleme)

**Interfaces:**
- Consumes: yok (ilk görev)
- Produces:
  - `CartItem.productIds?: string[]` (frontend `storeApi.ts`)
  - `useCreateCheckoutIntent()` argümanı: `{ cart: { items: CartItem[]; shippingAddress?: ShippingAddress; billingAddress?: ShippingAddress }; buyer: CheckoutBuyer; acceptedDocumentIds: string[]; returnUrl?: string; branchId?: string }` → `Promise<CheckoutIntentResponse>` — `acceptedDocumentIds` **zorunlu**
  - `ShippingAddressForm` prop'u `disabled?: boolean`

- [ ] **Adım 1: Mevcut testi kırmızıya çevir — kanca artık onam id'si istiyor**

`frontend/src/features/hardware-store/storeApi.test.tsx` içindeki `useCreateCheckoutIntent POSTs the intent endpoint` testini bununla değiştir:

```tsx
  it('useCreateCheckoutIntent POSTs the intent endpoint WITH the three consent ids', async () => {
    // Bu alan backend'de ZORUNLU (create-intent.dto.ts). Kanca göndermediği
    // sürece donanım/hizmet mağazasından PayTR ödemesi 400 ile ölür.
    h.post.mockResolvedValue({ data: { paymentRef: 'p' } });
    const { result } = renderHook(() => useCreateCheckoutIntent(), { wrapper });
    await result.current.mutateAsync({
      cart: { items: [] },
      buyer: { email: 'a@b.c', name: 'A', phone: '1' },
      acceptedDocumentIds: ['doc-kvkk', 'doc-sales', 'doc-refund'],
    });
    expect(h.post).toHaveBeenCalledWith(
      '/v1/checkout/intent',
      expect.objectContaining({
        cart: { items: [] },
        acceptedDocumentIds: ['doc-kvkk', 'doc-sales', 'doc-refund'],
      }),
    );
  });
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store/storeApi.test.tsx -t "consent ids"`
Expected: FAIL — `expected "spy" to be called with arguments: [ '/v1/checkout/intent', ObjectContaining{…} ]`; alınan gövdede `acceptedDocumentIds` yok (kanca argümanı gövdeye `args`'ı olduğu gibi POST ediyor, ama tip henüz alanı tanımıyor ve `tsc` de şikâyet edecek).

- [ ] **Adım 3: `CartItem`'a `productIds` ekle**

`frontend/src/features/hardware-store/storeApi.ts`, `CartItem` arayüzünün sonuna (`notes` alanından sonra):

```ts
  // v3.7.0 — 3D baskı figür hizmeti: alıcının KENDİ menüsünden seçtiği ürün
  // id'leri. SADECE `print3d_item` hizmet satırında anlamlı. Satırın ADEDİ
  // sunucuda bu diziden TÜRETİLİR (QuoteService); buradaki `qty` yok sayılır.
  productIds?: string[];
```

- [ ] **Adım 4: `useCreateCheckoutIntent` argümanına zorunlu `acceptedDocumentIds` ekle**

`frontend/src/features/hardware-store/storeApi.ts`, `useCreateCheckoutIntent` içindeki `args` tipine, `buyer` alanından hemen sonra:

```ts
      /**
       * v3.7.0 — Mesafeli satış onamı. KVKK + Mesafeli Satış Sözleşmesi +
       * İade Politikası'nın O AN YÜRÜRLÜKTEKİ üç doküman id'si.
       *
       * ZORUNLU (opsiyonel değil): backend CreateCheckoutIntentDto bunu
       * @ArrayMinSize(3) ile şart koşuyor ve alan yokken ValidationPipe 400
       * veriyor — yani donanım mağazasından PayTR ödemesi bugüne kadar hiç
       * başlamadı. Zorunlu tutmak, derleyicinin her çağıranı yakalamasını
       * sağlar. `CheckoutConsent` + `useConsentComplete` üretir.
       */
      acceptedDocumentIds: string[];
```

- [ ] **Adım 5: Testi çalıştır ve yeşil gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store/storeApi.test.tsx`
Expected: PASS — tüm dosya yeşil.

- [ ] **Adım 6: `ShippingAddressForm`'a dış kapı prop'u ekle**

`frontend/src/features/hardware-store/ShippingAddressForm.tsx`, `interface Props` içine `submitting?: boolean;` satırının hemen ardına:

```ts
  /**
   * v3.7.0 — DIŞ kapı. `submitting`'den farkı: bu, "işlem sürüyor" değil
   * "henüz gönderilemez" demektir (ör. mesafeli satış onamı işaretlenmedi),
   * bu yüzden düğme etiketi "İşleniyor…"a dönmez.
   */
  disabled?: boolean;
```

Bileşen imzasına (`export default function ShippingAddressForm({ … }: Props)`) `disabled,` parametresini `submitting,` yanına ekle. Submit düğmesindeki `disabled={submitting}` ifadesini şununla değiştir:

```tsx
        disabled={submitting || disabled}
```

- [ ] **Adım 7: `StorePage` testine onam iddiasını yaz (kırmızı)**

`frontend/src/features/hardware-store/StorePage.test.tsx` — dosyanın diğer `vi.mock` çağrılarının yanına (ör. `./ShippingAddressForm` mock'unun hemen üstüne) ekle:

```tsx
// Onamın kendi spec'i var; burada üç yasal-belge sorgusunu her senaryoya
// sürüklerdi. CatalogStore.test.tsx'teki yerleşik desen: `useConsentComplete`
// bir bayrakla değiştirilir. Fark: buradaki stub GERÇEKTEN onChange çağırır,
// çünkü testin iddiası "hangi id'ler gönderildi" — `default: () => null`
// olsaydı acceptedDocs sonsuza dek [] kalır ve iddia hiç yeşile dönmezdi.
let consentComplete = true;
vi.mock('../legal/CheckoutConsent', () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button
      data-testid="tick-consents"
      onClick={() => onChange(['doc-kvkk', 'doc-sales', 'doc-refund'])}
    >
      consents
    </button>
  ),
  useConsentComplete: () => consentComplete,
}));
```

`beforeEach` içine `consentComplete = true;` satırını ekle. Sonra dosyanın sonundaki `describe('StorePage', …)` bloğuna iki test ekle:

```tsx
  it('sends acceptedDocumentIds with the checkout intent', async () => {
    products.data = [makeProduct()];
    intent.mutateAsync.mockResolvedValue({ paymentRef: 'CK-1', paymentLink: '' });
    renderStore();
    fireEvent.click(screen.getAllByText(enHardware.store.card.addToCart)[0]);
    fireEvent.click(screen.getByText(enHardware.store.checkout));
    fireEvent.click(await screen.findByTestId('tick-consents'));
    fireEvent.click(screen.getByTestId('ship-submit'));
    await waitFor(() => expect(intent.mutateAsync).toHaveBeenCalled());
    expect(intent.mutateAsync.mock.calls[0][0].acceptedDocumentIds).toEqual([
      'doc-kvkk',
      'doc-sales',
      'doc-refund',
    ]);
  });

  it('does not start a checkout while the three consents are unticked', async () => {
    consentComplete = false;
    products.data = [makeProduct()];
    renderStore();
    fireEvent.click(screen.getAllByText(enHardware.store.card.addToCart)[0]);
    fireEvent.click(screen.getByText(enHardware.store.checkout));
    fireEvent.click(await screen.findByTestId('ship-submit'));
    expect(intent.mutateAsync).not.toHaveBeenCalled();
  });
```

> `enHardware.store.card.addToCart` / `enHardware.store.checkout` anahtarları bu dosyada zaten kullanılıyor; mevcut testlerdeki yazımı birebir kopyala (dosyanın üstünde `enHardware` import edilmiş durumda). Mock'lanan `ShippingAddressForm` `onSubmit`'i koşulsuz çağırdığı için `disabled` prop'u testte düğmeyi kilitlemez — kapının **`startCheckout` içinde** de olması bu yüzden şart, ve ikinci test tam olarak onu kanıtlar.

- [ ] **Adım 8: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store/StorePage.test.tsx -t "acceptedDocumentIds"`
Expected: FAIL — `expected undefined to deeply equal [ 'doc-kvkk', 'doc-sales', 'doc-refund' ]`

- [ ] **Adım 9: `StorePage`'e onamı bağla**

`frontend/src/features/hardware-store/StorePage.tsx` — import bloğuna ekle:

```tsx
import CheckoutConsent, { useConsentComplete } from '../legal/CheckoutConsent';
```

Bileşenin durum tanımlarının yanına (`const [checkoutOpen, setCheckoutOpen] = useState(false);` civarı):

```tsx
  // v3.7.0 — mesafeli satış onamı. Backend CreateCheckoutIntentDto bu üç
  // id'yi zorunlu kılıyor; alan gönderilmediği için donanım mağazasından
  // PayTR ödemesi bugüne kadar 400 alıyordu.
  const [acceptedDocs, setAcceptedDocs] = useState<string[]>([]);
  const consentGiven = useConsentComplete(acceptedDocs);
```

`startCheckout` fonksiyonunun ilk satırını değiştir ve `mutateAsync` gövdesine alanı ekle:

```tsx
  async function startCheckout(result: { address: ShippingAddress; branchId?: string }) {
    // Onam kapısı BURADA da duruyor: ShippingAddressForm'un disabled prop'u
    // görsel kapı, bu ise para kapısı. İkisi ayrı olmalı — form ileride başka
    // bir çağırandan da submit edilebilir.
    if (lines.length === 0 || !user || !consentGiven) return;
```

`intent.mutateAsync({ … })` çağrısına, `branchId,` satırının hemen ardına:

```tsx
      // v3.7.0 — yasal onam, PayTR jetonundan ÖNCE doğrulanıp kaydediliyor.
      acceptedDocumentIds: acceptedDocs,
```

Ödeme modalındaki `<ShippingAddressForm … />` bloğunun **üstüne** onam bileşenini koy ve forma dış kapıyı geçir:

```tsx
        <div className="mb-4 border-b pb-4">
          <h3 className="mb-2 text-xs font-semibold text-gray-900">
            {t('store.consentTitle')}
          </h3>
          <CheckoutConsent accepted={acceptedDocs} onChange={setAcceptedDocs} />
        </div>
        <ShippingAddressForm
          initial={shippingAddress ?? undefined}
          branches={branches}
          onSubmit={startCheckout}
          submitting={intent.isPending}
          disabled={!consentGiven}
          submitLabel={t('store.payWithPaytr')}
        />
```

- [ ] **Adım 10: `store.consentTitle` anahtarını beş yerele ekle**

`frontend/src/i18n/locales/<yerel>/hardware.json` dosyalarında `store` nesnesine, `payWithPaytr` anahtarının yanına ekle:

| Yerel | Değer |
|---|---|
| `tr` | `"consentTitle": "Yasal onaylar"` |
| `en` | `"consentTitle": "Legal consents"` |
| `ru` | `"consentTitle": "Юридические согласия"` |
| `ar` | `"consentTitle": "الموافقات القانونية"` |
| `uz` | `"consentTitle": "Huquqiy roziliklar"` |

- [ ] **Adım 11: Testleri ve kapıları çalıştır**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
node scripts/check-i18n-parity.mjs
```
Expected: vitest PASS; `tsc` çıktısız (0); parity `OK`.

- [ ] **Adım 12: Commit**

```bash
git add frontend/src/features/hardware-store/storeApi.ts frontend/src/features/hardware-store/storeApi.test.tsx frontend/src/features/hardware-store/ShippingAddressForm.tsx frontend/src/features/hardware-store/StorePage.tsx frontend/src/features/hardware-store/StorePage.test.tsx frontend/src/i18n/locales
git commit -m "fix(store): donanım mağazası ödemesi onam id'lerini gönderiyor

CreateCheckoutIntentDto.acceptedDocumentIds zorunlu (@ArrayMinSize(3),
@IsOptional yok) ama hardware-store dizininde bu alan hiç geçmiyordu ->
ValidationPipe her denemede 400 veriyordu: mağazadan PayTR ödemesi hiç
başlamamış.

Kanca argümanında alan ZORUNLU yapıldı, böylece derleyici her çağıranı
yakalıyor. StorePage ödeme modalına CheckoutConsent eklendi; kapı hem
formda (disabled) hem startCheckout içinde (para kapısı) duruyor.

CartItem.productIds alanı da burada açılıyor: 3D baskı sihirbazı aynı
kancayı kullanacak."
```

---

## Görev 2: Sabitler, Prisma modelleri, tersinir migration ve katalog SKU'ları

DDL ile katalog satırları **birlikte** inmelidir: SKU'suz tablo ölüdür, tablosuz SKU provizyonu patlatır. Tek migration dizini.

**Files:**
- Create: `backend/src/modules/print3d/print3d.const.ts`
- Create: `backend/prisma/migrations/20260820170000_print3d_service/migration.sql`
- Create: `backend/prisma/migrations/20260820170000_print3d_service/down.sql`
- Modify: `backend/prisma/schema.prisma` (`Product` ~415-501; `HardwareOrder` ~5421-5452; `InstallationRequest` bloğu ~5560-5580 ile `Warranty` ~5582 arası)
- Modify: `backend/prisma/seeds/seed-marketplace.ts` (`SERVICES` ~404 — export + iki girdi)
- Test: `backend/src/modules/print3d/print3d-catalog-migration.spec.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `backend/src/modules/print3d/print3d.const.ts`: `PRINT3D_SERVICE_TYPE`, `PRINT3D_PARTNER`, `PRINT3D_PARTNER_LABEL`, `PRINT3D_PARTNER_URL_DEFAULT`, `PRINT3D_BASE_SKU`, `PRINT3D_ITEM_SKU`, `PRINT3D_BASE_PRICE_CENTS`, `PRINT3D_ITEM_PRICE_CENTS`, `PRINT3D_MIN_ITEMS`, `PRINT3D_MAX_ITEMS`, `PRINT3D_JOB_STATUSES`, `PRINT3D_ITEM_STATUSES`, `type Print3dJobStatus`, `type Print3dItemStatus` (hepsi `export const` / `export type`)
  - Prisma modelleri: `Print3dJob` (`@@map("print3d_jobs")`), `Print3dJobItem` (`@@map("print3d_job_items")`) — Prisma Client'ta `prisma.print3dJob`, `prisma.print3dJobItem`
  - `backend/prisma/seeds/seed-marketplace.ts`: `export const SERVICES`

- [ ] **Adım 1: Sabitler dosyasını yaz**

`backend/src/modules/print3d/print3d.const.ts`:

```ts
/**
 * 3D baskı figür hizmetinin tek doğruluk kaynağı — SKU'lar, fiyat sabitleri,
 * durum sözlükleri, üretim ortağı kimliği.
 *
 * Bu dosya HİÇBİR ŞEY IMPORT ETMEZ (entitlement-keys.const.ts deseni): hem
 * quote/checkout hem migration sürüklenme testi hem de tohum aynı değerleri
 * okur, ve bir import döngüsü bu üçlünün herhangi birini kırar.
 *
 * FİYAT SABİTLERİ YALNIZCA tohum/migration kaynağı ve sürüklenme testi
 * içindir. QuoteService fiyatı HER ZAMAN hardware_products satırından okur —
 * yoksa her fiyat değişikliği bir deploy isterdi.
 */

/** hardware_products.serviceMeta.serviceType değeri. */
export const PRINT3D_SERVICE_TYPE = "print3d";

/** Print3dJob.partner kolonunun bugünkü tek değeri. */
export const PRINT3D_PARTNER = "figurunica";

/** Kullanıcıya gösterilen ortak adı. Çeviri edilmez — bu bir marka. */
export const PRINT3D_PARTNER_LABEL = "Figurunica";

/**
 * Varsayılan ortak sitesi. Aynı adlı OPSİYONEL backend env değişkeni
 * (PRINT3D_PARTNER_URL) bunu ezebilir: ticari taraf değişirse yeniden
 * derleme gerekmesin. VITE_ değişkeni bundle'a gömülür ve platform-üstü bir
 * ayar tablosu yok, o yüzden değer backend'de durur.
 */
export const PRINT3D_PARTNER_URL_DEFAULT = "https://figurunica.com";

/** Taban hizmet bedeli satırı — sepette her zaman qty 1. */
export const PRINT3D_BASE_SKU = "print3d_base";
/** Ürün başına satır — adedi SUNUCUDA seçilen ürün sayısından türer. */
export const PRINT3D_ITEM_SKU = "print3d_item";

/** ₺1.500, KDV dahil (katalogdaki tüm fiyatlar brüttür). */
export const PRINT3D_BASE_PRICE_CENTS = 150_000;
/** ₺50, KDV dahil. */
export const PRINT3D_ITEM_PRICE_CENTS = 5_000;

export const PRINT3D_MIN_ITEMS = 1;
export const PRINT3D_MAX_ITEMS = 50;

/**
 * İş durumu YALNIZCA üretimi izler. Kargo/teslim Shipment'ta ve
 * HardwareOrder.status'ta yaşar; aynı olguyu iki yerde tutmak kaçınılmaz
 * olarak ayrışır.
 *   queued -> in_production -> produced
 *   queued|in_production -> cancelled   (terminal)
 */
export const PRINT3D_JOB_STATUSES = [
  "queued",
  "in_production",
  "produced",
  "cancelled",
] as const;

export const PRINT3D_ITEM_STATUSES = ["pending", "printed", "rejected"] as const;

export type Print3dJobStatus = (typeof PRINT3D_JOB_STATUSES)[number];
export type Print3dItemStatus = (typeof PRINT3D_ITEM_STATUSES)[number];
```

- [ ] **Adım 2: Prisma modellerini ekle**

`backend/prisma/schema.prisma` — `InstallationRequest` bloğunun kapanış `}`'ından sonra, `model Warranty {` satırından önce:

```prisma
/// 3D baskı figür üretim işi (üretim ortağı: Figurunica).
///
/// Bir Print3dJob, ödenmiş bir HardwareOrder'ın SONUCUDUR — başka yaratım
/// yolu yoktur (kiracı tarafında POST endpoint'i yok; InstallationRequest'ten
/// farkı budur). Bu yüzden hwOrderId NOT NULL + Cascade: sipariş yoksa iş de
/// yoktur.
///
/// Durum YALNIZCA üretimi izler. Kargo/teslim Shipment'ta ve
/// HardwareOrder.status'ta yaşar.
///   queued -> in_production -> produced
///   queued|in_production -> cancelled   (terminal)
model Print3dJob {
  id             String        @id @default(uuid())
  tenantId       String
  branchId       String?
  hwOrderId      String        @unique
  hwOrder        HardwareOrder @relation(fields: [hwOrderId], references: [id], onDelete: Cascade)
  status         String        @default("queued")
  /// Üretim ortağı kimliği. Bugün her zaman 'figurunica'; ikinci ortak
  /// geldiğinde bu kolon kuyruğu bölmeye yeter.
  partner        String        @default("figurunica")
  /// Satın alma anındaki fiyat anlık görüntüsü — SKU sonradan yeniden
  /// fiyatlansa bile bu işin ne kadara satıldığı değişmez.
  basePriceCents Int
  perItemCents   Int
  itemCount      Int
  totalCents     Int
  currency       String        @default("TRY")
  /// Alıcının sihirbazda yazdığı serbest not (üretim talimatı).
  note           String?       @db.Text
  /// Figurunica'nın kendi iş numarası; operatör panelden girer.
  partnerRef     String?
  /// Operatörün kuyruk notu (üretim/iptal gerekçesi).
  opsNote        String?       @db.Text
  producedAt     DateTime?
  cancelledAt    DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  items Print3dJobItem[]

  @@index([tenantId, status])
  @@index([status, createdAt])
  @@map("print3d_jobs")
}

/// İşin bir kalemi = seçilmiş BİR menü ürünü = BİR figür.
///
/// productId NULLABLE + SetNull: menü ürünleri GERÇEKTEN siliniyor
/// (menu/services/products.service.ts). Restrict olsaydı kiracı ürünü hiç
/// silemezdi; Cascade olsaydı ödenmiş siparişin kalemi yok olurdu. Snapshot
/// alanları bağ koptuğunda da manifestoyu ayakta tutar.
model Print3dJobItem {
  id              String     @id @default(uuid())
  jobId           String
  job             Print3dJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  productId       String?
  product         Product?   @relation(fields: [productId], references: [id], onDelete: SetNull)
  /// Sipariş anındaki ad — sonraki menü düzenlemesi siparişi yeniden yazamaz.
  productName     String
  /// Sipariş anındaki birincil fotoğraf URL'i. NULL ise üretim yalnızca ADLA
  /// çalışır (ürün fotoğrafsızdı) — bu bilinçli bir üründür, hata değil.
  productImageUrl String?
  /// Ürün zaten bir GLB taşıyorsa yazıcıya ek referans olarak iletilir.
  /// Meshy/AI hattı BU AKIŞTA ÇALIŞTIRILMAZ; yalnızca mevcut değer kopyalanır.
  model3dUrl      String?
  position        Int
  status          String     @default("pending")
  opsNote         String?    @db.Text
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@unique([jobId, productId])
  @@index([jobId, position])
  @@map("print3d_job_items")
}
```

`model HardwareOrder` içinde, `installations InstallationRequest[]` satırının hemen altına (ilk `@@index` satırından önce):

```prisma
  print3dJob    Print3dJob?
```

`model Product` içinde, `collections ProductCollection[]` satırının hemen altına:

```prisma
  print3dJobItems   Print3dJobItem[] // 3D baskı siparişlerinde bu ürünü işaret eden kalemler
```

- [ ] **Adım 3: Şemayı doğrula ve istemciyi üret**

Run: `cd /home/tarik/Projects/kds/backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` ve `Generated Prisma Client`.

- [ ] **Adım 4: `migration.sql` yaz**

`backend/prisma/migrations/20260820170000_print3d_service/migration.sql`:

```sql
-- @doctor:idempotent verified=CREATE TABLE/INDEX IF NOT EXISTS; FK'ler DO/EXCEPTION duplicate_object ile sarılı; iki hardware_products upsert'i ON CONFLICT (sku) DO UPDATE (status HARİÇ); hardware_inventory INSERT'ü ON CONFLICT ("productId") DO NOTHING. Yeniden çalıştırma aynı duruma yakınsar. Hiçbir tenant/ownership/order satırına dokunmaz.
--
-- 20260820170000_print3d_service
-- v3.7.0 — 3D baskı figür hizmeti (üretim ortağı: Figurunica).
--
-- İki parça:
--   1. print3d_jobs + print3d_job_items tabloları (üretim kaydı).
--   2. hardware_products'a iki hizmet SKU'su (satılabilir katalog satırı).
--
-- Neden marketplace_addons DEĞİL: bir oneTime add-on kiracı başına ömür boyu
-- BİR KEZ satılabilir — süpürücü currentPeriodEnd IS NULL satırını hiç
-- kapatmaz (tenant-addon-sweeper.service.ts) ve ikinci alım
-- ADDON_ALREADY_OWNED ile reddedilir (addon-purchasability.rules.ts).
-- Bu hizmet tekrarlanabilir olmak zorunda.
--
-- TABLO ADLARI snake_case: CI `prisma db push` kullanır ve migration SQL'ini
-- HİÇ çalıştırmaz, bu yüzden PascalCase bir ad yalnızca production deploy'da
-- 42P01 verir.

CREATE TABLE IF NOT EXISTS "print3d_jobs" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "branchId"       TEXT,
    "hwOrderId"      TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'queued',
    "partner"        TEXT NOT NULL DEFAULT 'figurunica',
    "basePriceCents" INTEGER NOT NULL,
    "perItemCents"   INTEGER NOT NULL,
    "itemCount"      INTEGER NOT NULL,
    "totalCents"     INTEGER NOT NULL,
    "currency"       TEXT NOT NULL DEFAULT 'TRY',
    "note"           TEXT,
    "partnerRef"     TEXT,
    "opsNote"        TEXT,
    "producedAt"     TIMESTAMP(3),
    "cancelledAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print3d_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "print3d_job_items" (
    "id"              TEXT NOT NULL,
    "jobId"           TEXT NOT NULL,
    "productId"       TEXT,
    "productName"     TEXT NOT NULL,
    "productImageUrl" TEXT,
    "model3dUrl"      TEXT,
    "position"        INTEGER NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "opsNote"         TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print3d_job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "print3d_jobs_hwOrderId_key"
    ON "print3d_jobs"("hwOrderId");
CREATE INDEX IF NOT EXISTS "print3d_jobs_tenantId_status_idx"
    ON "print3d_jobs"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "print3d_jobs_status_createdAt_idx"
    ON "print3d_jobs"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "print3d_job_items_jobId_productId_key"
    ON "print3d_job_items"("jobId", "productId");
CREATE INDEX IF NOT EXISTS "print3d_job_items_jobId_position_idx"
    ON "print3d_job_items"("jobId", "position");

-- FK'ler: ADD CONSTRAINT IF NOT EXISTS yok, bu yüzden duplicate_object yutulur
-- (20260601000000_v3_branch_scope_strict deseni).
DO $$ BEGIN
  ALTER TABLE "print3d_jobs"
    ADD CONSTRAINT "print3d_jobs_hwOrderId_fkey"
    FOREIGN KEY ("hwOrderId") REFERENCES "hardware_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "print3d_job_items"
    ADD CONSTRAINT "print3d_job_items_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "print3d_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Menü ürünleri GERÇEKTEN siliniyor (products.service.ts). SET NULL:
-- Restrict kiracının ürünü silmesini sonsuza dek engellerdi, Cascade ise
-- ödenmiş siparişin kalemini yok ederdi. Snapshot kolonları manifestoyu
-- bağ koptuktan sonra da ayakta tutar.
DO $$ BEGIN
  ALTER TABLE "print3d_job_items"
    ADD CONSTRAINT "print3d_job_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Katalog satırları. ON CONFLICT DO UPDATE'te "status" YOKTUR: bir operatör
-- SKU'yu bilinçli olarak 'archived' yaptıysa migration'ın yeniden çalışması
-- onu satışa geri açmamalı (tohumdaki status zorlamasını KOPYALAMA).
--
-- complianceDocs TAM OLARAK '{"invoiceIssued":true}' — SEED_DEFAULT_COMPLIANCE
-- ile birebir. Tohumun ortak upsert'ü bu alanı `update: sharedData` içinde her
-- koşuda üstüne yazar, bu yüzden başka bir değer yazmak migre-edilmiş ve
-- tohumlanmış veritabanlarını kalıcı olarak ayrıştırır (ve sürüklenme testini
-- kırar). distributorName gibi ek anahtar EKLEME.
INSERT INTO "hardware_products" (
  "id","sku","category","name","description","priceCents","currency",
  "warrantyMonths","images","stockStatus","status","saleMode","serviceMeta",
  "complianceDocs","createdAt","updatedAt"
) VALUES (
  gen_random_uuid()::text, 'print3d_base', 'service',
  '3D baskı figür — hizmet bedeli',
  'Menünüzden seçtiğiniz ürünlerin 3D baskı figürleri. Kargo dahil. Üretim ortağı: Figurunica.',
  150000, 'TRY', 0, ARRAY['/products/_fallback-service.svg']::TEXT[],
  'in_stock', 'published', 'DIRECT_SALE',
  '{"serviceType":"print3d","partner":"figurunica","role":"base"}'::jsonb,
  '{"invoiceIssued":true}'::jsonb,
  NOW(), NOW()
), (
  gen_random_uuid()::text, 'print3d_item', 'service',
  '3D baskı figür — ürün başına',
  'Seçilen her menü ürünü için bir figür. Taban hizmet bedeliyle birlikte alınır.',
  5000, 'TRY', 0, ARRAY['/products/_fallback-service.svg']::TEXT[],
  'in_stock', 'published', 'DIRECT_SALE',
  '{"serviceType":"print3d","partner":"figurunica","role":"item"}'::jsonb,
  '{"invoiceIssued":true}'::jsonb,
  NOW(), NOW()
)
ON CONFLICT ("sku") DO UPDATE SET
  "category"       = EXCLUDED."category",
  "name"           = EXCLUDED."name",
  "description"    = EXCLUDED."description",
  "priceCents"     = EXCLUDED."priceCents",
  "currency"       = EXCLUDED."currency",
  "images"         = EXCLUDED."images",
  "saleMode"       = EXCLUDED."saleMode",
  "serviceMeta"    = EXCLUDED."serviceMeta",
  "complianceDocs" = EXCLUDED."complianceDocs",
  "updatedAt"      = NOW();

-- Tohum her katalog girdisi için bir envanter satırı açar; migre edilmiş bir
-- veritabanı tohumlanmış bir veritabanından farklı görünmesin. Hizmetler stok
-- tüketmez: available 0.
INSERT INTO "hardware_inventory" ("id","productId","available","allocated","shipped","serialsAvailable","updatedAt")
SELECT gen_random_uuid()::text, p."id", 0, 0, 0, ARRAY[]::TEXT[], NOW()
  FROM "hardware_products" p
 WHERE p."sku" IN ('print3d_base','print3d_item')
ON CONFLICT ("productId") DO NOTHING;
```

- [ ] **Adım 5: `down.sql` yaz**

`backend/prisma/migrations/20260820170000_print3d_service/down.sql`:

```sql
-- 20260820170000_print3d_service geri alımı.
--
-- İKİ DEĞİŞMEZ:
--   (1) ÖDENMİŞ ÜRETİM KAYDINA ASLA DOKUNMA. Down yalnızca up'ın eklediğini
--       kaldırır, operatör/çalışma-zamanı verisine dokunmaz. Bu yüzden
--       koşulsuz DROP TABLE YASAK: katalog DELETE'inin koruduğu ödenmiş
--       işleri — üstelik guard'ın KENDİ KANITINI — yok ederdi.
--   (2) İDEMPOTAN. İkinci koşu hata VERMEZ. Tablolar düştükten sonra
--       "NOT EXISTS (SELECT 1 FROM print3d_jobs)" ayrıştırma aşamasında
--       42P01 undefined_table verirdi; bu yüzden her print3d_jobs referansı
--       to_regclass ile korunur.

-- 0) FAIL-FAST: ödenmiş iş varsa geri alım BAŞLAMADAN, sessizce değil
--    GÜRÜLTÜYLE durur. RAISE EXCEPTION tüm down işlemini geri sarar (katalog
--    DELETE'i de dahil), yani veritabanı tutarlı kalır.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.print3d_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "print3d_jobs"' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'ABORT: print3d_jobs holds % paid job(s). Export and delete them before rolling back 20260820170000_print3d_service.', n;
    END IF;
  END IF;
END $$;

-- 1) Envanter satırları — YALNIZCA bu migration'ın up'ının açtığı iki satır.
--    ÜRÜN SİLİNMEDEN ÖNCE çalışmalı, çünkü kapsam sku üzerinden join'leniyor.
--    (Kapsamsız bir "orphan sweep" platform genelinde başka SKU'ların stok
--    sayaçlarını — allocated/shipped geçmişi dahil — silebilirdi.)
DELETE FROM "hardware_inventory" hi
 USING "hardware_products" hp
 WHERE hi."productId" = hp."id"
   AND hp."sku" IN ('print3d_base','print3d_item')
   AND hi."allocated" = 0
   AND hi."shipped" = 0;

-- 2) Katalog satırları. Guard: ödenmiş bir satın alımı ASLA öksüz bırakma.
--    Hizmet satırları hardware_order_items üretmiyor, bu yüzden asıl kanıt
--    print3d_jobs'tır — ikisine de bakılır. to_regclass sarmalayıcısı ikinci
--    koşuyu (tablo artık yok) hatasız kılar.
DELETE FROM "hardware_products" hp
 WHERE hp."sku" IN ('print3d_base','print3d_item')
   AND NOT EXISTS (
     SELECT 1 FROM "hardware_order_items" hoi WHERE hoi."productId" = hp."id"
   )
   AND (
     to_regclass('public.print3d_jobs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM "print3d_jobs")
   );

-- 3) Tabloları düşür. Buraya ulaşıldıysa 0. adım hiçbir ödenmiş iş bulmadı.
DROP TABLE IF EXISTS "print3d_job_items";
DROP TABLE IF EXISTS "print3d_jobs";
```

- [ ] **Adım 6: Tohuma iki print3d girdisi ekle ve `SERVICES`'i export et**

`backend/prisma/seeds/seed-marketplace.ts` — `const SERVICES = [` satırını `export const SERVICES = [` yap (sürüklenme testi ve SKU regex testi bu diziyi okuyacak). Dizinin **sonuna**, kapanış `];`'inden önce iki girdi ekle:

```ts
  // v3.7.0 — 3D baskı figür hizmeti (üretim ortağı: Figurunica).
  //
  // İKİ SKU, çünkü QuoteService uçtan uca `unitCents × qty` çalışıyor ve
  // PayTR sepeti amountCents'e BİREBİR toplanmak zorunda: "150.000 + 5.000×N"
  // tek satırda ifade edilemez.
  //
  // status / saleMode BURADA YAZILMAZ — ortak upsert (aşağıda) ikisini de
  // atıyor. complianceDocs de yazılmaz: SEED_DEFAULT_COMPLIANCE devreye girer
  // ve migration ile birebir aynı değeri ({"invoiceIssued":true}) üretir.
  {
    sku: "print3d_base",
    category: "service",
    name: "3D baskı figür — hizmet bedeli",
    description:
      "Menünüzden seçtiğiniz ürünlerin 3D baskı figürleri. Kargo dahil. Üretim ortağı: Figurunica.",
    priceCents: 150_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "print3d",
      partner: "figurunica",
      role: "base",
    },
  },
  {
    sku: "print3d_item",
    category: "service",
    name: "3D baskı figür — ürün başına",
    description:
      "Seçilen her menü ürünü için bir figür. Taban hizmet bedeliyle birlikte alınır.",
    priceCents: 5_000,
    images: ["/products/_fallback-service.svg"],
    serviceMeta: {
      serviceType: "print3d",
      partner: "figurunica",
      role: "item",
    },
  },
```

- [ ] **Adım 7: Sürüklenme tripwire testini yaz (kırmızı)**

`backend/src/modules/print3d/print3d-catalog-migration.spec.ts`:

```ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  PRINT3D_BASE_PRICE_CENTS,
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_PRICE_CENTS,
  PRINT3D_ITEM_SKU,
} from "./print3d.const";
import {
  SEED_DEFAULT_COMPLIANCE,
  SERVICES,
} from "../../../prisma/seeds/seed-marketplace";

/**
 * Donanım rayının katalog sürüklenme tripwire'ı.
 *
 * Add-on rayında bunun karşılığı (alacarte-catalog-migration.spec.ts) yıllardır
 * var; donanım rayında HİÇ YOKTU. Prodüksiyon migre edilir, tohumlanmaz — yani
 * tohumdaki bir fiyat düzeltmesi prodüksiyonu ESKİ tutarla faturalandırmaya
 * devam eder ve bu, müşteri yanlış tutarı ödeyene kadar görünmez.
 *
 * Uygulanmış migration'ı DÜZENLEME. Fiyat değişirse yeni bir takip
 * migration'ı yaz; bu dosyaya bir FOLLOW_UP_SQL listesi eklemek gerekirse
 * dosyaları İSİMLE ara (`FOLLOW_UP_SQL.find((p) => p.includes("…"))`), ASLA
 * indeksle — araya bir giriş sokulunca iddialar sessizce başka dosyayı
 * göstermesin.
 */
const MIGRATION_DIR = join(
  __dirname,
  "../../../prisma/migrations/20260820170000_print3d_service",
);
const MIGRATION_SQL = join(MIGRATION_DIR, "migration.sql");
const DOWN_SQL = join(MIGRATION_DIR, "down.sql");

/** `--` yorum satırlarını at: iddialar YALNIZCA çalışan SQL'e bakmalı. */
function executableSql(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

function priceForSku(sql: string, sku: string): number {
  // VALUES bloğundaki satır: gen_random_uuid()::text, 'sku', 'service', …,
  // <priceCents>, 'TRY',
  const row = sql.slice(sql.indexOf(`'${sku}'`));
  const m = row.match(/,\s*(\d+),\s*'TRY'/);
  if (!m) throw new Error(`price not found for ${sku}`);
  return Number(m[1]);
}

describe("print3d catalog migration (drift tripwire)", () => {
  const up = readFileSync(MIGRATION_SQL, "utf8");
  const down = readFileSync(DOWN_SQL, "utf8");
  const upExec = executableSql(up);
  const downExec = executableSql(down);

  it("the migration directory ships both migration.sql and down.sql", () => {
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    expect(existsSync(DOWN_SQL)).toBe(true);
  });

  it("carries the @doctor:idempotent header", () => {
    expect(up.split("\n")[0]).toContain("@doctor:idempotent");
  });

  it("the committed migration prices print3d_base at PRINT3D_BASE_PRICE_CENTS", () => {
    expect(priceForSku(upExec, PRINT3D_BASE_SKU)).toBe(PRINT3D_BASE_PRICE_CENTS);
  });

  it("the committed migration prices print3d_item at PRINT3D_ITEM_PRICE_CENTS", () => {
    expect(priceForSku(upExec, PRINT3D_ITEM_SKU)).toBe(PRINT3D_ITEM_PRICE_CENTS);
  });

  it("writes exactly SEED_DEFAULT_COMPLIANCE as complianceDocs on both rows", () => {
    const blobs = upExec.match(/'\{"invoiceIssued":true\}'::jsonb/g) ?? [];
    expect(blobs).toHaveLength(2);
    expect(SEED_DEFAULT_COMPLIANCE).toEqual({ invoiceIssued: true });
    // distributorName gibi bir ek anahtar tohumla kalıcı ayrışma demektir.
    expect(upExec).not.toContain("distributorName");
  });

  it("the seed SERVICES array agrees with the migration on both SKUs", () => {
    for (const [sku, cents] of [
      [PRINT3D_BASE_SKU, PRINT3D_BASE_PRICE_CENTS],
      [PRINT3D_ITEM_SKU, PRINT3D_ITEM_PRICE_CENTS],
    ] as const) {
      const seeded = SERVICES.find((s) => s.sku === sku) as any;
      expect(seeded).toBeDefined();
      expect(seeded.priceCents).toBe(cents);
      expect(seeded.category).toBe("service");
      expect(seeded.serviceMeta.serviceType).toBe("print3d");
      expect(seeded.serviceMeta.partner).toBe("figurunica");
      expect(priceForSku(upExec, sku)).toBe(seeded.priceCents);
      // Tohum status/saleMode/complianceDocs YAZMAZ — ortak upsert atar.
      expect(seeded.status).toBeUndefined();
      expect(seeded.saleMode).toBeUndefined();
      expect(seeded.complianceDocs).toBeUndefined();
    }
  });

  it("uses the snake_case mapped table names everywhere", () => {
    expect(upExec).not.toMatch(/"HardwareProduct"|"Product"|"HardwareOrder"/);
    expect(downExec).not.toMatch(/"HardwareProduct"|"Product"|"HardwareOrder"/);
    expect(upExec).toContain('"hardware_products"');
    expect(upExec).toContain('"print3d_jobs"');
    expect(upExec).toContain('"products"');
  });

  it("the ON CONFLICT DO UPDATE does not overwrite status", () => {
    const block = upExec.match(/ON CONFLICT[\s\S]*?DO UPDATE[\s\S]*?;/)?.[0];
    expect(block).toBeDefined();
    expect(block).not.toContain('"status"');
  });

  it("never DELETEs a catalog row without a NOT EXISTS guard over paid rows", () => {
    const del = downExec.match(
      /DELETE FROM "hardware_products"[\s\S]*?;/,
    )?.[0];
    expect(del).toBeDefined();
    expect(del).toContain("NOT EXISTS");
    expect(del).toContain('"hardware_order_items"');
    expect(del).toContain('"print3d_jobs"');
  });

  it("refuses to drop print3d_jobs while any job row exists", () => {
    const raiseAt = downExec.search(/RAISE EXCEPTION/);
    const dropAt = downExec.search(/DROP TABLE/);
    expect(raiseAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(-1);
    // Guard, DROP'lardan ÖNCE gelmeli — aksi halde koruduğu veriyi kendisi yok eder.
    expect(raiseAt).toBeLessThan(dropAt);
    expect(downExec.slice(raiseAt, raiseAt + 200)).toContain("print3d_jobs");
  });

  it("guards every print3d_jobs reference in the down with to_regclass", () => {
    // İkinci koşuda tablo yok; korumasız her okuma 42P01 undefined_table verir.
    const guards = downExec.match(/to_regclass\('public\.print3d_jobs'\)/g) ?? [];
    const reads = downExec.match(/FROM "print3d_jobs"/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    expect(reads.length).toBeGreaterThan(0);
  });

  it("never issues an unscoped DELETE on hardware_inventory", () => {
    const del = downExec.match(
      /DELETE FROM "hardware_inventory"[\s\S]*?;/,
    )?.[0];
    expect(del).toBeDefined();
    expect(del).toContain("'print3d_base'");
    expect(del).toContain("'print3d_item'");
  });

  it("sorts after every sibling v3.7.0 migration in the chain", () => {
    const name = "20260820170000_print3d_service";
    for (const sibling of [
      "20260820120000_reprice_licence_and_stock",
      "20260820140000_delivery_platforms_bundle",
      "20260820150000_card_shift_schema",
      "20260820160000_card_shift_catalog",
    ]) {
      expect(name > sibling).toBe(true);
    }
  });
});
```

- [ ] **Adım 8: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d/print3d-catalog-migration.spec.ts`
Expected: Adım 4-6 yapılmadan çalıştırılırsa `Cannot find module './print3d.const'` / `ENOENT: no such file or directory … migration.sql`. Adım 4-6'dan sonra bu adım **yeşil** olmalı; dosyaları yazmadan önce bir kez çalıştırıp kırmızıyı görmek şart.

- [ ] **Adım 9: Testi yeşil gör + tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d/print3d-catalog-migration.spec.ts
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
```
Expected: `13 passed`; `tsc` çıktısız.

- [ ] **Adım 10: Commit**

```bash
git add backend/src/modules/print3d/print3d.const.ts backend/src/modules/print3d/print3d-catalog-migration.spec.ts backend/prisma/schema.prisma backend/prisma/migrations/20260820170000_print3d_service backend/prisma/seeds/seed-marketplace.ts
git commit -m "feat(print3d): şema, tersinir migration ve iki hizmet SKU'su

Print3dJob + Print3dJobItem tabloları ve hardware_products'a print3d_base
(150.000 kuruş) + print3d_item (5.000 kuruş) satırları TEK migration
dizininde iniyor: SKU'suz tablo ölü, tablosuz SKU provizyonu patlatır.

productId nullable + SET NULL, çünkü menü ürünleri gerçekten siliniyor;
snapshot kolonları bağ koptuğunda manifestoyu ayakta tutuyor.

down.sql ödenmiş iş varsa RAISE EXCEPTION ile duruyor ve hiçbir şeye
dokunmuyor; her print3d_jobs okuması to_regclass ile korunuyor, yani ikinci
koşu 42P01 vermiyor. ON CONFLICT DO UPDATE status'e dokunmuyor: arşivlenmiş
bir SKU migration yeniden koşunca satışa geri açılmamalı.

Donanım rayına ilk katalog sürüklenme tripwire'ı da geliyor."
```

---

## Görev 3: Migration gidiş-dönüş kanıtı (up → down → up)

Atılabilir bir veritabanında, sekiz adımda. Bu görev **kod üretmez**; kanıt üretir. Kanıtsız bir tersinir çift, tersinir çift değildir.

**Files:**
- Test: `backend/prisma/migrations/20260820170000_print3d_service/{migration,down}.sql` (Görev 2'de yazıldı — burada yalnız çalıştırılır)

**Interfaces:**
- Consumes: `20260820170000_print3d_service/migration.sql`, `down.sql` (Görev 2)
- Produces: yok (doğrulama görevi)

> Bu görev **asla** yerel geliştirme sunucusuna ya da dev/staging veritabanına dokunmaz. Her şey tek kullanımlık bir Docker Postgres'inde çalışır (spec §6). Yerel sunucuda `postgres` adında bir veritabanı **yoktur** (`FATAL: database "postgres" does not exist`), yani `CREATE DATABASE`'i oradan sürmek zaten imkânsızdır; ayrıca plan metnine gerçek bir parola yazılmaz. Kap adı `print3d-migtest`, port **55433** — teslimat planının `mig-probe` kabı 55432'yi kullanır, çakışma yoktur.

- [ ] **Adım 1: Atılabilir Postgres'i ayağa kaldır ve zinciri uygula**

```bash
docker run --rm -d --name print3d-migtest -e POSTGRES_PASSWORD=probe -p 55433:5432 postgres:16
until docker exec print3d-migtest pg_isready -U postgres >/dev/null 2>&1; do :; done
cd /home/tarik/Projects/kds/backend
DATABASE_URL='postgresql://postgres:probe@localhost:55433/postgres?schema=public' npx prisma migrate deploy
```
Expected: `All migrations have been successfully applied.` ve listede `20260820170000_print3d_service`.

Kısaltma — **bu görevin her adımında yeniden tanımlanır** (her kod bloğu ayrı bir kabukta çalışabilir):

```bash
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
```

- [ ] **Adım 2: Up'ı ikinci kez çalıştır — idempotans**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
$P < "$MIG/migration.sql"
echo "exit=$?"
$P -tAc \
  "SELECT count(*), min(\"priceCents\"), max(\"priceCents\") FROM hardware_products WHERE sku LIKE 'print3d%'"
$P -tAc \
  "SELECT DISTINCT \"complianceDocs\"::text FROM hardware_products WHERE sku LIKE 'print3d%'"
```
Expected: `exit=0`; ikinci sorgu `2|5000|150000`; üçüncü sorgu `{"invoiceIssued": true}`.

- [ ] **Adım 3: Arşivlenmiş SKU satışa geri açılmıyor**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
$P -c "UPDATE hardware_products SET status='archived' WHERE sku='print3d_base'"
$P < "$MIG/migration.sql"
$P -tAc "SELECT status FROM hardware_products WHERE sku='print3d_base'"
$P -c "UPDATE hardware_products SET status='published' WHERE sku='print3d_base'"
```
Expected: üçüncü komut `archived` yazar (ON CONFLICT DO UPDATE `status`'e dokunmuyor).

- [ ] **Adım 4: Ödenmiş-iş guard'ı — down GÜRÜLTÜYLE durur ve HİÇBİR ŞEY silmez**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
$P <<'SQL'
INSERT INTO "hardware_orders" ("id","tenantId","status","subtotalCents","taxCents","shippingCents","totalCents","currency","createdAt","updatedAt")
VALUES ('ord-guard-1','tenant-guard-1','paid',166667,33333,0,200000,'TRY',NOW(),NOW());
INSERT INTO "print3d_jobs" ("id","tenantId","hwOrderId","status","partner","basePriceCents","perItemCents","itemCount","totalCents","currency","createdAt","updatedAt")
VALUES ('job-guard-1','tenant-guard-1','ord-guard-1','queued','figurunica',150000,5000,10,200000,'TRY',NOW(),NOW());
INSERT INTO "print3d_job_items" ("id","jobId","productId","productName","position","status","createdAt","updatedAt")
VALUES ('item-guard-1','job-guard-1',NULL,'Adana Kebap',0,'pending',NOW(),NOW());
SQL
$P < "$MIG/down.sql"
echo "down_exit=$?"
```
Expected: `ERROR:  ABORT: print3d_jobs holds 1 paid job(s). Export and delete them before rolling back 20260820170000_print3d_service.` ve `down_exit=3` (sıfırdan farklı).

- [ ] **Adım 5: Guard sonrası hiçbir şeyin kaybolmadığını doğrula**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
$P -tAc "SELECT to_regclass('public.print3d_jobs') IS NOT NULL, to_regclass('public.print3d_job_items') IS NOT NULL"
$P -tAc "SELECT count(*) FROM print3d_jobs"
$P -tAc "SELECT count(*) FROM print3d_job_items"
$P -tAc "SELECT count(*) FROM hardware_products WHERE sku LIKE 'print3d%'"
$P -tAc "SELECT count(*) FROM hardware_inventory hi JOIN hardware_products hp ON hp.id=hi.\"productId\" WHERE hp.sku LIKE 'print3d%'"
```
Expected: sırasıyla `t|t`, `1`, `1`, `2`, `2` — işlem geri sarıldığı için hiçbir adım kısmen uygulanmadı.

- [ ] **Adım 6: Guard verisini temizle ve down'u uçtan uca çalıştır**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
BEFORE=$($P -tAc "SELECT count(*) FROM hardware_inventory")
$P -c "DELETE FROM print3d_job_items"
$P -c "DELETE FROM print3d_jobs"
$P -c "DELETE FROM hardware_orders WHERE id='ord-guard-1'"
$P < "$MIG/down.sql"
echo "down_exit=$?"
AFTER=$($P -tAc "SELECT count(*) FROM hardware_inventory")
echo "inventory_delta=$((BEFORE-AFTER))"
$P -tAc "SELECT to_regclass('public.print3d_jobs') IS NULL, to_regclass('public.print3d_job_items') IS NULL"
$P -tAc "SELECT count(*) FROM hardware_products WHERE sku LIKE 'print3d%'"
```
Expected: `down_exit=0`; `inventory_delta=2` (**tam olarak 2** — başka hiçbir envanter satırına dokunulmadı); `t|t`; `0`.

- [ ] **Adım 7: Down'u ikinci kez çalıştır — idempotans**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
$P < "$MIG/down.sql"
echo "second_down_exit=$?"
```
Expected: `second_down_exit=0`, hiçbir `ERROR:` satırı yok (özellikle `42P01 undefined_table` yok — `to_regclass` guard'ı ve `DROP TABLE IF EXISTS` sayesinde).

- [ ] **Adım 8: Up'ı yeniden uygula ve aynı duruma vardığını doğrula, sonra temizle**

```bash
set -o pipefail
export P='docker exec -i print3d-migtest psql -U postgres -d postgres -v ON_ERROR_STOP=1'
export MIG=/home/tarik/Projects/kds/backend/prisma/migrations/20260820170000_print3d_service
$P < "$MIG/migration.sql"
echo "reup_exit=$?"
$P -tAc "SELECT count(*) FROM hardware_products WHERE sku LIKE 'print3d%'"
$P -tAc "SELECT to_regclass('public.print3d_jobs') IS NOT NULL"
docker stop print3d-migtest
```
Expected: `reup_exit=0`; `2`; `t`; `docker stop` kabın adını yazar (kap `--rm` ile açıldığı için kendini siler) — **up → down → up kanıtlandı**.

- [ ] **Adım 9: Kanıtı migration başlığına işle ve commit et**

`backend/prisma/migrations/20260820170000_print3d_service/down.sql` dosyasının en üstüne (ilk yorum satırının hemen üstüne) ekle:

```sql
-- Round-trip verified 2026-08-20 on a throwaway Postgres: up -> up(2x) ->
-- archived-status preserved -> paid-job guard aborts with nothing lost ->
-- down -> down(2x, no 42P01) -> up. Inventory delta on down was exactly 2.
```

```bash
git add backend/prisma/migrations/20260820170000_print3d_service/down.sql
git commit -m "chore(print3d): migration gidiş-dönüş kanıtını down.sql başlığına işle

Atılabilir Postgres'te 8 adım koşturuldu: up, ikinci up (idempotan),
archived status korunuyor, ödenmiş iş varken down hiçbir şey silmeden
RAISE EXCEPTION ile duruyor, temiz down, ikinci down (42P01 yok), yeniden
up. Envanter farkı tam olarak 2."
```

---

## Görev 4: Print3d satırları superadmin panelinden yönetilebilsin

İki bağımsız kapı bugün kapalı: SKU regex'i alt çizgiyi reddediyor, ve ürün formundaki kategori `<select>`'i `service` sunmuyor. İkisi birlikte açılmazsa bu iki katalog satırı panelden **hiç** yönetilemez.

**Files:**
- Modify: `backend/src/modules/catalog/dto/create-hardware-product.dto.ts` (`@Matches` ~69-71)
- Modify: `backend/src/modules/catalog/dto/hardware-quote-request.dto.ts` (`@Matches` ~25-27)
- Modify: `frontend/src/pages/superadmin/MarketplaceAdminPage.tsx` (kategori `<select>` ~602-612)
- Test: `backend/src/modules/catalog/dto/hardware-sku-regex.spec.ts`
- Test: `frontend/src/pages/superadmin/MarketplaceAdminPage.test.tsx` (mevcut dosyaya ekleme)

**Interfaces:**
- Consumes: `PRINT3D_BASE_SKU`, `PRINT3D_ITEM_SKU` (Görev 2); `SERVICES`, `PRODUCTS` (Görev 2'de export edildi)
- Produces: SKU regex `^[a-z0-9][a-z0-9_-]{2,63}$` (iki DTO'da birebir aynı)

- [ ] **Adım 1: Regex testini yaz (kırmızı)**

`backend/src/modules/catalog/dto/hardware-sku-regex.spec.ts`:

```ts
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateHardwareProductDto } from "./create-hardware-product.dto";
import { HardwareQuoteRequestDto } from "./hardware-quote-request.dto";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
} from "../../print3d/print3d.const";
import { PRODUCTS, SERVICES } from "../../../../prisma/seeds/seed-marketplace";

/**
 * SKU regex'i alt çizgiye açıldı (^[a-z0-9][a-z0-9_-]{2,63}$).
 *
 * Neden: onaylı print3d SKU'ları alt çizgi taşıyor ve eski regex onları
 * reddediyordu — yani superadmin katalog API'sinden bu iki satır hiç
 * yönetilemezdi. Genişletme kesinlikle geriye dönük uyumlu olmalı: mevcut
 * her SKU hâlâ eşleşmeli, ve daralma yönünde hiçbir şey açılmamalı.
 */
function skuErrors(sku: string): string[] {
  const dto = plainToInstance(CreateHardwareProductDto, {
    sku,
    category: "service",
    name: "X",
    priceCents: 1,
  });
  return validateSync(dto)
    .filter((e) => e.property === "sku")
    .map((e) => Object.values(e.constraints ?? {}).join("|"));
}

function quoteSkuErrors(sku: string): string[] {
  const dto = plainToInstance(HardwareQuoteRequestDto, { sku });
  return validateSync(dto)
    .filter((e) => e.property === "sku")
    .map((e) => Object.values(e.constraints ?? {}).join("|"));
}

describe("hardware SKU regex", () => {
  it("accepts the print3d SKUs (underscore)", () => {
    for (const sku of [PRINT3D_BASE_SKU, PRINT3D_ITEM_SKU]) {
      expect(skuErrors(sku)).toEqual([]);
      expect(quoteSkuErrors(sku)).toEqual([]);
    }
  });

  it("still accepts every SKU the seed ships", () => {
    for (const p of [...PRODUCTS, ...SERVICES]) {
      expect(skuErrors(p.sku)).toEqual([]);
    }
  });

  it("still rejects uppercase, spaces and leading punctuation", () => {
    for (const bad of ["Print3D_Base", "print3d base", "_print3d", "-abc", "ab"]) {
      expect(skuErrors(bad).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/catalog/dto/hardware-sku-regex.spec.ts`
Expected: FAIL — `accepts the print3d SKUs (underscore)`: `expected [ 'sku must be lowercase, alphanumeric + hyphen, 3-64 chars' ] to deeply equal []`

- [ ] **Adım 3: İki DTO'daki regex'i genişlet**

`backend/src/modules/catalog/dto/create-hardware-product.dto.ts` — `CreateHardwareProductDto.sku` üzerindeki `@Matches` bloğunu değiştir:

```ts
  // v3.7.0 — alt çizgi eklendi. Onaylı print3d SKU'ları (print3d_base /
  // print3d_item) alt çizgi taşıyor; eski regex onları reddettiği için o iki
  // satır superadmin katalog API'sinden yönetilemiyordu. Genişletme geriye
  // dönük uyumlu: mevcut her SKU hâlâ eşleşir (hardware-sku-regex.spec.ts).
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/, {
    message:
      "sku must be lowercase, alphanumeric + hyphen/underscore, 3-64 chars",
  })
```

`backend/src/modules/catalog/dto/hardware-quote-request.dto.ts` — `HardwareQuoteRequestDto.sku` üzerinde **birebir aynı** bloğu kullan (iki kopya bilerek senkron tutuluyor; testler ikisini de gezer).

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/catalog/dto/hardware-sku-regex.spec.ts`
Expected: PASS — `3 passed`.

- [ ] **Adım 5: Superadmin form testini yaz (kırmızı)**

`frontend/src/pages/superadmin/MarketplaceAdminPage.test.tsx` — mevcut `describe` bloğuna ekle:

```tsx
  it('offers the service category in the product form select', async () => {
    // Bu seçenek olmadan iki print3d satırı panelden HİÇ oluşturulamaz:
    // form `category` alanını gönderiyor ve <select> 'service' sunmuyordu.
    render(<MarketplaceAdminPage />, { wrapper });
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toContain('service');
  });
```

> Dosyanın kendi `render` / `wrapper` / mock kurulumunu kullan — yukarıdaki iki satır o kuruluma uyacak şekilde uyarlanır (dosyanın en üstündeki mevcut testin render çağrısını kopyala). Ürün formu bir modal ise, önce onu açan düğmeye `fireEvent.click` uygula; mevcut testlerde bu düğmeyi bulan sorgu zaten var.

- [ ] **Adım 6: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/superadmin/MarketplaceAdminPage.test.tsx -t "service category"`
Expected: FAIL — `expected [ 'kds_screen', 'tablet', 'pos_terminal', 'printer', 'yazarkasa', 'bridge', 'scanner', 'caller_id', 'other' ] to contain 'service'`

- [ ] **Adım 7: `<option value="service">` ekle**

`frontend/src/pages/superadmin/MarketplaceAdminPage.tsx` — kategori `<select>`'inde `<option value="caller_id">caller_id</option>` satırının **hemen ardına**:

```tsx
              {/* v3.7.0 — hizmet satırları (print3d_base / print3d_item) bu
                  formdan yönetilebilsin. Bu <select> sözlükten (catalog/
                  category-vocabulary.ts) TÜREMİYOR ve zaten drift'te; burada
                  yalnız KENDİ değerimizi ekliyoruz. Sözlükten besleme ayrı iş. */}
              <option value="service">service</option>
```

- [ ] **Adım 8: Testleri ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/catalog
cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/superadmin/MarketplaceAdminPage.test.tsx
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: hepsi PASS / çıktısız.

- [ ] **Adım 9: Commit**

```bash
git add backend/src/modules/catalog/dto/create-hardware-product.dto.ts backend/src/modules/catalog/dto/hardware-quote-request.dto.ts backend/src/modules/catalog/dto/hardware-sku-regex.spec.ts frontend/src/pages/superadmin/MarketplaceAdminPage.tsx frontend/src/pages/superadmin/MarketplaceAdminPage.test.tsx
git commit -m "feat(catalog): alt çizgili SKU ve service kategorisi panelden yönetilebilir

SKU regex'i ^[a-z0-9][a-z0-9_-]{2,63}\$ oldu: print3d_base / print3d_item
alt çizgi taşıyor, eski regex onları reddediyordu. Geriye dönük uyumlu —
tohumun gönderdiği her SKU hâlâ eşleşiyor.

Regex tek başına yetmiyordu: superadmin ürün formundaki kategori select'i
'service' sunmuyor ve form category alanını gönderiyor, yani yeni bir hizmet
satırı panelden açılamıyordu. Select'e yalnız kendi değerimiz eklendi;
sözlükten türetme ayrı iş."
```

---

## Görev 5: `productIds` sepet sözleşmesi — `whitelist:true` diziyi silmesin

`ValidationPipe` `whitelist:true` ile çalışıyor ve **beyan edilmemiş** alanı sessizce siler. `productIds` DTO'da beyan edilmezse dizi kaybolur, adet 1'e düşer ve 50 figür ₺50'ye satılır.

**Files:**
- Modify: `backend/src/modules/checkout/checkout.types.ts` (`CartItemService` ~26-43; `PricedLineMeta` ~72-103)
- Modify: `backend/src/modules/checkout/dto/cart.dto.ts` (`CartItemDto`, `notes` alanından sonra ~110-114)
- Test: `backend/src/modules/checkout/dto/cart.dto.spec.ts` (mevcut dosyaya ekleme)

**Interfaces:**
- Consumes: yok
- Produces:
  - `CartItemService.productIds?: string[]`
  - `export interface Print3dLineSnapshot { productId: string | null; name: string; imageUrl: string | null; model3dUrl: string | null; position: number }`
  - `PricedLineMeta.print3dProductIds?: string[]`
  - `PricedLineMeta.print3dSnapshots?: Print3dLineSnapshot[]`
  - `CartItemDto.productIds?: string[]` (`@IsOptional @IsArray @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID("all", { each: true })`)

- [ ] **Adım 1: DTO testini yaz (kırmızı)**

`backend/src/modules/checkout/dto/cart.dto.spec.ts` — mevcut dosyanın sonuna yeni bir `describe` ekle:

```ts
describe("CartItemDto — print3d productIds (v3.7.0)", () => {
  const base = {
    type: "service" as const,
    code: "print3d_item",
    qty: 1,
    productIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  };

  it("keeps productIds on a service item (whitelist:true would otherwise delete it)", async () => {
    // ValidationPipe main.ts'te whitelist:true ile kurulu: BEYAN EDİLMEMİŞ her
    // alan sessizce silinir. Alan burada beyan edilmezse dizi kaybolur ve
    // print3d_item adedi 1'e düşer — 50 figür 50 kuruşa satılır.
    const dto = plainToInstance(CartItemDto, base, {
      excludeExtraneousValues: false,
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto.productIds).toEqual(base.productIds);
  });

  it("rejects a non-UUID entry in productIds", async () => {
    const dto = plainToInstance(CartItemDto, {
      ...base,
      productIds: ["not-a-uuid"],
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain("productIds");
  });

  it("rejects more than 50 productIds", async () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `1111111${String(i).padStart(4, "0")}-1111-4111-8111-111111111111`,
    );
    const dto = plainToInstance(CartItemDto, { ...base, productIds: many });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain("productIds");
  });
});
```

> `plainToInstance`, `validate` ve `CartItemDto` mevcut dosyada zaten import edilmiş; değilse `import { plainToInstance } from "class-transformer";` ve `import { validate } from "class-validator";` satırlarını ekle.

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/dto/cart.dto.spec.ts -t "print3d productIds"`
Expected: FAIL — `keeps productIds on a service item`: `expected undefined to deeply equal [ '1111…', '2222…' ]` (alan DTO'da yok, `plainToInstance` onu taşımıyor).

- [ ] **Adım 3: `CartItemDto`'ya alanı ekle**

`backend/src/modules/checkout/dto/cart.dto.ts` — `notes` alanının hemen ardına, `CartItemDto` sınıfının içinde:

```ts
  // v3.7.0 — 3D baskı figür hizmeti: alıcının KENDİ menüsünden seçtiği ürünler.
  // print3d_item satırının ADEDİ bu diziden TÜRETİLİR; istemcinin qty'si
  // yok sayılır (QuoteService.resolvePrint3dSelection).
  //
  // Alan burada BEYAN EDİLMEK ZORUNDA: main.ts'in ValidationPipe'ı
  // whitelist:true ile çalışır ve beyan edilmemiş alanı SESSİZCE siler —
  // dizi kaybolur, adet 1'e düşer, 50 figür 50 kuruşa satılır.
  @ApiPropertyOptional({ type: [String], format: "uuid", minItems: 1, maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID("all", { each: true })
  productIds?: string[];
```

`ArrayMinSize`, `ArrayMaxSize`, `IsArray`, `IsUUID`, `ApiPropertyOptional` bu dosyada **zaten import edilmiş**; yeni import gerekmiyor.

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/dto/cart.dto.spec.ts`
Expected: PASS.

- [ ] **Adım 5: Motor tiplerini genişlet**

`backend/src/modules/checkout/checkout.types.ts` — `CartItemService` arayüzünün sonuna (`notes?: string;` altına):

```ts
  /**
   * v3.7.0 — 3D baskı: alıcının kendi menüsünden seçtiği ürün id'leri.
   * SADECE `print3d_item` satırında anlamlıdır. Satırın adedi SUNUCUDA bu
   * diziden türetilir; istemcinin `qty`'si yok sayılır.
   */
  productIds?: string[];
```

Aynı dosyada, `PricedLineMeta` arayüzünün **üstüne**:

```ts
/**
 * v3.7.0 — bir print3d kaleminin satın alma anındaki anlık görüntüsü.
 *
 * Menü ürünleri GERÇEKTEN siliniyor ve menü düzenlemesi ödenmiş bir siparişi
 * yeniden yazamaz, bu yüzden ad/foto/model quote anında dondurulur ve
 * provizyon bunları Print3dJobItem'a birebir kopyalar.
 */
export interface Print3dLineSnapshot {
  /** Ürün hâlâ varsa id'si; quote anında bulunamadıysa null. */
  productId: string | null;
  name: string;
  imageUrl: string | null;
  model3dUrl: string | null;
  /** 0-tabanlı sıra — manifestoda kalemler bu sırayla basılır. */
  position: number;
}
```

`PricedLineMeta` içine, `notes?: string;` alanının ardına:

```ts
  // --- 3D baskı figür (v3.7.0) ---
  /** Seçilen menü ürünlerinin id'leri — `print3d_item` adedi buradan türer. */
  print3dProductIds?: string[];
  /** Provizyon anında Print3dJobItem'a dondurulacak anlık görüntüler. */
  print3dSnapshots?: Print3dLineSnapshot[];
```

- [ ] **Adım 6: Tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/dto
```
Expected: `tsc` çıktısız; jest PASS.

- [ ] **Adım 7: Commit**

```bash
git add backend/src/modules/checkout/dto/cart.dto.ts backend/src/modules/checkout/dto/cart.dto.spec.ts backend/src/modules/checkout/checkout.types.ts
git commit -m "feat(checkout): sepet satırına productIds sözleşmesi

ValidationPipe whitelist:true ile çalışıyor ve beyan edilmemiş alanı
SESSİZCE siliyor. productIds DTO'da beyan edilmezse dizi kayboluyor,
print3d_item adedi 1'e düşüyor ve 50 figür 50 kuruşa satılıyor — test bunu
çiviliyor.

Motor tarafında CartItemService.productIds, Print3dLineSnapshot ve
PricedLineMeta.print3d* alanları açıldı; üretici (QuoteService) ile tüketici
(CheckoutService) arasındaki anahtar adı artık derleyicinin gözetiminde."
```

---

## Görev 6: PARA — `QuoteService` adedi sunucuda türetir

Bu değişikliğin **para-kritik** görevi. Kurcalanmış bir sepet, sipariş ettiğinden az figürün parasını ödeyememeli; iki kez taban bedeli tahsil edilememeli; başka kiracının menüsü fiyatlanamamalı.

**Files:**
- Modify: `backend/src/modules/checkout/quote.service.ts` (importlar ~1-6; döngü öncesi ~76-78; hizmet dalı `lines.push` ~287-307; döngü sonrası ~309-311; sınıf sonu `quote()` sonrası ~348)
- Test: `backend/src/modules/checkout/quote-print3d.spec.ts`

**Interfaces:**
- Consumes: `PRINT3D_BASE_SKU`, `PRINT3D_ITEM_SKU`, `PRINT3D_MIN_ITEMS`, `PRINT3D_MAX_ITEMS`, `PRINT3D_SERVICE_TYPE` (Görev 2); `CartItemService.productIds`, `Print3dLineSnapshot`, `PricedLineMeta.print3dProductIds`, `PricedLineMeta.print3dSnapshots` (Görev 5)
- Produces:
  - `QuoteService` private `resolvePrint3dSelection(cart: Cart, tenantId: string): Promise<{ productIds: string[]; snapshots: Print3dLineSnapshot[] } | null>`
  - Hata kodları (BadRequestException gövdesinde `code`): `PRINT3D_DUPLICATE_LINE`, `PRINT3D_NO_PRODUCTS`, `PRINT3D_TOO_MANY_PRODUCTS`, `PRINT3D_FOREIGN_PRODUCT`, `PRINT3D_INCOMPLETE_CART`
  - `print3d_item` priced line: `qty === productIds.length`, `meta.print3dProductIds`, `meta.print3dSnapshots`

- [ ] **Adım 1: Düşman testleri yaz (kırmızı)**

`backend/src/modules/checkout/quote-print3d.spec.ts`:

```ts
import { QuoteService } from "./quote.service";
import {
  PRINT3D_BASE_PRICE_CENTS,
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_PRICE_CENTS,
  PRINT3D_ITEM_SKU,
} from "../print3d/print3d.const";

/**
 * v3.7.0 — 3D baskı figür hizmetinin PARA testleri.
 *
 * Burada çivilenen tek cümle: SEPET FİYATI İSTEMCİYE SORULMAZ. Adet seçilen
 * ürün sayısından türer, taban ve kalem satırları ayrılamaz, başka kiracının
 * ürünü hiç fiyatlanmaz, ve hizmet-yalnız sepette kargo sıfırdır.
 */
const TENANT = "tenant-1";
const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

function catalogRow(sku: string, priceCents: number, over: any = {}) {
  return {
    sku,
    name: sku,
    status: "published",
    category: "service",
    priceCents,
    currency: "TRY",
    serviceMeta: {
      serviceType: "print3d",
      partner: "figurunica",
      role: sku === PRINT3D_BASE_SKU ? "base" : "item",
    },
    saleMode: "DIRECT_SALE",
    ...over,
  };
}

describe("QuoteService — 3D baskı figür (v3.7.0)", () => {
  let prisma: any;
  let catalog: any;
  let addons: any;
  let licensing: any;
  let svc: QuoteService;

  const priceCart = (cart: any) => svc.quote(cart, TENANT);

  /** N ürünlük tam sepet: taban + kalem. */
  const fullCart = (ids: string[], over: any = {}) => ({
    items: [
      { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
      { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids, ...over },
    ],
  });

  /** Tenant-filtreli sorgu bu satırları döner. */
  const productRows = (ids: string[]) =>
    ids.map((id, i) => ({
      id,
      name: `Ürün ${i}`,
      image: null,
      model3dUrl: null,
      productImages: [],
    }));

  beforeEach(() => {
    prisma = {
      subscriptionPlan: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
    };
    catalog = {
      findBySkuOrThrow: jest.fn(async (sku: string) =>
        sku === PRINT3D_BASE_SKU
          ? catalogRow(PRINT3D_BASE_SKU, PRINT3D_BASE_PRICE_CENTS)
          : catalogRow(PRINT3D_ITEM_SKU, PRINT3D_ITEM_PRICE_CENTS),
      ),
    };
    addons = { findByCodeOrThrow: jest.fn() };
    licensing = {
      loadContext: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        anchorAt: null,
        hasLicense: false,
        now: new Date("2026-08-20T00:00:00.000Z"),
        tz: "Europe/Istanbul",
      }),
      price: jest.fn(),
    };
    svc = new QuoteService(prisma, catalog, addons, licensing as any);
  });

  it("derives the print3d_item quantity from productIds.length and IGNORES the client qty", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => uuid(i));
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    // İstemci qty:1 gönderiyor — 7 figürü 50 kuruşa almaya çalışıyor.
    const q = await priceCart(fullCart(ids));
    const item = q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!;
    expect(item.qty).toBe(7);
    expect(item.subtotalCents).toBe(35_000);
  });

  it("prices 1 base + N items as 150000 + 5000*N kuruş, KDV dahil", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => uuid(i));
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    const q = await priceCart(fullCart(ids));
    expect(q.totalCents).toBe(200_000);
    expect(q.subtotalCents).toBe(166_667); // net
    expect(q.taxCents).toBe(33_333); // gömülü KDV, ÜSTE EKLENMEZ
  });

  it("charges ZERO shipping for a service-only print3d cart", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    const q = await priceCart(fullCart(ids));
    // "Kargo dahil" vaadi. Bunu 5000'e çevirmek ilan edilen fiyatın üstüne
    // ₺50 bindirir ve yerleşimdeki 1 kuruş toleransını patlatır.
    expect(q.shippingCents).toBe(0);
    expect(q.totalCents).toBe(155_000);
  });

  it("rejects a print3d_item line with no matching print3d_base line", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    await expect(
      priceCart({
        items: [
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a print3d_base line with no matching print3d_item line", async () => {
    await expect(
      priceCart({ items: [{ type: "service", code: PRINT3D_BASE_SKU, qty: 1 }] }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a cart carrying two print3d_item lines", async () => {
    // İki kalem satırı: fiyatlama ikisini de ilk satırın productIds'iyle
    // çarpar, provizyon TEK iş basar → alıcı 2N figür öder, N alır.
    const ids = [uuid(1), uuid(2)];
    await expect(
      priceCart({
        items: [
          { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_DUPLICATE_LINE" },
    });
  });

  it("rejects a cart carrying two print3d_base lines", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    // 2 × ₺1.500 tahsil edilip yine tek iş üretilirdi.
    await expect(
      priceCart({
        items: [
          { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
          { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a print3d line whose companion was dropped by a catalog warning", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    catalog.findBySkuOrThrow.mockImplementation(async (sku: string) =>
      sku === PRINT3D_BASE_SKU
        ? catalogRow(PRINT3D_BASE_SKU, PRINT3D_BASE_PRICE_CENTS, { status: "draft" })
        : catalogRow(PRINT3D_ITEM_SKU, PRINT3D_ITEM_PRICE_CENTS),
    );
    // Taban satırı service_not_purchasable ile DÜŞÜYOR: alıcı ürün başına
    // ₺50 öder, hizmeti hiç almazdı.
    await expect(priceCart(fullCart(ids))).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a productId that belongs to another tenant", async () => {
    const ids = [uuid(1), uuid(2)];
    prisma.product.findMany
      .mockResolvedValueOnce(productRows([uuid(1)])) // tenant-filtreli: biri eksik
      .mockResolvedValueOnce([{ id: uuid(2) }]); // filtresiz: satır BAŞKASININ
    await expect(priceCart(fullCart(ids))).rejects.toMatchObject({
      response: { code: "PRINT3D_FOREIGN_PRODUCT" },
    });
  });

  it("prices a DELETED product without throwing so a settled payment still provisions", async () => {
    const ids = [uuid(1), uuid(2)];
    prisma.product.findMany
      .mockResolvedValueOnce(productRows([uuid(1)]))
      .mockResolvedValueOnce([]); // filtresiz de boş → gerçekten silinmiş
    const q = await priceCart(fullCart(ids));
    const item = q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!;
    expect(item.qty).toBe(2); // tutar ids.length'ten türer, DEĞİŞMEZ
    const snaps = item.meta!.print3dSnapshots!;
    expect(snaps[1]).toMatchObject({ productId: null, name: "Silinmiş ürün" });
  });

  it("rejects an empty productIds selection", async () => {
    await expect(priceCart(fullCart([]))).rejects.toMatchObject({
      response: { code: "PRINT3D_NO_PRODUCTS" },
    });
  });

  it("rejects more than 50 products", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => uuid(i));
    await expect(priceCart(fullCart(ids))).rejects.toMatchObject({
      response: { code: "PRINT3D_TOO_MANY_PRODUCTS" },
    });
  });

  it("deduplicates repeated productIds before deriving the quantity", async () => {
    const a = uuid(1);
    const b = uuid(2);
    prisma.product.findMany.mockResolvedValueOnce(productRows([a, b]));
    const q = await priceCart(fullCart([a, a, b]));
    expect(q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!.qty).toBe(2);
  });

  it("snapshots the primary image url, falling back to the legacy image column", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: ids[0],
        name: "Yeni foto",
        image: "/legacy-0.jpg",
        model3dUrl: null,
        productImages: [{ image: { url: "/primary-0.jpg" } }],
      },
      {
        id: ids[1],
        name: "Eski foto",
        image: "/legacy-1.jpg",
        model3dUrl: null,
        productImages: [],
      },
      {
        id: ids[2],
        name: "Fotosuz",
        image: null,
        model3dUrl: null,
        productImages: [],
      },
    ]);
    const q = await priceCart(fullCart(ids));
    const snaps = q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!.meta!
      .print3dSnapshots!;
    expect(snaps.map((s) => s.imageUrl)).toEqual([
      "/primary-0.jpg",
      "/legacy-1.jpg",
      null, // fotoğrafsız ürün bir HATA değil: üretim yalnız ADLA çalışır
    ]);
    expect(snaps.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("snapshots model3dUrl when the product already has one", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: ids[0],
        name: "Kebap",
        image: null,
        model3dUrl: "https://cdn.example/kebap.glb",
        productImages: [],
      },
    ]);
    const q = await priceCart(fullCart(ids));
    // Meshy/AI hattı ÇALIŞTIRILMAZ; yalnızca mevcut değer kopyalanır.
    expect(
      q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!.meta!.print3dSnapshots![0]
        .model3dUrl,
    ).toBe("https://cdn.example/kebap.glb");
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/quote-print3d.spec.ts`
Expected: FAIL — ilk test: `expected 1 to be 7` (satır hâlâ istemcinin `qty`'siyle fiyatlanıyor); `rejects…` testleri `received promise resolved instead of rejected`.

- [ ] **Adım 3: `resolvePrint3dSelection` metodunu ekle**

`backend/src/modules/checkout/quote.service.ts` — import bloğuna ekle:

```ts
import {
  Cart,
  CartItemService,
  CartQuote,
  PricedLine,
  Print3dLineSnapshot,
  QuoteWarning,
} from "./checkout.types";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  PRINT3D_MAX_ITEMS,
  PRINT3D_MIN_ITEMS,
  PRINT3D_SERVICE_TYPE,
} from "../print3d/print3d.const";
```

(mevcut `import { Cart, CartQuote, PricedLine, QuoteWarning } from "./checkout.types";` satırını yukarıdaki genişletilmiş hâliyle **değiştir**.)

Sınıfın sonuna, `quote()` metodunun kapanışından sonra:

```ts
  /**
   * 3D baskı seçimini TEK SEFERDE çözer: adet sunucu-otoriterdir ve ürünlerin
   * kiracıya ait olduğu satır fiyatlanmadan ÖNCE doğrulanır.
   *
   * Sepette bir print3d_item satırı yoksa null döner — eşleşme kontrolü
   * döngüden sonra ayrıca çalışır.
   */
  private async resolvePrint3dSelection(
    cart: Cart,
    tenantId: string,
  ): Promise<{ productIds: string[]; snapshots: Print3dLineSnapshot[] } | null> {
    // TAM SAYIM, `find` DEĞİL. CartDto.items yalnızca ArrayMinSize(1)/
    // ArrayMaxSize(50) taşır — TEKİLLİK KISITI YOK. `find` kullanılsaydı iki
    // print3d_item satırı gönderen bir istemci İKİSİNİ de ilk satırın
    // productIds.length'iyle fiyatlatır, provizyon ise YALNIZ BİRİNİ basardı:
    // alıcı 2N figür öder, N alır.
    const itemLines = cart.items.filter(
      (i) => i.type === "service" && i.code === PRINT3D_ITEM_SKU,
    ) as CartItemService[];
    if (itemLines.length === 0) return null;
    if (itemLines.length > 1) {
      throw new BadRequestException({
        code: "PRINT3D_DUPLICATE_LINE",
        message: "3D baskı siparişi eksik; lütfen sihirbazı yeniden başlatın.",
      });
    }
    const itemLine = itemLines[0];

    // Tekilleştirme BURADA yapılır. @@unique([jobId, productId]) yalnızca
    // ikincil bir kemerdir: productId nullable + SetNull ve Postgres UNIQUE
    // indeksinde NULL'lar ayrı sayılır, yani snapshot'ı alınmış ürünler
    // silindiğinde indeks hiçbir şey zorlamaz. Belde tutan bu Set'tir.
    const ids = [...new Set(itemLine.productIds ?? [])];
    if (ids.length < PRINT3D_MIN_ITEMS) {
      throw new BadRequestException({
        code: "PRINT3D_NO_PRODUCTS",
        message: "En az bir menü ürünü seçmelisiniz.",
      });
    }
    if (ids.length > PRINT3D_MAX_ITEMS) {
      throw new BadRequestException({
        code: "PRINT3D_TOO_MANY_PRODUCTS",
        message: `En fazla ${PRINT3D_MAX_ITEMS} ürün seçebilirsiniz.`,
      });
    }

    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, tenantId },
      select: {
        id: true,
        name: true,
        image: true,
        model3dUrl: true,
        productImages: {
          select: { image: { select: { url: true } } },
          orderBy: { order: "asc" },
          take: 1,
        },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.filter((id) => !byId.has(id));

    if (missing.length > 0) {
      // "Eksik" iki farklı olgu olabilir ve MUAMELELERİ ZITTIR:
      //   a) satır BAŞKA bir kiracıya ait -> güvenlik ihlali, HER ZAMAN reddet;
      //   b) satır hiç yok (silinmiş)     -> yerleşim anındaki yeniden
      //      fiyatlama sırasında olabilir. Burada FIRLATMAK "kart çekildi,
      //      hiçbir şey sağlanmadı" demektir; fiyat zaten ids.length'ten
      //      türediği için tutar DEĞİŞMEZ. Kaydı bozulmuş snapshot'la sürdür.
      const foreign = await this.prisma.product.findMany({
        where: { id: { in: missing } },
        select: { id: true },
      });
      if (foreign.length > 0) {
        throw new BadRequestException({
          code: "PRINT3D_FOREIGN_PRODUCT",
          message: "Seçilen ürünlerden biri bu restorana ait değil.",
        });
      }
    }

    return {
      productIds: ids,
      snapshots: ids.map((id, i) => {
        const r = byId.get(id);
        return {
          productId: r ? r.id : null,
          name: r?.name ?? "Silinmiş ürün",
          imageUrl: r?.productImages?.[0]?.image?.url ?? r?.image ?? null,
          model3dUrl: r?.model3dUrl ?? null,
          position: i,
        };
      }),
    };
  }
```

- [ ] **Adım 4: Seçimi döngüden önce çöz**

Aynı dosyada, `const licensing = await this.licensing.loadContext(tenantId, now);` satırı ile `for (const item of cart.items) {` satırının **arasına**:

```ts
    // v3.7.0 — 3D baskı seçimi TEK SEFERDE, satırlar fiyatlanmadan ÖNCE
    // çözülür: adet sunucu-otoriterdir ve çapraz-kiracı id burada durdurulur.
    const print3d = await this.resolvePrint3dSelection(cart, tenantId);
```

- [ ] **Adım 5: Adedi hizmet dalında türet**

Aynı dosyada, hizmet dalındaki `currency = resolved.currency;` satırı ile onu izleyen `lines.push({` arasına ekle ve `lines.push` gövdesini şu hâle getir:

```ts
        // Adet SUNUCU-OTORİTER. print3d_item için istemcinin qty'si YOK
        // SAYILIR ve seçilen ürün sayısından türetilir; print3d_base her
        // zaman 1'dir. İstemci qty'sine güvenmek 50 figürü ₺50'ye satar.
        const isPrint3d =
          (resolved.serviceMeta as { serviceType?: string } | null | undefined)
            ?.serviceType === PRINT3D_SERVICE_TYPE;
        const effectiveQty = !isPrint3d
          ? qty
          : item.code === PRINT3D_ITEM_SKU
            ? (print3d?.productIds.length ?? 0)
            : 1;
        lines.push({
          type: "service",
          code: item.code,
          name: resolved.name,
          qty: effectiveQty,
          unitCents: resolved.priceCents,
          subtotalCents: resolved.priceCents * effectiveQty,
          cadence: "oneTime",
          meta: {
            branchId: item.branchId,
            serviceMeta: resolved.serviceMeta,
            saleMode: resolved.saleMode,
            preferredDates: item.preferredDates,
            notes: item.notes,
            ...(isPrint3d && item.code === PRINT3D_ITEM_SKU
              ? {
                  print3dProductIds: print3d!.productIds,
                  print3dSnapshots: print3d!.snapshots,
                }
              : {}),
          },
        });
```

- [ ] **Adım 6: Eşleşme kapısını döngüden hemen sonra ekle**

Aynı dosyada, `for (const item of cart.items) { … }` döngüsünün kapanış `}`'ı ile KDV yorum bloğunun (`// Line prices are KDV-INCLUSIVE …`) arasına:

```ts
    // print3d taban/kalem AYRILAMAZ. Bu kontrol döngüden SONRA, ÜRETİLMİŞ
    // SATIRLAR üzerinde çalışır; böylece hem "istemci satırı göndermedi" hem
    // de "satır bir katalog uyarısıyla düşürüldü" (service_not_purchasable /
    // service_not_directly_purchasable / unknown_service) durumlarını yakalar.
    // Düşürülen taban satırı = alıcı ürün başına ₺50 ödeyip hizmeti almıyor;
    // düşürülen kalem satırı = ürünsüz ₺1.500.
    //
    // `some` DEĞİL, SAYIM: sepette tekillik kısıtı yok. baseCount > 1 iki kez
    // ₺1.500 tahsil eder. (Çift KALEM satırını resolvePrint3dSelection daha
    // döngüden önce PRINT3D_DUPLICATE_LINE ile keser; taban satırının
    // productIds'i olmadığı için çözücüye hiç uğramaz — iki kapı birbirinin
    // yedeği değil, tamamlayıcısıdır.)
    const print3dBaseCount = lines.filter(
      (l) => l.code === PRINT3D_BASE_SKU,
    ).length;
    const print3dItemCount = lines.filter(
      (l) => l.code === PRINT3D_ITEM_SKU,
    ).length;
    if (print3dBaseCount !== print3dItemCount || print3dBaseCount > 1) {
      throw new BadRequestException({
        code: "PRINT3D_INCOMPLETE_CART",
        message: "3D baskı siparişi eksik; lütfen sihirbazı yeniden başlatın.",
      });
    }
```

- [ ] **Adım 7: Testleri yeşil gör ve komşu suite'i regresyona karşı çalıştır**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/quote-print3d.spec.ts src/modules/checkout/quote-services.spec.ts
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
```
Expected: `quote-print3d.spec.ts` `15 passed`; `quote-services.spec.ts` hâlâ tamamen yeşil (print3d olmayan hizmetlerde `effectiveQty === qty`); `tsc` çıktısız.

- [ ] **Adım 8: Tüm checkout suite'ini çalıştır**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout`
Expected: PASS — mevcut hiçbir checkout testi kırılmamalı.

- [ ] **Adım 9: Commit**

```bash
git add backend/src/modules/checkout/quote.service.ts backend/src/modules/checkout/quote-print3d.spec.ts
git commit -m "feat(checkout): 3D baskı adedi sunucuda türetiliyor

print3d_item satırının adedi artık seçilen ürün sayısından türüyor;
istemcinin qty'si yok sayılıyor. Aksi hâlde kurcalanmış bir sepet 50 figürü
50 kuruşa alırdı.

Üç kapı daha: (1) çift print3d_item satırı PRINT3D_DUPLICATE_LINE ile
kesiliyor — iki satır 2N figür fiyatlanıp N figür provizyonlanmasına yol
açardı; (2) taban/kalem eşleşmesi ÜRETİLMİŞ satırlar üzerinde sayılıyor,
böylece katalog uyarısıyla düşürülmüş satır da yakalanıyor ve çift taban
satırı reddediliyor; (3) başka kiracıya ait productId hata veriyor.

Silinmiş ürün BİLEREK hata vermiyor: tutar ids.length'ten türediği için
değişmiyor ve yerleşimde fırlatmak 'kart çekildi, hiçbir şey sağlanmadı'
demek olurdu — snapshot 'Silinmiş ürün' adıyla sürüyor.

Hizmet-yalnız sepette kargo ₺0 kalıyor ve bu bir test tarafından çivilendi."
```

---

## Görev 7: Provizyon — ödeme ile üretim kaydı aynı tx'te doğar

**Files:**
- Modify: `backend/src/modules/outbox/event-types.ts` (`HardwareOrderDelivered` satırının ardı)
- Modify: `backend/src/modules/checkout/checkout.service.ts` (importlar ~1-20; `onsiteServiceLines` döngüsünün kapanışı ~428 ile `if (hardwareLines.length > 0)` bloğunun kapanışı ~429 arası)
- Test: `backend/src/modules/checkout/checkout-print3d-provision.spec.ts`

**Interfaces:**
- Consumes: `PRINT3D_BASE_SKU`, `PRINT3D_ITEM_SKU`, `PRINT3D_PARTNER` (Görev 2); `PricedLineMeta.print3dSnapshots`, `Print3dLineSnapshot` (Görev 5); `prisma.print3dJob` (Görev 2)
- Produces:
  - `EventTypes.Print3dJobCreated = "print3d.job.created.v1"`
  - Provizyon tx'inde `tx.print3dJob.create({ data: { …, items: { create: [...] } } })`
  - Outbox `idempotencyKey: "print3d-job:<hardwareOrderId>"`

- [ ] **Adım 1: Provizyon testini yaz (kırmızı)**

`backend/src/modules/checkout/checkout-print3d-provision.spec.ts`:

```ts
import { CheckoutService } from "./checkout.service";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
} from "../print3d/print3d.const";

/**
 * v3.7.0 — ödenmiş bir print3d siparişi, aynı Serializable tx içinde tam
 * olarak BİR Print3dJob ve seçilen ürün başına BİR Print3dJobItem basar.
 *
 * Snapshot alanları quote meta'sından birebir kopyalanır: menü ürünleri
 * gerçekten siliniyor ve sonraki bir menü düzenlemesi ödenmiş bir siparişi
 * yeniden yazamaz.
 */
const tenantInvoices = {
  createFromQuote: jest.fn().mockResolvedValue({ id: "inv-1" }),
};

const SNAPSHOTS = [
  {
    productId: "p-1",
    name: "Adana Kebap",
    imageUrl: "/img/adana.jpg",
    model3dUrl: "https://cdn.example/adana.glb",
    position: 0,
  },
  {
    productId: null,
    name: "Silinmiş ürün",
    imageUrl: null,
    model3dUrl: null,
    position: 1,
  },
];

function print3dQuote() {
  return {
    lines: [
      {
        type: "service",
        code: PRINT3D_BASE_SKU,
        name: "3D baskı figür — hizmet bedeli",
        qty: 1,
        unitCents: 150_000,
        subtotalCents: 150_000,
        cadence: "oneTime",
        meta: { serviceMeta: { serviceType: "print3d", role: "base" } },
      },
      {
        type: "service",
        code: PRINT3D_ITEM_SKU,
        name: "3D baskı figür — ürün başına",
        qty: 2,
        unitCents: 5_000,
        subtotalCents: 10_000,
        cadence: "oneTime",
        meta: {
          serviceMeta: { serviceType: "print3d", role: "item" },
          notes: "Kırmızı boya olsun",
          print3dProductIds: ["p-1", "p-2"],
          print3dSnapshots: SNAPSHOTS,
        },
      },
    ],
    currency: "TRY",
    subtotalCents: 133_333,
    taxCents: 26_667,
    shippingCents: 0,
    totalCents: 160_000,
    warnings: [],
    isPureRecurring: false,
  };
}

describe("CheckoutService — print3d provisioning (v3.7.0)", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let svc: CheckoutService;

  let createdOrder: any;
  let createdJobs: any[];
  let createdInstallations: any[];
  let outboxRows: any[];

  beforeEach(() => {
    createdOrder = null;
    createdJobs = [];
    createdInstallations = [];
    outboxRows = [];
    const tx = {
      hardwareOrder: {
        create: jest.fn(async (args: any) => {
          createdOrder = { id: "hw-1", ...args.data };
          return createdOrder;
        }),
      },
      hardwareOrderItem: { create: jest.fn() },
      installationRequest: {
        create: jest.fn(async (args: any) => {
          createdInstallations.push(args.data);
          return args.data;
        }),
      },
      print3dJob: {
        create: jest.fn(async (args: any) => {
          createdJobs.push(args.data);
          return { id: "job-1", ...args.data };
        }),
      },
      outboxEvent: {
        create: jest.fn(async (args: any) => {
          outboxRows.push(args.data);
          return args.data;
        }),
      },
    };
    prisma = {
      checkoutIntent: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ status: "succeeded", cartJson: { items: [] } }),
      },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = { quote: jest.fn().mockResolvedValue(print3dQuote()) };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
      tenantInvoices as any,
    );
  });

  it("mints one Print3dJob with one item per selected product, inside the provisioning tx", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-1");
    expect(createdJobs).toHaveLength(1);
    const job = createdJobs[0];
    expect(job.hwOrderId).toBe("hw-1");
    expect(job.tenantId).toBe("t-1");
    expect(job.status).toBe("queued");
    expect(job.partner).toBe("figurunica");
    expect(job.itemCount).toBe(2);
    expect(job.items.create).toHaveLength(2);
    expect(job.items.create.map((i: any) => i.position)).toEqual([0, 1]);
    expect(job.items.create.every((i: any) => i.status === "pending")).toBe(true);
  });

  it("does NOT mint an InstallationRequest for a print3d service line", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-2");
    // serviceType 'onsite' değil 'print3d' — saha ziyareti yok.
    expect(createdInstallations).toHaveLength(0);
    expect(createdOrder.installation).toBeNull();
  });

  it("snapshots name + image + model3dUrl so a later menu edit cannot rewrite the order", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-3");
    const items = createdJobs[0].items.create;
    expect(items[0]).toMatchObject({
      productId: "p-1",
      productName: "Adana Kebap",
      productImageUrl: "/img/adana.jpg",
      model3dUrl: "https://cdn.example/adana.glb",
    });
    expect(items[1]).toMatchObject({
      productId: null,
      productName: "Silinmiş ürün",
      productImageUrl: null,
      model3dUrl: null,
    });
  });

  it("freezes basePriceCents/perItemCents/totalCents from the priced lines", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-4");
    expect(createdJobs[0]).toMatchObject({
      basePriceCents: 150_000,
      perItemCents: 5_000,
      totalCents: 160_000,
      currency: "TRY",
      note: "Kırmızı boya olsun",
    });
  });

  it("emits print3d.job.created.v1 with idempotencyKey print3d-job:<orderId>", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-5");
    const ev = outboxRows.find((r) => r.type === "print3d.job.created.v1");
    expect(ev).toBeDefined();
    expect(ev.idempotencyKey).toBe("print3d-job:hw-1");
    expect(ev.payload).toMatchObject({
      tenantId: "t-1",
      hardwareOrderId: "hw-1",
      itemCount: 2,
      totalCents: 160_000,
      partner: "figurunica",
    });
  });

  it("an idempotent replay of the same paymentRef does not mint a second job", async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue({
      id: "hw-1",
      branchId: null,
      items: [],
    });
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-1");
    expect(createdJobs).toHaveLength(0);
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/checkout-print3d-provision.spec.ts`
Expected: FAIL — `mints one Print3dJob…`: `expected [] to have a length of 1 but got +0`

- [ ] **Adım 3: Olay tipini kaydet**

`backend/src/modules/outbox/event-types.ts` — `HardwareOrderDelivered: "hardware.order.delivered.v1",` satırının hemen ardına:

```ts
  // v3.7.0 — 3D baskı figür üretim işi doğdu (ödeme yerleşti).
  Print3dJobCreated: "print3d.job.created.v1",
```

- [ ] **Adım 4: Provizyon dalını yaz**

`backend/src/modules/checkout/checkout.service.ts` — import bloğuna ekle:

```ts
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  PRINT3D_PARTNER,
} from "../print3d/print3d.const";
```

`for (const l of onsiteServiceLines) { … }` döngüsünün kapanış `}`'ı ile `if (hardwareLines.length > 0)` bloğunun kapanış `}`'ı **arasına**:

```ts
          // v3.7.0 — 3D baskı figür işi. AYNI Serializable tx içinde basılır:
          // ödeme ile üretim kaydı ya birlikte var olur ya hiç.
          //
          // serviceType yalnızca 'onsite' iken InstallationRequest basılıyordu;
          // bu ikinci dal 'print3d' içindir ve InstallationRequest BASMAZ
          // (saha ziyareti yok, order.installation NULL kalır).
          //
          // Yinelenmezlik iki katmanlı: confirmAndProvision'ın paymentRef
          // idempotans kapısı PayTR yeniden denemesinde erken döner, ve
          // Print3dJob.hwOrderId üzerindeki @unique bunu veritabanı düzeyinde
          // de garanti eder.
          const p3dItemLine = hardwareLines.find(
            (l) => l.type === "service" && l.code === PRINT3D_ITEM_SKU,
          );
          const p3dBaseLine = hardwareLines.find(
            (l) => l.type === "service" && l.code === PRINT3D_BASE_SKU,
          );
          if (p3dItemLine && p3dBaseLine) {
            const snapshots = p3dItemLine.meta?.print3dSnapshots ?? [];
            const p3dTotalCents =
              p3dBaseLine.subtotalCents + p3dItemLine.subtotalCents;
            await tx.print3dJob.create({
              data: {
                id: uuidv7(),
                tenantId,
                branchId: validatedBranchId,
                hwOrderId: order.id,
                status: "queued",
                partner: PRINT3D_PARTNER,
                basePriceCents: p3dBaseLine.unitCents,
                perItemCents: p3dItemLine.unitCents,
                itemCount: p3dItemLine.qty,
                totalCents: p3dTotalCents,
                currency: quote.currency,
                note: p3dItemLine.meta?.notes ?? null,
                items: {
                  create: snapshots.map((s) => ({
                    id: uuidv7(),
                    productId: s.productId,
                    productName: s.name,
                    productImageUrl: s.imageUrl,
                    model3dUrl: s.model3dUrl,
                    position: s.position,
                    status: "pending",
                  })),
                },
              },
            });
            await tx.outboxEvent.create({
              data: {
                id: uuidv7(),
                type: EventTypes.Print3dJobCreated,
                tenantId,
                payload: {
                  tenantId,
                  hardwareOrderId: order.id,
                  itemCount: p3dItemLine.qty,
                  totalCents: p3dTotalCents,
                  partner: PRINT3D_PARTNER,
                } as any,
                // Sabit anahtar (uuidv7 DEĞİL): bir yeniden deneme aynı
                // siparişe ikinci bir "iş doğdu" olayı yazmasın.
                idempotencyKey: `print3d-job:${order.id}`,
                status: "queued",
                nextAttemptAt: new Date(),
              },
            });
          }
```

- [ ] **Adım 5: Testi yeşil gör ve komşuyu regresyona karşı çalıştır**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/checkout-print3d-provision.spec.ts src/modules/checkout/checkout-install-trigger.spec.ts
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
```
Expected: `checkout-print3d-provision.spec.ts` `6 passed`; install-trigger suite'i hâlâ tamamen yeşil; `tsc` çıktısız.

- [ ] **Adım 6: Commit**

```bash
git add backend/src/modules/outbox/event-types.ts backend/src/modules/checkout/checkout.service.ts backend/src/modules/checkout/checkout-print3d-provision.spec.ts
git commit -m "feat(checkout): ödenmiş print3d siparişi üretim işini aynı tx'te basıyor

Print3dJob + N adet Print3dJobItem, HardwareOrder ile AYNI Serializable
transaction içinde doğuyor: ödeme ile üretim kaydı ya birlikte var olur ya
hiç. Kalemler ad/foto/model3dUrl anlık görüntüsünü quote meta'sından birebir
donduruyor — menü ürünleri gerçekten siliniyor ve sonraki bir menü
düzenlemesi ödenmiş siparişi yeniden yazamaz.

print3d hizmet satırı InstallationRequest BASMIYOR (saha ziyareti yok).

print3d.job.created.v1 olayının idempotencyKey'i sabit (print3d-job:<orderId>),
yani PayTR yeniden denemesi ikinci bir olay yazmıyor."
```

---

## Görev 8: `Print3dModule` + `getOffer()` — fiyat ve ortak rozeti sunucudan

**Files:**
- Create: `backend/src/modules/print3d/print3d.service.ts`
- Create: `backend/src/modules/print3d/print3d.controller.ts`
- Create: `backend/src/modules/print3d/print3d.module.ts`
- Modify: `backend/src/app.module.ts` (import listesi ~53-61; `imports` dizisi ~149-163)
- Modify: `backend/src/common/helpers/env-validation.ts` (`RULES` dizisi ~43-75)
- Modify: `backend/.env.example` (dosya sonu)
- Test: `backend/src/modules/print3d/print3d.service.spec.ts`

**Interfaces:**
- Consumes: `PRINT3D_*` sabitleri (Görev 2)
- Produces:
  - `export function sanitizePartnerUrl(raw: string | null | undefined): string | null`
  - `export interface Print3dOffer { available: boolean; basePriceCents: number; perItemCents: number; currency: string; minItems: number; maxItems: number; partnerName: string; partnerUrl: string | null }`
  - `Print3dService.getOffer(): Promise<Print3dOffer>`
  - `Print3dModule` (`exports: [Print3dService]`)
  - HTTP: `GET /v1/print3d/offer`

- [ ] **Adım 1: Teklif testlerini yaz (kırmızı)**

`backend/src/modules/print3d/print3d.service.spec.ts`:

```ts
import { Print3dService, sanitizePartnerUrl } from "./print3d.service";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  PRINT3D_PARTNER_URL_DEFAULT,
} from "./print3d.const";

describe("Print3dService — offer", () => {
  let prisma: any;
  let config: any;
  let svc: Print3dService;

  const rows = (over: Record<string, any> = {}) => [
    {
      sku: PRINT3D_BASE_SKU,
      priceCents: 150_000,
      currency: "TRY",
      status: "published",
      saleMode: "DIRECT_SALE",
      ...(over[PRINT3D_BASE_SKU] ?? {}),
    },
    {
      sku: PRINT3D_ITEM_SKU,
      priceCents: 5_000,
      currency: "TRY",
      status: "published",
      saleMode: "DIRECT_SALE",
      ...(over[PRINT3D_ITEM_SKU] ?? {}),
    },
  ];

  beforeEach(() => {
    prisma = {
      hardwareProduct: { findMany: jest.fn().mockResolvedValue(rows()) },
      print3dJob: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      print3dJobItem: { update: jest.fn(), findFirst: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    svc = new Print3dService(prisma, config);
  });

  it("getOffer reads live prices from the two catalog rows, never the constants", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue(
      rows({ [PRINT3D_BASE_SKU]: { priceCents: 160_000 } }),
    );
    const offer = await svc.getOffer();
    expect(offer.basePriceCents).toBe(160_000);
    expect(offer.perItemCents).toBe(5_000);
    expect(offer.available).toBe(true);
    expect(offer.minItems).toBe(1);
    expect(offer.maxItems).toBe(50);
  });

  it("getOffer reports available:false when either SKU is unpublished", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue(
      rows({ [PRINT3D_ITEM_SKU]: { status: "archived" } }),
    );
    expect((await svc.getOffer()).available).toBe(false);
  });

  it("getOffer reports available:false when either SKU is not DIRECT_SALE", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue(
      rows({ [PRINT3D_BASE_SKU]: { saleMode: "QUOTE_ONLY" } }),
    );
    expect((await svc.getOffer()).available).toBe(false);
  });

  it("getOffer reports available:false when a catalog row is missing entirely", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue([rows()[0]]);
    expect((await svc.getOffer()).available).toBe(false);
  });

  it("getOffer falls back to https://figurunica.com when PRINT3D_PARTNER_URL is unset", async () => {
    const offer = await svc.getOffer();
    expect(offer.partnerUrl).toBe(PRINT3D_PARTNER_URL_DEFAULT);
    expect(offer.partnerName).toBe("Figurunica");
  });

  it("getOffer prefers PRINT3D_PARTNER_URL over the built-in default", async () => {
    config.get.mockReturnValue("https://partner.example");
    expect((await svc.getOffer()).partnerUrl).toBe("https://partner.example");
  });

  it("getOffer rejects a non-http(s) PRINT3D_PARTNER_URL", async () => {
    config.get.mockReturnValue("javascript:alert(1)");
    // Varsayılana DÜŞMEZ: açık bir yanlış yapılandırma sessizce düzeltilmez.
    // Rozet metni yine boş değil — bileşen <span>'e düşer.
    expect((await svc.getOffer()).partnerUrl).toBeNull();
  });
});

describe("sanitizePartnerUrl", () => {
  it("accepts http and https", () => {
    expect(sanitizePartnerUrl("https://figurunica.com")).toBe(
      "https://figurunica.com",
    );
    expect(sanitizePartnerUrl("http://figurunica.com")).toBe(
      "http://figurunica.com",
    );
  });

  it("rejects javascript:, protocol-relative and empty values", () => {
    expect(sanitizePartnerUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePartnerUrl("//evil.example")).toBeNull();
    expect(sanitizePartnerUrl("")).toBeNull();
    expect(sanitizePartnerUrl(undefined)).toBeNull();
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d/print3d.service.spec.ts`
Expected: FAIL — `Cannot find module './print3d.service' from 'src/modules/print3d/print3d.service.spec.ts'`

- [ ] **Adım 3: `Print3dService` iskeletini + `getOffer` yaz**

`backend/src/modules/print3d/print3d.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  PRINT3D_MAX_ITEMS,
  PRINT3D_MIN_ITEMS,
  PRINT3D_PARTNER_LABEL,
  PRINT3D_PARTNER_URL_DEFAULT,
} from "./print3d.const";

/**
 * Yalnızca `http(s)://` ile başlayan bir değeri yayınla.
 *
 * Açık yönlendirme / `javascript:` yükü koruması. Bozuk bir env değeri
 * varsayılana DÜŞMEZ — açık bir yanlış yapılandırmayı sessizce düzeltmek,
 * operatörün hatayı hiç görmemesi demektir. Rozet metni yine boş kalmaz:
 * SPA bileşeni `null` gördüğünde düz metne düşer.
 */
export function sanitizePartnerUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

export interface Print3dOffer {
  /** İki SKU da published + DIRECT_SALE değilse false → SPA kartı gizler. */
  available: boolean;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
  minItems: number;
  maxItems: number;
  partnerName: string;
  partnerUrl: string | null;
}

@Injectable()
export class Print3dService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fiyatlar HER ZAMAN katalog satırlarından CANLI okunur, sabitlerden değil:
   * bir yeniden fiyatlama deploy istememeli. Sabitler yalnızca tohum/migration
   * kaynağı ve sürüklenme testi içindir.
   */
  async getOffer(): Promise<Print3dOffer> {
    const rows = await this.prisma.hardwareProduct.findMany({
      where: { sku: { in: [PRINT3D_BASE_SKU, PRINT3D_ITEM_SKU] } },
      select: {
        sku: true,
        priceCents: true,
        currency: true,
        status: true,
        saleMode: true,
      },
    });
    const base = rows.find((r) => r.sku === PRINT3D_BASE_SKU);
    const item = rows.find((r) => r.sku === PRINT3D_ITEM_SKU);
    const sellable = (r?: { status: string; saleMode: string | null }) =>
      !!r && r.status === "published" && r.saleMode === "DIRECT_SALE";

    return {
      available: sellable(base) && sellable(item),
      basePriceCents: base?.priceCents ?? 0,
      perItemCents: item?.priceCents ?? 0,
      currency: base?.currency ?? "TRY",
      minItems: PRINT3D_MIN_ITEMS,
      maxItems: PRINT3D_MAX_ITEMS,
      partnerName: PRINT3D_PARTNER_LABEL,
      partnerUrl: sanitizePartnerUrl(
        this.config.get<string>("PRINT3D_PARTNER_URL") ??
          PRINT3D_PARTNER_URL_DEFAULT,
      ),
    };
  }
}
```

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d/print3d.service.spec.ts`
Expected: PASS — `9 passed`.

- [ ] **Adım 5: Kiracı controller'ını ve modülü yaz**

`backend/src/modules/print3d/print3d.controller.ts`:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { Print3dService } from "./print3d.service";

/**
 * Kiracı yüzeyi.
 *
 * @SkipBranchScope YOK ve olmamalı: /v1/checkout de şube kapsamlı ve SPA zaten
 * X-Branch-Id gönderiyor. frontend/src/lib/api.ts'teki tenant-wide önek
 * listesine de ekleme YAPILMAZ.
 */
@ApiTags("Print3D")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller("v1/print3d")
export class Print3dController {
  constructor(private readonly print3d: Print3dService) {}

  @Get("offer")
  @ApiOperation({
    summary: "3D baskı figür teklifi — canlı fiyat + üretim ortağı rozeti",
  })
  offer() {
    return this.print3d.getOffer();
  }
}
```

`backend/src/modules/print3d/print3d.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { Print3dService } from "./print3d.service";
import { Print3dController } from "./print3d.controller";

@Module({
  imports: [PrismaModule],
  controllers: [Print3dController],
  providers: [Print3dService],
  exports: [Print3dService],
})
export class Print3dModule {}
```

`backend/src/app.module.ts` — import bloğuna `import { Print3dModule } from "./modules/print3d/print3d.module";` (`FulfillmentModule` importunun yanına) ve `imports` dizisine `Print3dModule,` (`FulfillmentModule,` satırının yanına).

> **`checkout.module.ts` DEĞİŞTİRİLMEZ — bilinçli sapma.** Spec'in kontrol listesi
> `CheckoutModule.imports`'a `Print3dModule` eklenmesini öngörüyordu, ama
> `CheckoutService` `Print3dService`'i **enjekte etmiyor**: provizyon dalı (Görev 7)
> doğrudan `tx.print3dJob` üzerinden yazıyor. Kullanılmayan bir modülü import etmek
> DI grafiğini yanıltıcı kılar ("checkout print3d'ye bağımlı" der, değil) ve ileride
> bir döngü riski taşır. Bağımlılık gerçekten doğarsa import o zaman eklenir.

- [ ] **Adım 6: Env kuralını ve `.env.example`'ı ekle**

`backend/src/common/helpers/env-validation.ts` — `RULES` dizisine, `{ key: "SENTRY_DSN", required: false, prodOnly: true },` satırının ardına:

```ts
  // v3.7.0 — 3D baskı üretim ortağının sitesi. OPSİYONEL: boş bırakılırsa kod
  // varsayılanı (https://figurunica.com) kullanılır. Yalnızca ticari taraf
  // değişirse doldurulur; VITE_ değişkeni bundle'a gömüleceği ve platform-üstü
  // bir ayar tablosu olmadığı için değer backend'de durur.
  { key: "PRINT3D_PARTNER_URL", required: false },
```

`backend/.env.example` — dosyanın sonuna:

```
# ── 3D baskı figür hizmeti (üretim ortağı) ─────────────────────────────
# Rozetin işaret ettiği ortak sitesi. BOŞ BIRAKILIRSA kod varsayılanı
# (https://figurunica.com) kullanılır — yalnızca ticari taraf değişirse
# doldurun. Sunucu yalnızca http(s):// ile başlayan bir değeri yayınlar;
# başka bir şey yazarsanız rozet düz metne düşer (bağlantı basılmaz).
PRINT3D_PARTNER_URL=
```

- [ ] **Adım 7: Boot ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d
cd /home/tarik/Projects/kds/backend && npm run lint:ci
```
Expected: `tsc` çıktısız; jest PASS; lint temiz (`npm run lint` KULLANMA — `--fix` taşır ve hatayı gizler).

- [ ] **Adım 8: Commit**

```bash
git add backend/src/modules/print3d/print3d.service.ts backend/src/modules/print3d/print3d.service.spec.ts backend/src/modules/print3d/print3d.controller.ts backend/src/modules/print3d/print3d.module.ts backend/src/app.module.ts backend/src/common/helpers/env-validation.ts backend/.env.example
git commit -m "feat(print3d): teklif uç noktası — canlı fiyat ve ortak rozeti

GET /v1/print3d/offer fiyatları iki katalog satırından CANLI okuyor;
sabitler yalnızca tohum/migration kaynağı. Satırlardan biri published +
DIRECT_SALE değilse available:false döner ve SPA kartı hiç basmaz.

partnerUrl varsayılanı https://figurunica.com; opsiyonel PRINT3D_PARTNER_URL
env değişkeni ezebiliyor. Sunucu yalnızca http(s) şemasını yayınlıyor ve
bozuk bir değerde varsayılana DÜŞMÜYOR — açık bir yanlış yapılandırma
sessizce düzeltilmemeli."
```

---

## Görev 9: Kiracı iş okumaları — ödenmiş sipariş boş kalem tablosu göstermesin

Hizmet satırları `HardwareOrderItem` üretmiyor, bu yüzden ödenmiş bir ₺2.000'lik print3d siparişi bugün **boş kalem tablosu + sıfır-olmayan toplam** gösterir.

**Files:**
- Modify: `backend/src/modules/print3d/print3d.service.ts` (`getOffer` altına)
- Modify: `backend/src/modules/print3d/print3d.controller.ts`
- Modify: `backend/src/modules/checkout/hardware-orders.service.ts` (`listMine` ~14-40; `getMine` ~43-52)
- Test: `backend/src/modules/print3d/print3d.service.spec.ts` (aynı dosyaya yeni `describe`)

**Interfaces:**
- Consumes: `Print3dService` (Görev 8), `prisma.print3dJob` (Görev 2)
- Produces:
  - `Print3dService.listMine(tenantId: string): Promise<Print3dJobWithItems[]>`
  - `Print3dService.getMine(tenantId: string, id: string): Promise<Print3dJobWithItems>` (bulunamazsa `NotFoundException`)
  - HTTP: `GET /v1/print3d/jobs`, `GET /v1/print3d/jobs/:id`
  - `HardwareOrdersService.listMine` / `getMine` yanıtlarında `print3dJob` alanı: `{ id, status, itemCount, totalCents, partner, items: { productName, productImageUrl, position, status }[] }`

- [ ] **Adım 1: Kiracı çiti testini yaz (kırmızı)**

`backend/src/modules/print3d/print3d.service.spec.ts` — dosyanın sonuna:

```ts
describe("Print3dService — tenant reads", () => {
  let prisma: any;
  let svc: Print3dService;

  beforeEach(() => {
    prisma = {
      hardwareProduct: { findMany: jest.fn() },
      print3dJob: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      print3dJobItem: { update: jest.fn(), findFirst: jest.fn() },
    };
    svc = new Print3dService(prisma, { get: jest.fn() } as any);
  });

  it("listMine is tenant-fenced", async () => {
    await svc.listMine("t-1");
    expect(prisma.print3dJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t-1" } }),
    );
  });

  it("getMine uses a composite tenant+id WHERE, never a bare id lookup", async () => {
    prisma.print3dJob.findFirst.mockResolvedValue({ id: "job-1", items: [] });
    await svc.getMine("t-1", "job-1");
    expect(prisma.print3dJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", tenantId: "t-1" } }),
    );
  });

  it("getMine throws NotFound for another tenant's job", async () => {
    prisma.print3dJob.findFirst.mockResolvedValue(null);
    await expect(svc.getMine("t-1", "job-of-t2")).rejects.toThrow(
      "3D baskı işi bulunamadı",
    );
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d/print3d.service.spec.ts -t "tenant reads"`
Expected: FAIL — `svc.listMine is not a function`

- [ ] **Adım 3: Okumaları servise ekle**

`backend/src/modules/print3d/print3d.service.ts` — `NotFoundException`'ı import et (`import { Injectable, NotFoundException } from "@nestjs/common";`) ve `getOffer()`'ın ardına:

```ts
  /**
   * Kalem + sipariş + kargo, kiracı ekranının tek çağrıda ihtiyacı olan her şey.
   * `hwOrder.shipments` burada: kargo durumu Shipment'ta yaşıyor, Print3dJob
   * yalnızca ÜRETİMİ izliyor.
   */
  private readonly jobInclude = {
    items: { orderBy: { position: "asc" as const } },
    hwOrder: {
      select: {
        id: true,
        status: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        shippingAddress: true,
        shipments: {
          select: {
            id: true,
            carrier: true,
            trackingNo: true,
            status: true,
            shippedAt: true,
            deliveredAt: true,
          },
        },
      },
    },
  };

  async listMine(tenantId: string) {
    return this.prisma.print3dJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: this.jobInclude,
    });
  }

  async getMine(tenantId: string, id: string) {
    // BİLEŞİK WHERE. `findUnique({ where: { id } })` + sonradan tenant kontrolü
    // deseni bu repoda daha önce sızıntı üretti; çit sorgunun İÇİNDE olmalı.
    const row = await this.prisma.print3dJob.findFirst({
      where: { id, tenantId },
      include: this.jobInclude,
    });
    if (!row) throw new NotFoundException("3D baskı işi bulunamadı");
    return row;
  }
```

- [ ] **Adım 4: Controller'a iki uç nokta ekle**

`backend/src/modules/print3d/print3d.controller.ts` — `Param`, `Req` importlarını ekle ve sınıfa:

```ts
  @Get("jobs")
  @ApiOperation({ summary: "Kiracının 3D baskı işleri (kalem + kargo dahil)" })
  listMine(@Req() req: any) {
    return this.print3d.listMine(req.user.tenantId);
  }

  @Get("jobs/:id")
  @ApiOperation({ summary: "Tek 3D baskı işi" })
  getMine(@Req() req: any, @Param("id") id: string) {
    return this.print3d.getMine(req.user.tenantId, id);
  }
```

- [ ] **Adım 5: `HardwareOrdersService` include'larını genişlet**

`backend/src/modules/checkout/hardware-orders.service.ts` — `listMine` ve `getMine` içindeki `include` nesnelerinin **her ikisine** aynı bloğu ekle:

```ts
        // v3.7.0 — hizmet satırları HardwareOrderItem üretmiyor, bu yüzden
        // yalnız-hizmet bir print3d siparişi boş kalem tablosu + sıfır-olmayan
        // toplam gösteriyordu. Kiracı ekranı işi buradan okur.
        print3dJob: {
          select: {
            id: true,
            status: true,
            itemCount: true,
            totalCents: true,
            partner: true,
            items: {
              select: {
                productName: true,
                productImageUrl: true,
                position: true,
                status: true,
              },
              orderBy: { position: "asc" },
            },
          },
        },
```

- [ ] **Adım 6: Testleri yeşil gör**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d src/modules/checkout
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
```
Expected: PASS / çıktısız.

- [ ] **Adım 7: Commit**

```bash
git add backend/src/modules/print3d/print3d.service.ts backend/src/modules/print3d/print3d.service.spec.ts backend/src/modules/print3d/print3d.controller.ts backend/src/modules/checkout/hardware-orders.service.ts
git commit -m "feat(print3d): kiracı iş okumaları ve sipariş include'u

GET /v1/print3d/jobs + /jobs/:id, kalem ve kargo dahil. Çit sorgunun İÇİNDE:
getMine bileşik { id, tenantId } WHERE kullanıyor.

hardware-orders okumaları da print3dJob'ı include ediyor — hizmet satırları
HardwareOrderItem üretmediği için ödenmiş bir print3d siparişi bugüne kadar
boş kalem tablosu ve sıfır-olmayan toplam gösteriyordu."
```

---

## Görev 10: Superadmin üretim kuyruğu ve durum geçiş makinesi

**Files:**
- Create: `backend/src/modules/print3d/dto/print3d-ops.dto.ts`
- Create: `backend/src/modules/print3d/superadmin-print3d.controller.ts`
- Modify: `backend/src/modules/print3d/print3d.service.ts`
- Modify: `backend/src/modules/print3d/print3d.module.ts` (`controllers`)
- Test: `backend/src/modules/print3d/print3d.service.spec.ts` (yeni `describe`)

**Interfaces:**
- Consumes: `PRINT3D_JOB_STATUSES`, `PRINT3D_ITEM_STATUSES`, `Print3dJobStatus`, `Print3dItemStatus` (Görev 2); `Print3dService` (Görev 8)
- Produces:
  - `class UpdatePrint3dJobStatusDto { status: Print3dJobStatus; partnerRef?: string; opsNote?: string }`
  - `class UpdatePrint3dJobItemDto { status: Print3dItemStatus; opsNote?: string }`
  - `Print3dService.listQueue(filters: { status?: string; partner?: string })` — her satıra `tenantName: string | null` ekler
  - `Print3dService.getJob(id: string)` — `tenantName` + `hwOrder { id, status, shippingAddress, shipments }`
  - `Print3dService.updateStatus(id: string, dto: UpdatePrint3dJobStatusDto)`
  - `Print3dService.updateItem(jobId: string, itemId: string, dto: UpdatePrint3dJobItemDto)`
  - HTTP: `GET /v1/superadmin/print3d/jobs`, `GET /jobs/:id`, `PATCH /jobs/:id/status`, `PATCH /jobs/:id/items/:itemId`

- [ ] **Adım 1: Geçiş testlerini yaz (kırmızı)**

`backend/src/modules/print3d/print3d.service.spec.ts` — dosyanın sonuna:

```ts
describe("Print3dService — production queue + transitions", () => {
  let prisma: any;
  let svc: Print3dService;
  let updated: any;

  const job = (status: string) => ({ id: "job-1", status, tenantId: "t-1" });

  beforeEach(() => {
    updated = null;
    prisma = {
      hardwareProduct: { findMany: jest.fn() },
      // withTenantNames ayrı bir sorgu atıyor (Print3dJob'ta Tenant ilişkisi
      // yok); mock'ta olmazsa listQueue "findMany of undefined" ile patlar.
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      print3dJob: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(async (args: any) => {
          updated = args.data;
          return { id: "job-1", ...args.data };
        }),
      },
      print3dJobItem: {
        findFirst: jest.fn().mockResolvedValue({ id: "item-1", jobId: "job-1" }),
        update: jest.fn(async (args: any) => args.data),
      },
    };
    svc = new Print3dService(prisma, { get: jest.fn() } as any);
  });

  it("allows queued -> in_production -> produced and refuses produced -> queued", async () => {
    prisma.print3dJob.findUnique.mockResolvedValue(job("queued"));
    await svc.updateStatus("job-1", { status: "in_production" });
    expect(updated.status).toBe("in_production");

    prisma.print3dJob.findUnique.mockResolvedValue(job("in_production"));
    await svc.updateStatus("job-1", { status: "produced" });
    expect(updated.status).toBe("produced");

    prisma.print3dJob.findUnique.mockResolvedValue(job("produced"));
    await expect(
      svc.updateStatus("job-1", { status: "queued" }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INVALID_TRANSITION", from: "produced", to: "queued" },
    });
  });

  it("allows cancelling from queued and in_production but not from produced", async () => {
    for (const from of ["queued", "in_production"]) {
      prisma.print3dJob.findUnique.mockResolvedValue(job(from));
      await svc.updateStatus("job-1", { status: "cancelled" });
      expect(updated.status).toBe("cancelled");
    }
    prisma.print3dJob.findUnique.mockResolvedValue(job("produced"));
    await expect(
      svc.updateStatus("job-1", { status: "cancelled" }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INVALID_TRANSITION" },
    });
  });

  it("stamps producedAt / cancelledAt on the terminal transitions", async () => {
    prisma.print3dJob.findUnique.mockResolvedValue(job("in_production"));
    await svc.updateStatus("job-1", { status: "produced" });
    expect(updated.producedAt).toBeInstanceOf(Date);
    expect(updated.cancelledAt).toBeUndefined();

    prisma.print3dJob.findUnique.mockResolvedValue(job("queued"));
    await svc.updateStatus("job-1", { status: "cancelled", opsNote: "iptal" });
    expect(updated.cancelledAt).toBeInstanceOf(Date);
    expect(updated.opsNote).toBe("iptal");
  });

  it("throws NotFound for an unknown job id", async () => {
    prisma.print3dJob.findUnique.mockResolvedValue(null);
    await expect(
      svc.updateStatus("nope", { status: "in_production" }),
    ).rejects.toThrow("3D baskı işi bulunamadı");
  });

  it("listQueue filters by status and partner and spans every tenant", async () => {
    await svc.listQueue({ status: "queued", partner: "figurunica" });
    expect(prisma.print3dJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "queued", partner: "figurunica" },
      }),
    );
  });

  it("updateItem refuses an itemId that belongs to another job", async () => {
    prisma.print3dJobItem.findFirst.mockResolvedValue(null);
    await expect(
      svc.updateItem("job-1", "item-of-another-job", { status: "printed" }),
    ).rejects.toThrow("3D baskı kalemi bulunamadı");
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d/print3d.service.spec.ts -t "production queue"`
Expected: FAIL — `svc.updateStatus is not a function`

- [ ] **Adım 3: DTO'ları yaz**

`backend/src/modules/print3d/dto/print3d-ops.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  PRINT3D_ITEM_STATUSES,
  PRINT3D_JOB_STATUSES,
  Print3dItemStatus,
  Print3dJobStatus,
} from "../print3d.const";

export class UpdatePrint3dJobStatusDto {
  @ApiProperty({ enum: PRINT3D_JOB_STATUSES })
  @IsIn(PRINT3D_JOB_STATUSES as unknown as string[])
  status!: Print3dJobStatus;

  /** Figurunica'nın kendi iş numarası; operatör panelden girer. */
  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  partnerRef?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  opsNote?: string;
}

export class UpdatePrint3dJobItemDto {
  @ApiProperty({ enum: PRINT3D_ITEM_STATUSES })
  @IsIn(PRINT3D_ITEM_STATUSES as unknown as string[])
  status!: Print3dItemStatus;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  opsNote?: string;
}
```

- [ ] **Adım 4: Kuyruk + geçiş makinesini servise ekle**

`backend/src/modules/print3d/print3d.service.ts` — `BadRequestException`'ı da import et ve sınıfa ekle:

```ts
  /**
   * İzinli geçişler. `produced` ve `cancelled` TERMİNAL: bir işi "geri almak"
   * üretim gerçeğini değiştirmez, yeni bir sipariş gerektirir.
   */
  private static readonly TRANSITIONS: Record<string, readonly string[]> = {
    queued: ["in_production", "cancelled"],
    in_production: ["produced", "cancelled"],
    produced: [],
    cancelled: [],
  };

  /**
   * Kuyruk satırlarına kiracı adını ekler.
   *
   * `include: { tenant: … }` KULLANILAMAZ: Print3dJob'ta `tenantId` düz bir
   * kolon, Tenant ilişkisi TANIMLI DEĞİL (InstallationRequest da aynı) —
   * Prisma böyle bir include'u reddeder. Adlar ayrı bir sorguyla eşlenir.
   */
  private async withTenantNames<T extends { tenantId: string }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.tenantId))];
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => ({
      ...r,
      tenantName: nameById.get(r.tenantId) ?? null,
    }));
  }

  async listQueue(filters: { status?: string; partner?: string } = {}) {
    const rows = await this.prisma.print3dJob.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.partner ? { partner: filters.partner } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { items: { orderBy: { position: "asc" } } },
    });
    return this.withTenantNames(rows);
  }

  async getJob(id: string) {
    const row = await this.prisma.print3dJob.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: "asc" } },
        hwOrder: {
          select: {
            id: true,
            status: true,
            shippingAddress: true,
            shipments: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException("3D baskı işi bulunamadı");
    return (await this.withTenantNames([row]))[0];
  }

  async updateStatus(id: string, dto: UpdatePrint3dJobStatusDto) {
    const job = await this.prisma.print3dJob.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!job) throw new NotFoundException("3D baskı işi bulunamadı");
    const allowed = Print3dService.TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException({
        code: "PRINT3D_INVALID_TRANSITION",
        from: job.status,
        to: dto.status,
        message: `'${job.status}' durumundan '${dto.status}' durumuna geçilemez.`,
      });
    }
    return this.prisma.print3dJob.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.partnerRef !== undefined ? { partnerRef: dto.partnerRef } : {}),
        ...(dto.opsNote !== undefined ? { opsNote: dto.opsNote } : {}),
        ...(dto.status === "produced" ? { producedAt: new Date() } : {}),
        ...(dto.status === "cancelled" ? { cancelledAt: new Date() } : {}),
      },
    });
  }

  async updateItem(jobId: string, itemId: string, dto: UpdatePrint3dJobItemDto) {
    // Bileşik arama: bir itemId'nin BU işe ait olduğu doğrulanmadan
    // güncellenmesi, operatörün yanlış siparişin kalemini "basıldı"
    // işaretlemesine yol açardı.
    const item = await this.prisma.print3dJobItem.findFirst({
      where: { id: itemId, jobId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("3D baskı kalemi bulunamadı");
    return this.prisma.print3dJobItem.update({
      where: { id: itemId },
      data: {
        status: dto.status,
        ...(dto.opsNote !== undefined ? { opsNote: dto.opsNote } : {}),
      },
    });
  }
```

Import satırına DTO'ları ekle:

```ts
import {
  UpdatePrint3dJobItemDto,
  UpdatePrint3dJobStatusDto,
} from "./dto/print3d-ops.dto";
```

> `listQueue` ve `getJob` yanıtları `tenantName` alanını taşır ve SPA paneli (Görev 21) bunu okur. Sunucu tarafında ayrı sorgu tercih edilmesinin tek sebebi `Print3dJob`'ta Tenant ilişkisinin tanımlı olmaması; ilişki eklemek şemayı gereksizce genişletirdi (`InstallationRequest` de aynı deseni kullanıyor).

- [ ] **Adım 5: Superadmin controller'ını yaz ve modüle ekle**

`backend/src/modules/print3d/superadmin-print3d.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";
import { Print3dService } from "./print3d.service";
import {
  UpdatePrint3dJobItemDto,
  UpdatePrint3dJobStatusDto,
} from "./dto/print3d-ops.dto";

/**
 * Üretim kuyruğu. Manifesto kiracının menü fotoğraflarını ve teslimat
 * adresini taşıdığı için yalnızca @SuperAdminRoute() arkasında.
 *
 * Kargo için YENİ endpoint yok: panel mevcut
 * POST /v1/superadmin/shipments/:orderId rayını çağırır.
 */
@ApiTags("SuperAdmin · Print3D")
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller("v1/superadmin/print3d")
export class SuperadminPrint3dController {
  constructor(private readonly print3d: Print3dService) {}

  @Get("jobs")
  @ApiOperation({ summary: "Tüm kiracıların 3D baskı üretim kuyruğu" })
  list(@Query("status") status?: string, @Query("partner") partner?: string) {
    return this.print3d.listQueue({ status, partner });
  }

  @Get("jobs/:id")
  @ApiOperation({ summary: "Figurunica manifestosu — kalemler + adres" })
  get(@Param("id") id: string) {
    return this.print3d.getJob(id);
  }

  @Patch("jobs/:id/status")
  updateStatus(@Param("id") id: string, @Body() body: UpdatePrint3dJobStatusDto) {
    return this.print3d.updateStatus(id, body);
  }

  @Patch("jobs/:id/items/:itemId")
  updateItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: UpdatePrint3dJobItemDto,
  ) {
    return this.print3d.updateItem(id, itemId, body);
  }
}
```

`backend/src/modules/print3d/print3d.module.ts` — `controllers: [Print3dController, SuperadminPrint3dController],` yap ve importu ekle.

- [ ] **Adım 6: Testleri yeşil gör**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/print3d
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/backend && npm run lint:ci
```
Expected: PASS / çıktısız / temiz.

- [ ] **Adım 7: Commit**

```bash
git add backend/src/modules/print3d
git commit -m "feat(print3d): superadmin üretim kuyruğu ve durum geçiş makinesi

queued -> in_production -> produced; queued|in_production -> cancelled.
produced ve cancelled terminal — bir işi geri almak üretim gerçeğini
değiştirmez. Geçersiz geçiş PRINT3D_INVALID_TRANSITION veriyor, terminal
geçişler producedAt/cancelledAt damgalıyor.

Kalem güncellemesi bileşik { id, jobId } arıyor: operatör yanlış siparişin
kalemini 'basıldı' işaretleyemesin.

Kargo için yeni endpoint YOK — panel mevcut superadmin/shipments rayını
çağıracak."
```

---

## Görev 11: Sipariş e-postası boş kalem tablosu yollamasın

**Files:**
- Modify: `backend/src/modules/checkout/checkout-notifications.service.ts` (`sendOrderPlacedEmail` `include` ~81; `items` eşlemesi ~125-129)
- Test: `backend/src/modules/checkout/checkout-notifications-print3d.spec.ts`

**Interfaces:**
- Consumes: `prisma.hardwareOrder.print3dJob` ilişkisi (Görev 2)
- Produces: e-posta `items` dizisinde sentetik satır `{ name: "3D baskı figür — N ürün (üretim ortağı: Figurunica)", qty: N, lineTotal: "<tutar> TRY" }`

- [ ] **Adım 1: Testi yaz (kırmızı)**

`backend/src/modules/checkout/checkout-notifications-print3d.spec.ts`:

```ts
import { CheckoutNotificationsService } from "./checkout-notifications.service";

/**
 * Yalnız-hizmet siparişinde hardware_order_items BOŞTUR (hizmet satırları
 * HardwareOrderItem üretmiyor), yani alıcı bugüne kadar ₺2.000'lik bir
 * siparişin ardından BOŞ kalem tablolu bir e-posta alıyordu.
 */
describe("CheckoutNotificationsService — print3d order email", () => {
  let prisma: any;
  let email: any;
  let svc: CheckoutNotificationsService;

  beforeEach(() => {
    prisma = {
      hardwareOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: "hw-abcdef12",
          currency: "TRY",
          totalCents: 200_000,
          shippingAddress: null,
          items: [],
          print3dJob: {
            id: "job-1",
            itemCount: 10,
            totalCents: 200_000,
            items: [],
          },
        }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          name: "Test Restoran",
          reportEmails: ["ops@test.com"],
          users: [],
        }),
      },
    };
    email = { sendTemplate: jest.fn().mockResolvedValue(undefined) };
    svc = new CheckoutNotificationsService(
      prisma,
      email,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
    );
  });

  it("renders a synthetic 3D print line instead of an empty item table", async () => {
    await svc.sendOrderPlacedEmail({
      tenantId: "t-1",
      hardwareOrderId: "hw-abcdef12",
    } as any);
    const ctx = email.sendTemplate.mock.calls[0].at(-1);
    const items = (ctx.items ?? ctx.context?.items) as any[];
    expect(items).toHaveLength(1);
    expect(items[0].name).toContain("3D baskı figür");
    expect(items[0].name).toContain("10 ürün");
    expect(items[0].name).toContain("Figurunica");
    expect(items[0].qty).toBe(10);
    expect(items[0].lineTotal).toBe("2000.00 TRY");
  });

  it("includes the print3dJob relation in the order lookup", async () => {
    await svc.sendOrderPlacedEmail({
      tenantId: "t-1",
      hardwareOrderId: "hw-abcdef12",
    } as any);
    expect(prisma.hardwareOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ print3dJob: expect.anything() }),
      }),
    );
  });
});
```

> `CheckoutNotificationsService` yapıcısının gerçek parametre sırasını dosyadan oku (`constructor(` bloğu ~30-40 satır) ve yukarıdaki bare-construct çağrısını ona göre düzelt; `email.sendTemplate` yerine gerçek e-posta metodunun adını kullan ve iddiaları o metodun bağlam nesnesine göre yaz.

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout/checkout-notifications-print3d.spec.ts`
Expected: FAIL — `expected [] to have a length of 1 but got +0`

- [ ] **Adım 3: E-postayı düzelt**

`backend/src/modules/checkout/checkout-notifications.service.ts` — `sendOrderPlacedEmail` içindeki sipariş sorgusunda `include: { items: true }` ifadesini şununla değiştir:

```ts
      include: { items: true, print3dJob: { include: { items: true } } },
```

`const items = order.items.map(…)` bloğunun **hemen ardına**:

```ts
    // v3.7.0 — yalnız-hizmet print3d siparişinde order.items BOŞ olur
    // (hizmet satırları HardwareOrderItem üretmiyor), yani alıcı sıfır-olmayan
    // toplamın yanında boş bir kalem tablosu görürdü. Sentetik tek satır.
    //
    // Genel "hizmet satırları e-postada görünmüyor" boşluğu ayrı bir iştir;
    // burada yalnız print3d kapatılıyor.
    const p3d = order.print3dJob;
    if (p3d) {
      items.push({
        name: `3D baskı figür — ${p3d.itemCount} ürün (üretim ortağı: Figurunica)`,
        qty: p3d.itemCount,
        lineTotal: fmt(p3d.totalCents),
      });
    }
```

- [ ] **Adım 4: Testleri yeşil gör**

```bash
cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
```
Expected: PASS / çıktısız.

- [ ] **Adım 5: Commit**

```bash
git add backend/src/modules/checkout/checkout-notifications.service.ts backend/src/modules/checkout/checkout-notifications-print3d.spec.ts
git commit -m "fix(checkout): print3d sipariş e-postası boş kalem tablosu yollamıyor

Hizmet satırları HardwareOrderItem üretmediği için yalnız-hizmet bir
siparişte order.items boş kalıyor ve alıcı sıfır-olmayan toplamın yanında
boş bir tablo görüyordu. Sipariş sorgusu print3dJob'ı include ediyor ve
kalem listesine tek sentetik satır ekleniyor.

Genel 'hizmet satırları e-postada görünmüyor' boşluğu ayrı iş; burada
yalnız print3d kapatıldı."
```

---

## Görev 12: e2e — gerçek Postgres, gerçek guard zinciri

**Files:**
- Create: `backend/test/print3d.e2e-spec.ts`

**Interfaces:**
- Consumes: `bootHttpApp`, `resetDb`, `seedLiveTenant`, `loginAs` (`backend/test/helpers/e2e-db.ts`); tüm print3d rayı (Görev 2–10)
- Produces: yok (doğrulama görevi)

- [ ] **Adım 1: e2e dosyasını yaz**

`backend/test/print3d.e2e-spec.ts`:

```ts
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";

/**
 * 3D baskı figür rayı, gerçek veritabanında, gerçek guard zinciriyle.
 *
 * Burada çivilenenler bir birim testinde ifade edilemez: ON DELETE SET NULL'ın
 * gerçekten NULL yazması, iki kiracının gerçekten ayrı olması, ve yalnız-hizmet
 * bir siparişte kargo oluşturmanın stok hareketi olmadan çalışması.
 */
describe("3D baskı figür (HTTP, gerçek DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t1: Awaited<ReturnType<typeof seedLiveTenant>>;
  let t2: Awaited<ReturnType<typeof seedLiveTenant>>;
  let token1: string;

  async function seedCatalog() {
    for (const [sku, name, cents, role] of [
      ["print3d_base", "3D baskı figür — hizmet bedeli", 150_000, "base"],
      ["print3d_item", "3D baskı figür — ürün başına", 5_000, "item"],
    ] as const) {
      await prisma.hardwareProduct.upsert({
        where: { sku },
        update: {},
        create: {
          sku,
          category: "service",
          name,
          description: name,
          priceCents: cents,
          currency: "TRY",
          warrantyMonths: 0,
          images: ["/products/_fallback-service.svg"],
          stockStatus: "in_stock",
          status: "published",
          saleMode: "DIRECT_SALE",
          serviceMeta: {
            serviceType: "print3d",
            partner: "figurunica",
            role,
          },
          complianceDocs: { invoiceIssued: true },
        },
      });
    }
  }

  async function seedProduct(tenantId: string, name: string) {
    const category = await prisma.category.create({
      data: { tenantId, name: `Kategori ${name}`, displayOrder: 0 },
    });
    return prisma.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name,
        price: 100,
        image: `/img/${name}.jpg`,
      },
    });
  }

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
    await resetDb(prisma);
    t1 = await seedLiveTenant(prisma);
    t2 = await seedLiveTenant(prisma);
    await seedCatalog();
    token1 = await loginAs(app, t1.email, t1.password);
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set("Authorization", `Bearer ${token1}`)
      .set("X-Branch-Id", t1.branchId)
      .send(body);

  it("POST /api/v1/checkout/quote prices a 3-product print3d cart at 165000 kuruş with zero shipping", async () => {
    const ids = [];
    for (const n of ["Adana", "Lahmacun", "Künefe"]) {
      ids.push((await seedProduct(t1.tenantId, n)).id);
    }
    const res = await post("/api/v1/checkout/quote", {
      items: [
        { type: "service", code: "print3d_base", qty: 1 },
        { type: "service", code: "print3d_item", qty: 1, productIds: ids },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(165_000);
    expect(res.body.shippingCents).toBe(0);
    const item = res.body.lines.find((l: any) => l.code === "print3d_item");
    expect(item.qty).toBe(3);
  });

  it("POST /api/v1/checkout/quote rejects a productId owned by a second tenant with PRINT3D_FOREIGN_PRODUCT", async () => {
    const mine = await seedProduct(t1.tenantId, "Benim");
    const theirs = await seedProduct(t2.tenantId, "Onların");
    const res = await post("/api/v1/checkout/quote", {
      items: [
        { type: "service", code: "print3d_base", qty: 1 },
        {
          type: "service",
          code: "print3d_item",
          qty: 1,
          productIds: [mine.id, theirs.id],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PRINT3D_FOREIGN_PRODUCT");
  });

  it("a settled intent provisions one HardwareOrder + one Print3dJob + N Print3dJobItem rows", async () => {
    const a = await seedProduct(t1.tenantId, "Iskender");
    const b = await seedProduct(t1.tenantId, "Baklava");
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        subtotalCents: 133_333,
        taxCents: 26_667,
        shippingCents: 0,
        totalCents: 160_000,
        currency: "TRY",
      },
    });
    const job = await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 2,
        totalCents: 160_000,
        items: {
          create: [
            {
              productId: a.id,
              productName: a.name,
              productImageUrl: a.image,
              position: 0,
            },
            {
              productId: b.id,
              productName: b.name,
              productImageUrl: b.image,
              position: 1,
            },
          ],
        },
      },
      include: { items: true },
    });
    expect(job.items).toHaveLength(2);
    expect(job.status).toBe("queued");
    expect(job.partner).toBe("figurunica");
  });

  it("deleting a snapshotted menu product nulls productId but leaves productName and productImageUrl intact", async () => {
    const p = await seedProduct(t1.tenantId, "Silinecek");
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        totalCents: 155_000,
        currency: "TRY",
      },
    });
    const job = await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 1,
        totalCents: 155_000,
        items: {
          create: [
            {
              productId: p.id,
              productName: p.name,
              productImageUrl: p.image,
              position: 0,
            },
          ],
        },
      },
    });
    await prisma.product.delete({ where: { id: p.id } });
    const items = await prisma.print3dJobItem.findMany({
      where: { jobId: job.id },
    });
    expect(items[0].productId).toBeNull();
    expect(items[0].productName).toBe("Silinecek");
    expect(items[0].productImageUrl).toBe("/img/Silinecek.jpg");
  });

  it("allows two items in one job after both snapshotted products are deleted", async () => {
    // @@unique([jobId, productId]) NULL'ları AYRI sayar, bu yüzden iki
    // productId=NULL kalemi çakışmaz. Asıl tekilleştirme quote'taki Set'tir.
    const p1 = await seedProduct(t1.tenantId, "Cift1");
    const p2 = await seedProduct(t1.tenantId, "Cift2");
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        totalCents: 160_000,
        currency: "TRY",
      },
    });
    const job = await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 2,
        totalCents: 160_000,
        items: {
          create: [
            { productId: p1.id, productName: "Cift1", position: 0 },
            { productId: p2.id, productName: "Cift2", position: 1 },
          ],
        },
      },
    });
    await prisma.product.delete({ where: { id: p1.id } });
    await prisma.product.delete({ where: { id: p2.id } });
    const items = await prisma.print3dJobItem.findMany({
      where: { jobId: job.id },
    });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.productId === null)).toBe(true);
  });

  it("GET /api/v1/print3d/jobs returns only the caller tenant's jobs", async () => {
    const otherOrder = await prisma.hardwareOrder.create({
      data: {
        tenantId: t2.tenantId,
        status: "paid",
        totalCents: 155_000,
        currency: "TRY",
      },
    });
    await prisma.print3dJob.create({
      data: {
        tenantId: t2.tenantId,
        hwOrderId: otherOrder.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 1,
        totalCents: 155_000,
      },
    });
    const res = await request(app.getHttpServer())
      .get("/api/v1/print3d/jobs")
      .set("Authorization", `Bearer ${token1}`)
      .set("X-Branch-Id", t1.branchId);
    expect(res.status).toBe(200);
    expect(res.body.every((j: any) => j.tenantId === t1.tenantId)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("POST /api/v1/superadmin/shipments/:orderId works on a service-only order (empty items, no stock movement)", async () => {
    // createShipment order.items üzerinde dönüyor; yalnız-hizmet siparişinde o
    // dizi BOŞ, yani çağrı bir no-op gibi davranmalı: patlamamalı ve hiçbir
    // stok hareketi üretmemeli. Panel bu rayı aynen çağıracak.
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        totalCents: 155_000,
        currency: "TRY",
      },
    });
    await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 1,
        totalCents: 155_000,
        items: { create: [{ productName: "Kargolanacak", position: 0 }] },
      },
    });
    const before = await prisma.hardwareInventory.findMany({
      select: { productId: true, allocated: true, shipped: true },
      orderBy: { productId: "asc" },
    });

    const { ShipmentService } = await import(
      "../src/modules/fulfillment/shipment.service"
    );
    const shipments = app.get(ShipmentService);
    await shipments.createShipment(order.id, { carrier: "Aras" } as any);

    const after = await prisma.hardwareInventory.findMany({
      select: { productId: true, allocated: true, shipped: true },
      orderBy: { productId: "asc" },
    });
    expect(after).toEqual(before);
    const rows = await prisma.shipment.findMany({ where: { orderId: order.id } });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/print3d/offer reports the live catalog prices", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/print3d/offer")
      .set("Authorization", `Bearer ${token1}`)
      .set("X-Branch-Id", t1.branchId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true,
      basePriceCents: 150_000,
      perItemCents: 5_000,
      minItems: 1,
      maxItems: 50,
      partnerName: "Figurunica",
    });
  });
});
```

- [ ] **Adım 2: e2e'yi çalıştır**

Run: `cd /home/tarik/Projects/kds/backend && npm run test:e2e -- print3d`
Expected: PASS — 9 test. Suite bir e2e veritabanı ister; `backend/test/helpers/e2e-db.ts`'in beklediği `DATABASE_URL` ayarını dosyadan oku ve aynısını kullan.

- [ ] **Adım 3: Commit**

```bash
git add backend/test/print3d.e2e-spec.ts
git commit -m "test(print3d): gerçek Postgres uçtan uca kapsam

Fiyat (3 ürün = 165.000 kuruş, kargo 0), çapraz-kiracı reddi, provizyon
satırları, ON DELETE SET NULL'ın snapshot'ı bozmadan productId'yi
boşaltması, iki NULL kalemin @@unique altında çakışmaması, kiracı çiti ve
teklif uç noktası — hiçbiri birim testinde ifade edilemiyor."
```

---

## Görev 13: i18n — iki namespace, beş yerel, gerçek çeviri

Bu görev FE bileşenlerinden **önce** gelir: bileşenler gerçek anahtarlara yazsın, `defaultValue` kalıntısı kalmasın.

**Files:**
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/hardware.json`
- Modify: `frontend/src/i18n/locales/{tr,en,ru,ar,uz}/superadmin.json`

**Interfaces:**
- Consumes: yok
- Produces: `hardware:print3d.*` (37 anahtar), `superadmin:nav.print3d`, `superadmin:print3d.*` (27 anahtar) — beş yerelin hepsinde **aynı** anahtar ağacı

- [ ] **Adım 1: `tr/hardware.json`'a `print3d` bloğunu ekle**

Kök nesneye, `store` bloğunun yanına:

```json
  "print3d": {
    "partnerLabel": "Üretim ortağı: Figurunica",
    "card": {
      "title": "3D baskı figür",
      "desc": "Menünüzden seçtiğiniz her ürün için bir 3D baskı figür. KDV ve kargo dahil.",
      "price": "₺1.500 + ürün başına ₺50",
      "cta": "Sipariş oluştur"
    },
    "wizard": {
      "title": "3D baskı figür siparişi",
      "stepProducts": "Ürün seçimi",
      "stepShipping": "Teslimat",
      "stepSummary": "Özet ve ödeme",
      "next": "Devam et",
      "back": "Geri",
      "unavailable": "Bu hizmet şu anda satışa kapalı."
    },
    "picker": {
      "search": "Ürün ara",
      "allCategories": "Tüm kategoriler",
      "selectedCount": "{{count}} ürün seçildi",
      "maxReached": "En fazla {{max}} ürün seçebilirsiniz.",
      "livePrice": "Tahmini tutar",
      "empty": "Menünüzde ürün yok."
    },
    "shipping": {
      "notesLabel": "Üretim notu (isteğe bağlı)",
      "notesPlaceholder": "Renk, boyut veya sunum tercihiniz varsa yazın.",
      "continue": "Özete geç"
    },
    "summary": {
      "baseLine": "Hizmet bedeli",
      "itemLine": "Ürün başına figür ({{count}} adet)",
      "shipping": "Kargo",
      "total": "Toplam",
      "consentTitle": "Yasal onaylar",
      "consentRequired": "Ödemeye geçmek için üç sözleşmeyi de onaylayın.",
      "pay": "PayTR ile öde",
      "verifying": "Tutar doğrulanıyor…",
      "mismatch": "Tutar sunucu tarafından doğrulanamadı; lütfen sihirbazı yeniden başlatın."
    },
    "errors": {
      "PRINT3D_NO_PRODUCTS": "En az bir menü ürünü seçmelisiniz.",
      "PRINT3D_TOO_MANY_PRODUCTS": "En fazla 50 ürün seçebilirsiniz.",
      "PRINT3D_FOREIGN_PRODUCT": "Seçilen ürünlerden biri bu restorana ait değil.",
      "PRINT3D_INCOMPLETE_CART": "3D baskı siparişi eksik; lütfen sihirbazı yeniden başlatın.",
      "PRINT3D_DUPLICATE_LINE": "3D baskı siparişi eksik; lütfen sihirbazı yeniden başlatın."
    },
    "order": {
      "blockTitle": "3D baskı figür siparişi",
      "itemLine": "{{count}} ürün"
    },
    "result": {
      "note": "Siparişiniz üretim kuyruğuna alındı."
    }
  },
```

- [ ] **Adım 2: `en/hardware.json`'a aynı ağacı İNGİLİZCE ekle**

`en` **referans yerel**. Buraya Türkçe yazmak parity'yi geçirir ama beş yerelin hepsi Türkçe render eder.

```json
  "print3d": {
    "partnerLabel": "Production partner: Figurunica",
    "card": {
      "title": "3D printed figurine",
      "desc": "One 3D printed figurine for each product you pick from your menu. VAT and shipping included.",
      "price": "₺1,500 + ₺50 per product",
      "cta": "Start an order"
    },
    "wizard": {
      "title": "3D printed figurine order",
      "stepProducts": "Pick products",
      "stepShipping": "Delivery",
      "stepSummary": "Summary & payment",
      "next": "Continue",
      "back": "Back",
      "unavailable": "This service is currently not on sale."
    },
    "picker": {
      "search": "Search products",
      "allCategories": "All categories",
      "selectedCount": "{{count}} product(s) selected",
      "maxReached": "You can pick at most {{max}} products.",
      "livePrice": "Estimated total",
      "empty": "Your menu has no products yet."
    },
    "shipping": {
      "notesLabel": "Production note (optional)",
      "notesPlaceholder": "Tell us if you have a colour, size or presentation preference.",
      "continue": "Go to summary"
    },
    "summary": {
      "baseLine": "Service fee",
      "itemLine": "Per-product figurine ({{count}})",
      "shipping": "Shipping",
      "total": "Total",
      "consentTitle": "Legal consents",
      "consentRequired": "Tick all three agreements to continue to payment.",
      "pay": "Pay with PayTR",
      "verifying": "Verifying the amount…",
      "mismatch": "The server could not confirm this amount; please restart the wizard."
    },
    "errors": {
      "PRINT3D_NO_PRODUCTS": "Pick at least one menu product.",
      "PRINT3D_TOO_MANY_PRODUCTS": "You can pick at most 50 products.",
      "PRINT3D_FOREIGN_PRODUCT": "One of the selected products does not belong to this restaurant.",
      "PRINT3D_INCOMPLETE_CART": "The 3D print order is incomplete; please restart the wizard.",
      "PRINT3D_DUPLICATE_LINE": "The 3D print order is incomplete; please restart the wizard."
    },
    "order": {
      "blockTitle": "3D printed figurine order",
      "itemLine": "{{count}} product(s)"
    },
    "result": {
      "note": "Your order has entered the production queue."
    }
  },
```

- [ ] **Adım 3: `ru/hardware.json`**

```json
  "print3d": {
    "partnerLabel": "Производственный партнёр: Figurunica",
    "card": {
      "title": "3D-печатная фигурка",
      "desc": "По одной 3D-фигурке для каждого блюда из вашего меню. НДС и доставка включены.",
      "price": "₺1 500 + ₺50 за позицию",
      "cta": "Оформить заказ"
    },
    "wizard": {
      "title": "Заказ 3D-печатных фигурок",
      "stepProducts": "Выбор позиций",
      "stepShipping": "Доставка",
      "stepSummary": "Итог и оплата",
      "next": "Продолжить",
      "back": "Назад",
      "unavailable": "Эта услуга сейчас недоступна."
    },
    "picker": {
      "search": "Поиск позиций",
      "allCategories": "Все категории",
      "selectedCount": "Выбрано позиций: {{count}}",
      "maxReached": "Можно выбрать не более {{max}} позиций.",
      "livePrice": "Ориентировочная сумма",
      "empty": "В вашем меню пока нет позиций."
    },
    "shipping": {
      "notesLabel": "Примечание к производству (необязательно)",
      "notesPlaceholder": "Укажите пожелания по цвету, размеру или подаче.",
      "continue": "К итогу"
    },
    "summary": {
      "baseLine": "Стоимость услуги",
      "itemLine": "Фигурка за позицию ({{count}} шт.)",
      "shipping": "Доставка",
      "total": "Итого",
      "consentTitle": "Юридические согласия",
      "consentRequired": "Отметьте все три соглашения, чтобы перейти к оплате.",
      "pay": "Оплатить через PayTR",
      "verifying": "Проверяем сумму…",
      "mismatch": "Сервер не подтвердил сумму; пожалуйста, начните заново."
    },
    "errors": {
      "PRINT3D_NO_PRODUCTS": "Выберите хотя бы одну позицию меню.",
      "PRINT3D_TOO_MANY_PRODUCTS": "Можно выбрать не более 50 позиций.",
      "PRINT3D_FOREIGN_PRODUCT": "Одна из выбранных позиций не принадлежит этому ресторану.",
      "PRINT3D_INCOMPLETE_CART": "Заказ 3D-печати неполный; пожалуйста, начните заново.",
      "PRINT3D_DUPLICATE_LINE": "Заказ 3D-печати неполный; пожалуйста, начните заново."
    },
    "order": {
      "blockTitle": "Заказ 3D-печатных фигурок",
      "itemLine": "{{count}} позиций"
    },
    "result": {
      "note": "Ваш заказ поставлен в очередь производства."
    }
  },
```

- [ ] **Adım 4: `ar/hardware.json`**

```json
  "print3d": {
    "partnerLabel": "شريك الإنتاج: Figurunica",
    "card": {
      "title": "مجسّم مطبوع ثلاثي الأبعاد",
      "desc": "مجسّم مطبوع ثلاثي الأبعاد لكل صنف تختاره من قائمتك. الضريبة والشحن مشمولان.",
      "price": "١٥٠٠ ₺ + ٥٠ ₺ لكل صنف",
      "cta": "إنشاء طلب"
    },
    "wizard": {
      "title": "طلب مجسّمات مطبوعة ثلاثية الأبعاد",
      "stepProducts": "اختيار الأصناف",
      "stepShipping": "التوصيل",
      "stepSummary": "الملخّص والدفع",
      "next": "متابعة",
      "back": "رجوع",
      "unavailable": "هذه الخدمة غير متاحة للبيع حالياً."
    },
    "picker": {
      "search": "ابحث عن صنف",
      "allCategories": "كل الفئات",
      "selectedCount": "تم اختيار {{count}} صنف",
      "maxReached": "يمكنك اختيار {{max}} صنف كحدّ أقصى.",
      "livePrice": "المبلغ التقديري",
      "empty": "لا توجد أصناف في قائمتك بعد."
    },
    "shipping": {
      "notesLabel": "ملاحظة الإنتاج (اختياري)",
      "notesPlaceholder": "اكتب تفضيلك في اللون أو الحجم أو طريقة التقديم.",
      "continue": "إلى الملخّص"
    },
    "summary": {
      "baseLine": "رسوم الخدمة",
      "itemLine": "مجسّم لكل صنف ({{count}})",
      "shipping": "الشحن",
      "total": "الإجمالي",
      "consentTitle": "الموافقات القانونية",
      "consentRequired": "وافق على الاتفاقيات الثلاث للمتابعة إلى الدفع.",
      "pay": "الدفع عبر PayTR",
      "verifying": "جارٍ التحقّق من المبلغ…",
      "mismatch": "تعذّر على الخادم تأكيد المبلغ؛ يُرجى إعادة بدء المعالج."
    },
    "errors": {
      "PRINT3D_NO_PRODUCTS": "اختر صنفاً واحداً على الأقل من القائمة.",
      "PRINT3D_TOO_MANY_PRODUCTS": "يمكنك اختيار ٥٠ صنفاً كحدّ أقصى.",
      "PRINT3D_FOREIGN_PRODUCT": "أحد الأصناف المختارة لا يخصّ هذا المطعم.",
      "PRINT3D_INCOMPLETE_CART": "طلب الطباعة ثلاثية الأبعاد غير مكتمل؛ يُرجى إعادة بدء المعالج.",
      "PRINT3D_DUPLICATE_LINE": "طلب الطباعة ثلاثية الأبعاد غير مكتمل؛ يُرجى إعادة بدء المعالج."
    },
    "order": {
      "blockTitle": "طلب مجسّمات مطبوعة ثلاثية الأبعاد",
      "itemLine": "{{count}} صنف"
    },
    "result": {
      "note": "تم إدراج طلبك في قائمة الإنتاج."
    }
  },
```

- [ ] **Adım 5: `uz/hardware.json`**

```json
  "print3d": {
    "partnerLabel": "Ishlab chiqarish hamkori: Figurunica",
    "card": {
      "title": "3D bosma figurka",
      "desc": "Menyudan tanlagan har bir taom uchun bitta 3D bosma figurka. QQS va yetkazib berish narxga kiritilgan.",
      "price": "₺1 500 + har bir taom uchun ₺50",
      "cta": "Buyurtma berish"
    },
    "wizard": {
      "title": "3D bosma figurka buyurtmasi",
      "stepProducts": "Taom tanlash",
      "stepShipping": "Yetkazib berish",
      "stepSummary": "Xulosa va to‘lov",
      "next": "Davom etish",
      "back": "Orqaga",
      "unavailable": "Bu xizmat hozircha sotuvda emas."
    },
    "picker": {
      "search": "Taom qidirish",
      "allCategories": "Barcha turkumlar",
      "selectedCount": "{{count}} ta taom tanlandi",
      "maxReached": "Ko‘pi bilan {{max}} ta taom tanlash mumkin.",
      "livePrice": "Taxminiy summa",
      "empty": "Menyuda hali taom yo‘q."
    },
    "shipping": {
      "notesLabel": "Ishlab chiqarish izohi (ixtiyoriy)",
      "notesPlaceholder": "Rang, o‘lcham yoki taqdimot bo‘yicha istagingizni yozing.",
      "continue": "Xulosaga o‘tish"
    },
    "summary": {
      "baseLine": "Xizmat haqi",
      "itemLine": "Har bir taom uchun figurka ({{count}} dona)",
      "shipping": "Yetkazib berish",
      "total": "Jami",
      "consentTitle": "Huquqiy roziliklar",
      "consentRequired": "To‘lovga o‘tish uchun uchala shartnomani ham tasdiqlang.",
      "pay": "PayTR orqali to‘lash",
      "verifying": "Summa tekshirilmoqda…",
      "mismatch": "Server summani tasdiqlay olmadi; iltimos, ustani qaytadan boshlang."
    },
    "errors": {
      "PRINT3D_NO_PRODUCTS": "Kamida bitta menyu taomini tanlang.",
      "PRINT3D_TOO_MANY_PRODUCTS": "Ko‘pi bilan 50 ta taom tanlash mumkin.",
      "PRINT3D_FOREIGN_PRODUCT": "Tanlangan taomlardan biri bu restoranga tegishli emas.",
      "PRINT3D_INCOMPLETE_CART": "3D bosma buyurtmasi to‘liq emas; iltimos, ustani qaytadan boshlang.",
      "PRINT3D_DUPLICATE_LINE": "3D bosma buyurtmasi to‘liq emas; iltimos, ustani qaytadan boshlang."
    },
    "order": {
      "blockTitle": "3D bosma figurka buyurtmasi",
      "itemLine": "{{count}} ta taom"
    },
    "result": {
      "note": "Buyurtmangiz ishlab chiqarish navbatiga qo‘yildi."
    }
  },
```

- [ ] **Adım 6: Beş `superadmin.json`'a `nav.print3d` + `print3d` bloğunu ekle**

Her yerelde `nav` nesnesine `legal` anahtarından sonra bir satır, ve kök nesneye bir `print3d` bloğu:

**tr**
```json
  "print3d": {
    "title": "3D Üretim",
    "subtitle": "Figurunica üretim kuyruğu",
    "tabs": { "queued": "Kuyrukta", "in_production": "Üretimde", "produced": "Üretildi", "cancelled": "İptal" },
    "col": { "tenant": "Kiracı", "items": "Kalem", "total": "Tutar", "date": "Tarih", "status": "Durum" },
    "manifest": { "title": "Figurunica manifestosu", "product": "Ürün", "model": "3D model", "address": "Teslimat adresi", "itemStatus": "Kalem durumu" },
    "actions": { "advance": "İlerlet", "cancel": "İptal et", "partnerRef": "Ortak iş no", "save": "Kaydet", "exportCsv": "CSV indir", "createShipment": "Kargo oluştur", "markDelivered": "Teslim edildi" },
    "itemStatus": { "pending": "Bekliyor", "printed": "Basıldı", "rejected": "Reddedildi" },
    "empty": "Bu durumda iş yok."
  },
```
`nav`'a: `"print3d": "3D Üretim",`

**en**
```json
  "print3d": {
    "title": "3D Production",
    "subtitle": "Figurunica production queue",
    "tabs": { "queued": "Queued", "in_production": "In production", "produced": "Produced", "cancelled": "Cancelled" },
    "col": { "tenant": "Tenant", "items": "Items", "total": "Amount", "date": "Date", "status": "Status" },
    "manifest": { "title": "Figurunica manifest", "product": "Product", "model": "3D model", "address": "Delivery address", "itemStatus": "Item status" },
    "actions": { "advance": "Advance", "cancel": "Cancel", "partnerRef": "Partner job no", "save": "Save", "exportCsv": "Download CSV", "createShipment": "Create shipment", "markDelivered": "Mark delivered" },
    "itemStatus": { "pending": "Pending", "printed": "Printed", "rejected": "Rejected" },
    "empty": "No jobs in this state."
  },
```
`nav`'a: `"print3d": "3D Production",`

**ru**
```json
  "print3d": {
    "title": "3D-производство",
    "subtitle": "Очередь производства Figurunica",
    "tabs": { "queued": "В очереди", "in_production": "В производстве", "produced": "Произведено", "cancelled": "Отменено" },
    "col": { "tenant": "Арендатор", "items": "Позиции", "total": "Сумма", "date": "Дата", "status": "Статус" },
    "manifest": { "title": "Манифест Figurunica", "product": "Позиция", "model": "3D-модель", "address": "Адрес доставки", "itemStatus": "Статус позиции" },
    "actions": { "advance": "Продвинуть", "cancel": "Отменить", "partnerRef": "Номер у партнёра", "save": "Сохранить", "exportCsv": "Скачать CSV", "createShipment": "Создать отправление", "markDelivered": "Отметить доставленным" },
    "itemStatus": { "pending": "Ожидает", "printed": "Напечатано", "rejected": "Отклонено" },
    "empty": "В этом статусе задач нет."
  },
```
`nav`'a: `"print3d": "3D-производство",`

**ar**
```json
  "print3d": {
    "title": "إنتاج ثلاثي الأبعاد",
    "subtitle": "طابور إنتاج Figurunica",
    "tabs": { "queued": "في الطابور", "in_production": "قيد الإنتاج", "produced": "تم الإنتاج", "cancelled": "ملغى" },
    "col": { "tenant": "المستأجر", "items": "البنود", "total": "المبلغ", "date": "التاريخ", "status": "الحالة" },
    "manifest": { "title": "بيان Figurunica", "product": "الصنف", "model": "نموذج ثلاثي الأبعاد", "address": "عنوان التوصيل", "itemStatus": "حالة البند" },
    "actions": { "advance": "تقديم", "cancel": "إلغاء", "partnerRef": "رقم عمل الشريك", "save": "حفظ", "exportCsv": "تنزيل CSV", "createShipment": "إنشاء شحنة", "markDelivered": "تعليم كمُسلَّم" },
    "itemStatus": { "pending": "قيد الانتظار", "printed": "مطبوع", "rejected": "مرفوض" },
    "empty": "لا توجد مهام في هذه الحالة."
  },
```
`nav`'a: `"print3d": "إنتاج ثلاثي الأبعاد",`

**uz**
```json
  "print3d": {
    "title": "3D ishlab chiqarish",
    "subtitle": "Figurunica ishlab chiqarish navbati",
    "tabs": { "queued": "Navbatda", "in_production": "Ishlab chiqarilmoqda", "produced": "Ishlab chiqarildi", "cancelled": "Bekor qilindi" },
    "col": { "tenant": "Ijarachi", "items": "Bandlar", "total": "Summa", "date": "Sana", "status": "Holat" },
    "manifest": { "title": "Figurunica manifesti", "product": "Taom", "model": "3D model", "address": "Yetkazib berish manzili", "itemStatus": "Band holati" },
    "actions": { "advance": "Keyingi holat", "cancel": "Bekor qilish", "partnerRef": "Hamkor ish raqami", "save": "Saqlash", "exportCsv": "CSV yuklab olish", "createShipment": "Jo‘natma yaratish", "markDelivered": "Yetkazildi deb belgilash" },
    "itemStatus": { "pending": "Kutilmoqda", "printed": "Bosildi", "rejected": "Rad etildi" },
    "empty": "Bu holatda ish yo‘q."
  },
```
`nav`'a: `"print3d": "3D ishlab chiqarish",`

- [ ] **Adım 7: Parity ve drift kapılarını çalıştır**

```bash
set -o pipefail
cd /home/tarik/Projects/kds
node scripts/check-i18n-parity.mjs
node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Expected: parity çıktısı hatasız (eksik/fazla anahtar yok); value-drift `--gate-new` temiz — yeni anahtarların hiçbirinde beş yerel arasında birebir aynı değer yok (marka adı `Figurunica` bir değerin İÇİNDE geçtiği için tetiklenmez; tetiklenirse anahtarı baseline'a değil, çeviriyi düzelt).

- [ ] **Adım 8: Commit**

```bash
git add frontend/src/i18n/locales
git commit -m "feat(i18n): 3D baskı figür metinleri beş yerelde

hardware:print3d.* (37 anahtar) ve superadmin:print3d.* + nav.print3d
(28 anahtar), tr/en/ru/ar/uz için GERÇEK çeviriyle. en referans yerel
olduğu için oraya Türkçe yazmak parity'yi geçirir ama beş yerelin hepsini
Türkçe gösterirdi."
```

---

## Görev 14: Saf yardımcılar + ortak rozeti + eksik hizmet görseli

**Files:**
- Create: `frontend/public/products/_fallback-service.svg` (`landing/public/products/_fallback-service.svg` birebir kopyası)
- Create: `frontend/src/features/print3d/print3dSkus.ts`
- Create: `frontend/src/features/print3d/partnerBadge.ts`
- Create: `frontend/src/features/print3d/PartnerBadge.tsx`
- Test: `frontend/src/features/print3d/print3dSkus.spec.ts`
- Test: `frontend/src/features/print3d/partnerBadge.spec.ts`
- Test: `frontend/src/features/print3d/PartnerBadge.test.tsx`

**Interfaces:**
- Consumes: `hardware:print3d.partnerLabel` (Görev 13)
- Produces:
  - `print3dSkus.ts`: `export const PRINT3D_BASE_SKU = "print3d_base"`, `export const PRINT3D_ITEM_SKU = "print3d_item"`, `export function isPrint3dSku(sku: string | undefined | null): boolean`, `export function computePrint3dTotalCents(n: number, baseCents: number, perItemCents: number): number`
  - `partnerBadge.ts`: `export function safePartnerUrl(raw: string | null | undefined): string | null`
  - `PartnerBadge.tsx`: `export default function PartnerBadge({ url, className }: { url: string | null; className?: string })`

- [ ] **Adım 1: Saf yardımcı testlerini yaz (kırmızı)**

`frontend/src/features/print3d/print3dSkus.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  computePrint3dTotalCents,
  isPrint3dSku,
} from './print3dSkus';

describe('print3dSkus', () => {
  it('isPrint3dSku matches both SKUs and nothing else', () => {
    expect(isPrint3dSku(PRINT3D_BASE_SKU)).toBe(true);
    expect(isPrint3dSku(PRINT3D_ITEM_SKU)).toBe(true);
    expect(isPrint3dSku('install-yazarkasa-gib')).toBe(false);
    expect(isPrint3dSku('print3d')).toBe(false);
    expect(isPrint3dSku(undefined)).toBe(false);
    expect(isPrint3dSku(null)).toBe(false);
  });

  it('computePrint3dTotalCents returns 150000 + 5000*n', () => {
    expect(computePrint3dTotalCents(1, 150_000, 5_000)).toBe(155_000);
    expect(computePrint3dTotalCents(10, 150_000, 5_000)).toBe(200_000);
    expect(computePrint3dTotalCents(50, 150_000, 5_000)).toBe(400_000);
  });

  it('computePrint3dTotalCents never goes below the base for a zero selection', () => {
    expect(computePrint3dTotalCents(0, 150_000, 5_000)).toBe(150_000);
  });
});
```

`frontend/src/features/print3d/partnerBadge.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { safePartnerUrl } from './partnerBadge';

describe('safePartnerUrl', () => {
  it('accepts https and http', () => {
    expect(safePartnerUrl('https://figurunica.com')).toBe('https://figurunica.com');
    expect(safePartnerUrl('http://figurunica.com')).toBe('http://figurunica.com');
  });

  it('rejects javascript:, protocol-relative and empty values', () => {
    // Sunucu da aynı testi yapıyor; bu ikinci kemer, sunucu yanıtı bir gün
    // başka bir yerden gelirse rozetin XSS taşımaması için.
    expect(safePartnerUrl('javascript:alert(1)')).toBeNull();
    expect(safePartnerUrl('//evil.example')).toBeNull();
    expect(safePartnerUrl('')).toBeNull();
    expect(safePartnerUrl(null)).toBeNull();
    expect(safePartnerUrl(undefined)).toBeNull();
  });
});
```

- [ ] **Adım 2: Testleri çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d`
Expected: FAIL — `Failed to resolve import "./print3dSkus"`

- [ ] **Adım 3: Saf yardımcıları yaz**

`frontend/src/features/print3d/print3dSkus.ts`:

```ts
/**
 * 3D baskı SKU'larının SPA tarafındaki tek kopyası.
 *
 * Backend'in print3d.const.ts'i ile aynı iki dize. Elle aynalanan bir sabit
 * her zaman sürüklenme riskidir; risk burada kabul edilebilir çünkü değerler
 * migration'a çivili ve tek bir dosyada duruyor.
 */
export const PRINT3D_BASE_SKU = 'print3d_base';
export const PRINT3D_ITEM_SKU = 'print3d_item';

/** Mağaza ızgarası bu iki ham satırı KART OLARAK basmamalı. */
export function isPrint3dSku(sku: string | undefined | null): boolean {
  return sku === PRINT3D_BASE_SKU || sku === PRINT3D_ITEM_SKU;
}

/**
 * Sihirbazın canlı fiyat sayacı. İSTEMCİ ARİTMETİĞİ NİHAİ DEĞİLDİR — özet
 * adımı ödemeden önce sunucudan gerçek toplamı alır; bu yalnızca önizleme.
 */
export function computePrint3dTotalCents(
  n: number,
  baseCents: number,
  perItemCents: number,
): number {
  return baseCents + perItemCents * Math.max(0, n);
}
```

`frontend/src/features/print3d/partnerBadge.ts`:

```ts
/**
 * Yalnızca http(s) şemasını geçir. `javascript:` yükü ve protokol-göreli
 * `//host` açık yönlendirmesi elenir. Sunucu da aynı süzgeci uyguluyor;
 * bu ikinci kemer.
 */
export function safePartnerUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}
```

- [ ] **Adım 4: Testleri yeşil gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d`
Expected: PASS — `2 passed` dosya, `5 passed` test.

- [ ] **Adım 5: Rozet testini yaz (kırmızı)**

`frontend/src/features/print3d/PartnerBadge.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import PartnerBadge from './PartnerBadge';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

describe('PartnerBadge', () => {
  it('renders an outbound link with rel=noopener when a url is configured', () => {
    render(<PartnerBadge url="https://figurunica.com" />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://figurunica.com');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders the partner text as plain span when no url is configured', () => {
    render(<PartnerBadge url={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(enHardware.print3d.partnerLabel)).toBeTruthy();
  });

  it('never renders empty text', () => {
    // "Üretim ortağı: Figurunica" bir BEYANDIR, bağlantıya bağlı değildir.
    for (const url of ['https://figurunica.com', null, 'javascript:alert(1)']) {
      const { container, unmount } = render(<PartnerBadge url={url as any} />);
      expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('refuses a javascript: url and falls back to plain text', () => {
    render(<PartnerBadge url={'javascript:alert(1)' as any} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Adım 6: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/PartnerBadge.test.tsx`
Expected: FAIL — `Failed to resolve import "./PartnerBadge"`

- [ ] **Adım 7: Rozeti yaz**

`frontend/src/features/print3d/PartnerBadge.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { safePartnerUrl } from './partnerBadge';

/**
 * "Üretim ortağı: Figurunica".
 *
 * Metin HİÇBİR KOŞULDA boş değildir — bu bir beyandır, bağlantıya bağlı
 * değildir. URL geçerliyse <a>, değilse düz <span>. `null` dalı normalde
 * yalnızca PRINT3D_PARTNER_URL hatalı bir değerle ezildiğinde görülür.
 */
export default function PartnerBadge({
  url,
  className,
}: {
  url: string | null;
  className?: string;
}) {
  const { t } = useTranslation('hardware');
  const label = t('print3d.partnerLabel');
  const href = safePartnerUrl(url);
  const cls = `text-xs text-gray-500 ${className ?? ''}`.trim();

  if (!href) {
    return <span className={cls}>{label}</span>;
  }
  return (
    <a
      className={`${cls} underline underline-offset-2`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}
```

- [ ] **Adım 8: Eksik hizmet görselini SPA'ya kopyala**

```bash
cd /home/tarik/Projects/kds
mkdir -p frontend/public/products
cp landing/public/products/_fallback-service.svg frontend/public/products/_fallback-service.svg
ls -l frontend/public/products/_fallback-service.svg
```
Expected: dosya var. Katalog satırları `images` olarak `/products/_fallback-service.svg` taşıyor ama `frontend/public/products/` dizini hiç yoktu — `ServiceCard`'ın `ProductImage`'ı bu yolu SPA'dan isteyip 404 alıyordu. Kopya tohumdaki mevcut hizmetleri de düzeltir.

- [ ] **Adım 9: Testleri ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: PASS / çıktısız.

- [ ] **Adım 10: Commit**

```bash
git add frontend/src/features/print3d frontend/public/products/_fallback-service.svg
git commit -m "feat(print3d): saf yardımcılar, ortak rozeti ve eksik hizmet görseli

isPrint3dSku / computePrint3dTotalCents / safePartnerUrl saf ve test edilmiş.
PartnerBadge metni hiçbir koşulda boş değil: URL geçerliyse <a>, değilse
düz <span> — 'Üretim ortağı: Figurunica' bir beyandır, bağlantıya bağlı
değildir. javascript: yükü ikinci kemerle de eleniyor.

frontend/public/products/ dizini hiç yoktu; katalogdaki her hizmet satırı
/products/_fallback-service.svg isteyip 404 alıyordu."
```

---

## Görev 15: Mağaza yüzeyi — tek kart, iki ham SKU görünmez

Düzeltilmezse alıcı "3D baskı figür — hizmet bedeli" ve "— ürün başına" adında **iki ayrı kart** görür; üstelik `/admin/store/print3d_base` detay sayfası SKU'yu tek başına sepete eklettirir ve bilinmeyen `serviceType`'ı **"Yerinde kurulum"** diye etiketler.

**Files:**
- Create: `frontend/src/features/print3d/print3dApi.ts`
- Create: `frontend/src/features/print3d/Print3dStoreCard.tsx`
- Modify: `frontend/src/features/hardware-store/StorePage.tsx` (derin bağlantı efekti ~142-177; hizmet bölümü kapısı + ızgara ~331-350)
- Modify: `frontend/src/features/hardware-store/ProductDetailPage.tsx` (`useGetProductBySku` sonrası, render'dan önce ~63-66)
- Test: `frontend/src/features/hardware-store/StorePage.test.tsx` (ekleme)
- Test: `frontend/src/features/hardware-store/ProductDetailPage.test.tsx` (ekleme)

**Interfaces:**
- Consumes: `isPrint3dSku`, `PRINT3D_BASE_SKU`, `PRINT3D_ITEM_SKU`, `computePrint3dTotalCents` (Görev 14); `PartnerBadge` (Görev 14); `hardware:print3d.card.*` (Görev 13); `GET /v1/print3d/offer` (Görev 8)
- Produces:
  - `print3dApi.ts`: `export interface Print3dOffer { available: boolean; basePriceCents: number; perItemCents: number; currency: string; minItems: number; maxItems: number; partnerName: string; partnerUrl: string | null }`; `export const print3dKeys`; `export function useGetPrint3dOffer()`; `export interface Print3dJobItem { id: string; productName: string; productImageUrl: string | null; model3dUrl: string | null; position: number; status: string }`; `export interface Print3dJob { id: string; status: string; itemCount: number; totalCents: number; currency: string; partner: string; partnerRef: string | null; createdAt: string; items: Print3dJobItem[] }`; `export function useListPrint3dJobs()`; `export function useGetPrint3dJob(id?: string)`
  - `Print3dStoreCard.tsx`: `export default function Print3dStoreCard()` — teklif `available:false` ise `null` render eder

- [ ] **Adım 1: API kancalarını yaz**

`frontend/src/features/print3d/print3dApi.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface Print3dOffer {
  /** false ise mağaza kartı hiç basılmaz (katalog satırı yayında değil). */
  available: boolean;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
  minItems: number;
  maxItems: number;
  partnerName: string;
  /** Sunucu yalnızca http(s) şemasını yayınlar; aksi hâlde null. */
  partnerUrl: string | null;
}

export interface Print3dJobItem {
  id: string;
  productName: string;
  productImageUrl: string | null;
  model3dUrl: string | null;
  position: number;
  status: string;
}

export interface Print3dJob {
  id: string;
  status: string;
  itemCount: number;
  totalCents: number;
  currency: string;
  partner: string;
  partnerRef: string | null;
  createdAt: string;
  items: Print3dJobItem[];
}

export const print3dKeys = {
  offer: () => ['print3d', 'offer'] as const,
  jobs: () => ['print3d', 'jobs'] as const,
  job: (id: string) => ['print3d', 'job', id] as const,
};

export const useGetPrint3dOffer = () =>
  useQuery({
    queryKey: print3dKeys.offer(),
    queryFn: async (): Promise<Print3dOffer> => {
      const r = await api.get('/v1/print3d/offer');
      return r.data;
    },
    // Fiyat katalogdan geliyor ve nadiren değişiyor; her mağaza açılışında
    // yeniden çekmek gereksiz.
    staleTime: 5 * 60 * 1000,
  });

export const useListPrint3dJobs = () =>
  useQuery({
    queryKey: print3dKeys.jobs(),
    queryFn: async (): Promise<Print3dJob[]> => {
      const r = await api.get('/v1/print3d/jobs');
      return r.data;
    },
  });

export const useGetPrint3dJob = (id?: string) =>
  useQuery({
    queryKey: print3dKeys.job(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Print3dJob> => {
      const r = await api.get(`/v1/print3d/jobs/${id}`);
      return r.data;
    },
  });
```

- [ ] **Adım 2: Mağaza kartını yaz**

`frontend/src/features/print3d/Print3dStoreCard.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Boxes } from 'lucide-react';
import { formatMoney } from '../hardware-store/storeApi';
import { useGetPrint3dOffer } from './print3dApi';
import PartnerBadge from './PartnerBadge';

/**
 * Mağazadaki TEK 3D baskı kartı.
 *
 * İki ham SKU (print3d_base / print3d_item) hizmet ızgarasından filtrelenir;
 * alıcı tek bir kart görür ve sihirbaza gider. Teklif available:false dönerse
 * (katalog satırı yayında değil / DIRECT_SALE değil) kart HİÇ basılmaz.
 */
export default function Print3dStoreCard() {
  const { t } = useTranslation('hardware');
  const { data: offer } = useGetPrint3dOffer();
  if (!offer?.available) return null;

  return (
    <article
      data-testid="print3d-store-card"
      className="overflow-hidden rounded-lg border bg-gradient-to-br from-violet-50/60 to-white"
    >
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Boxes className="h-4 w-4 text-violet-600" aria-hidden="true" />
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            {t('print3d.card.title')}
          </span>
        </div>
        <h3 className="mt-1 font-semibold">{t('print3d.card.title')}</h3>
        <p className="mt-1 text-sm text-gray-600">{t('print3d.card.desc')}</p>
        <p className="mt-2 text-sm font-medium">
          {formatMoney(offer.basePriceCents, offer.currency)}
          {' + '}
          {formatMoney(offer.perItemCents, offer.currency)}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <PartnerBadge url={offer.partnerUrl} />
          <Link
            to="/admin/store/print3d"
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
          >
            {t('print3d.card.cta')}
          </Link>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Adım 3: Mağaza testlerini yaz (kırmızı)**

`frontend/src/features/hardware-store/StorePage.test.tsx` — mock bloğuna ekle:

```tsx
const print3dOffer = {
  data: {
    available: true,
    basePriceCents: 150000,
    perItemCents: 5000,
    currency: 'TRY',
    minItems: 1,
    maxItems: 50,
    partnerName: 'Figurunica',
    partnerUrl: 'https://figurunica.com',
  },
};
vi.mock('../print3d/print3dApi', () => ({
  useGetPrint3dOffer: () => print3dOffer,
  print3dKeys: { offer: () => ['print3d', 'offer'] },
}));
```

ve `describe` bloğuna üç test:

```tsx
  it('does not render the raw print3d SKUs as separate service cards', () => {
    products.data = [
      makeProduct({ id: 'p-b', sku: 'print3d_base', category: 'service', name: '3D baskı figür — hizmet bedeli' }),
      makeProduct({ id: 'p-i', sku: 'print3d_item', category: 'service', name: '3D baskı figür — ürün başına' }),
      makeProduct({ id: 'p-s', sku: 'install-yazarkasa-gib', category: 'service', name: 'Yazarkasa kurulum' }),
    ];
    renderStore();
    expect(screen.queryByText('3D baskı figür — hizmet bedeli')).toBeNull();
    expect(screen.queryByText('3D baskı figür — ürün başına')).toBeNull();
    expect(screen.getByText('Yazarkasa kurulum')).toBeTruthy();
  });

  it('renders a single 3D print card that links to the wizard', () => {
    products.data = [
      makeProduct({ id: 'p-b', sku: 'print3d_base', category: 'service' }),
      makeProduct({ id: 'p-i', sku: 'print3d_item', category: 'service' }),
    ];
    renderStore();
    const cards = screen.getAllByTestId('print3d-store-card');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/store/print3d',
    );
  });

  it('hides the Hizmetler section heading when the only service rows are the print3d SKUs', () => {
    // Filtreyi düzeltip kapıyı düzeltmemek, boş bir ızgaranın üstünde
    // "Hizmetler" başlığı bırakırdı.
    products.data = [
      makeProduct({ id: 'p-b', sku: 'print3d_base', category: 'service' }),
      makeProduct({ id: 'p-i', sku: 'print3d_item', category: 'service' }),
    ];
    renderStore();
    expect(screen.queryByText(enHardware.store.servicesTitle)).toBeNull();
  });
```

> `within` ve `enHardware` bu dosyada zaten import edilmiş.

- [ ] **Adım 4: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store/StorePage.test.tsx -t "print3d"`
Expected: FAIL — `does not render the raw print3d SKUs…`: `expected null not to be null` (ham kartlar hâlâ basılıyor).

- [ ] **Adım 5: `StorePage`'i düzelt**

`frontend/src/features/hardware-store/StorePage.tsx` — import bloğuna:

```tsx
import { isPrint3dSku } from '../print3d/print3dSkus';
import Print3dStoreCard from '../print3d/Print3dStoreCard';
```

**(a) Bölüm kapısı ve ızgara filtresi.** Hizmet bölümünün koşulunu ve `.filter(...)`'ını değiştir:

```tsx
              {(category === 'all' || category === 'service') &&
                products.some(
                  (p) => p.category === 'service' && !isPrint3dSku(p.sku),
                ) && (
```

```tsx
                      {products
                        .filter((p) => p.category === 'service' && !isPrint3dSku(p.sku))
                        .map((p) => (
                          <ServiceCard key={p.id} p={p} />
                        ))}
```

**(b) Print3d kartı.** Hizmet bölümünün **dışına**, hizmet `<section>`'ının hemen üstüne (yani `<>` fragment'inin ilk çocuğu olarak) koy — böylece kapı onu gizlemez:

```tsx
              {/* v3.7.0 — TEK 3D baskı kartı. Hizmet bölümünün DIŞINDA:
                  bölüm kapısı ham print3d satırlarını eleyince kart da
                  kaybolurdu. Kartın kendisi teklif available:false ise
                  null render eder. */}
              {(category === 'all' || category === 'service') && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Print3dStoreCard />
                </div>
              )}
```

**(c) Derin bağlantı.** `useEffect` içindeki `if (product.category === 'service' || …)` dalından **önce**:

```tsx
    // v3.7.0 — ?sku=print3d_* derin bağlantısı ham detay sayfasına DEĞİL,
    // sihirbaza gider. Ham SKU tek başına satılabilir olmamalı.
    if (isPrint3dSku(sku)) {
      const next = new URLSearchParams(searchParams);
      next.delete('sku');
      setSearchParams(next, { replace: true });
      window.location.assign('/admin/store/print3d');
      return;
    }
```

- [ ] **Adım 6: Detay sayfası guard'ı için test yaz (kırmızı)**

`frontend/src/features/hardware-store/ProductDetailPage.test.tsx` — `describe` bloğuna:

```tsx
  it('redirects a print3d sku to the wizard instead of rendering a buyable service panel', () => {
    productState.data = {
      ...makeProduct(),
      sku: 'print3d_base',
      category: 'service',
      name: '3D baskı figür — hizmet bedeli',
      serviceMeta: { serviceType: 'print3d', role: 'base' },
    } as any;
    render(
      <MemoryRouter initialEntries={['/admin/store/print3d_base']}>
        <Routes>
          <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
          <Route path="/admin/store/print3d" element={<div>WIZARD</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('WIZARD')).toBeTruthy();
    // "Sepete ekle" paneli HİÇ basılmamalı: ham SKU tek başına sepete
    // girerse quote motoru ancak form doldurulduktan SONRA reddeder.
    expect(screen.queryByText(enHardware.common.addToCart)).toBeNull();
  });

  it('never labels a print3d service as Yerinde kurulum', () => {
    productState.data = {
      ...makeProduct(),
      sku: 'print3d_item',
      category: 'service',
      serviceMeta: { serviceType: 'print3d', role: 'item' },
    } as any;
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/store/print3d_item']}>
        <Routes>
          <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
          <Route path="/admin/store/print3d" element={<div>WIZARD</div>} />
        </Routes>
      </MemoryRouter>,
    );
    // Etiket zinciri bilinmeyen her serviceType'ı 'onsite'e düşürüyordu.
    expect(container.textContent).not.toContain(enHardware.store.service_.onsite);
  });
```

> Dosyanın üstüne `Routes`, `Route` importlarını ekle (`react-router-dom`) ve `enHardware`'ı import et — dosyada zaten var. `makeProduct` yardımcı fonksiyonu dosyada mevcut; yoksa `StorePage.test.tsx`'teki eşdeğerini kopyala.

- [ ] **Adım 7: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store/ProductDetailPage.test.tsx -t "print3d"`
Expected: FAIL — `Unable to find an element with the text: WIZARD`

- [ ] **Adım 8: Detay sayfasına guard ekle**

`frontend/src/features/hardware-store/ProductDetailPage.tsx` — `Navigate`'i import et (`import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';`), `isPrint3dSku`'yu import et (`import { isPrint3dSku } from '../print3d/print3dSkus';`) ve `const { data: product, isLoading, error } = useGetProductBySku(sku);` satırının **hemen ardına**, `isLoading` kontrolünden önce:

```tsx
  // v3.7.0 — ham print3d SKU'su TEK BAŞINA SATILABİLİR OLMAMALI.
  // /admin/store/print3d_base bu guard olmadan tam bir satın alma paneli
  // (şube seçici + tercih edilen tarihler + "Sepete ekle") basıyor ve quote
  // motoru ancak form doldurulduktan SONRA PRINT3D_INCOMPLETE_CART ile
  // reddediyordu. Üstelik etiket zinciri bilinmeyen serviceType'ı 'onsite'e
  // düşürdüğü için sayfa bir 3D baskı hizmetini "Yerinde kurulum" diye
  // etiketliyordu. (React Router statik segmenti dinamikten önce sıralar,
  // yani /admin/store/print3d rotası zaten kazanır; bu guard yazılan ya da
  // yer imlenen HAM SKU URL'leri içindir.)
  if (sku && isPrint3dSku(sku)) {
    return <Navigate to="/admin/store/print3d" replace />;
  }
```

- [ ] **Adım 9: Testleri ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store src/features/print3d
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: PASS / çıktısız.

- [ ] **Adım 10: Commit**

```bash
git add frontend/src/features/print3d/print3dApi.ts frontend/src/features/print3d/Print3dStoreCard.tsx frontend/src/features/hardware-store/StorePage.tsx frontend/src/features/hardware-store/StorePage.test.tsx frontend/src/features/hardware-store/ProductDetailPage.tsx frontend/src/features/hardware-store/ProductDetailPage.test.tsx
git commit -m "feat(print3d): mağazada tek kart, ham SKU'lar satılamaz

Hizmet ızgarası her category:'service' satırı için bir kart basıyordu; iki
print3d satırı ayrı ayrı görünüyor ve yanlış detay sayfasına gidiyordu.
Izgara filtresi VE bölüm kapısı birlikte düzeltildi — yalnız filtreyi
düzeltmek boş bir ızgaranın üstünde 'Hizmetler' başlığı bırakırdı.

Ham SKU detay rotası sihirbaza yönlendiriliyor: /admin/store/print3d_base
tam bir 'Sepete ekle' paneli basıyor ve bilinmeyen serviceType'ı 'Yerinde
kurulum' diye etiketliyordu."
```

---

## Görev 16: Sihirbaz adım 1 — menü ürünü seçici

**Files:**
- Create: `frontend/src/features/print3d/Print3dProductPicker.tsx`
- Test: `frontend/src/features/print3d/Print3dProductPicker.test.tsx`

**Interfaces:**
- Consumes: `computePrint3dTotalCents` (Görev 14); `formatMoney` (`hardware-store/storeApi`); `Product` (`frontend/src/types`); `hardware:print3d.picker.*` (Görev 13)
- Produces: `export default function Print3dProductPicker(props: { products: Product[]; selected: string[]; onChange: (ids: string[]) => void; maxSelection: number; basePriceCents: number; perItemCents: number; currency: string })`

- [ ] **Adım 1: Testi yaz (kırmızı)**

`frontend/src/features/print3d/Print3dProductPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import type { Product } from '../../types';
import Print3dProductPicker from './Print3dProductPicker';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

const product = (over: Partial<Product>): Product =>
  ({
    id: 'x',
    name: 'X',
    description: null,
    price: 100,
    image: null,
    images: [],
    categoryId: 'c-1',
    category: { id: 'c-1', name: 'Ana Yemek' },
    currentStock: 0,
    stockTracked: false,
    isAvailable: true,
    displayOrder: 0,
    tenantId: 't-1',
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as Product;

const PRODUCTS = [
  product({ id: 'p1', name: 'Adana Kebap' }),
  product({ id: 'p2', name: 'Lahmacun' }),
  product({
    id: 'p3',
    name: 'Künefe',
    categoryId: 'c-2',
    category: { id: 'c-2', name: 'Tatlı' } as any,
  }),
];

function renderPicker(selected: string[] = [], max = 50) {
  const onChange = vi.fn();
  render(
    <Print3dProductPicker
      products={PRODUCTS}
      selected={selected}
      onChange={onChange}
      maxSelection={max}
      basePriceCents={150000}
      perItemCents={5000}
      currency="TRY"
    />,
  );
  return { onChange };
}

describe('Print3dProductPicker', () => {
  it('filters the product list by the search box', () => {
    renderPicker();
    // ProductFilters.search SUNUCUDA uygulanmıyor; süzme istemci tarafında.
    fireEvent.change(screen.getByPlaceholderText(enHardware.print3d.picker.search), {
      target: { value: 'lahma' },
    });
    expect(screen.getByText('Lahmacun')).toBeTruthy();
    expect(screen.queryByText('Adana Kebap')).toBeNull();
  });

  it('filters by category', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText(enHardware.print3d.picker.allCategories), {
      target: { value: 'c-2' },
    });
    expect(screen.getByText('Künefe')).toBeTruthy();
    expect(screen.queryByText('Adana Kebap')).toBeNull();
  });

  it('toggles a product and reports the new selection upward', () => {
    const { onChange } = renderPicker(['p1']);
    fireEvent.click(screen.getByTestId('print3d-pick-p2'));
    expect(onChange).toHaveBeenCalledWith(['p1', 'p2']);
    fireEvent.click(screen.getByTestId('print3d-pick-p1'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('caps selection at maxSelection and disables further cards', () => {
    const { onChange } = renderPicker(['p1', 'p2'], 2);
    expect(screen.getByTestId('print3d-pick-p3')).toBeDisabled();
    fireEvent.click(screen.getByTestId('print3d-pick-p3'));
    expect(onChange).not.toHaveBeenCalled();
    // Zaten seçili olan bir kart, tavan dolu olsa da ÇIKARILABİLİR olmalı.
    expect(screen.getByTestId('print3d-pick-p1')).not.toBeDisabled();
  });

  it('updates the live price counter as products are toggled', () => {
    renderPicker(['p1', 'p2']);
    // 150.000 + 2 x 5.000 = 160.000 kuruş
    expect(screen.getByTestId('print3d-live-total').textContent).toContain('1.600,00');
  });

  it('shows the empty copy when the menu has no products', () => {
    render(
      <Print3dProductPicker
        products={[]}
        selected={[]}
        onChange={vi.fn()}
        maxSelection={50}
        basePriceCents={150000}
        perItemCents={5000}
        currency="TRY"
      />,
    );
    expect(screen.getByText(enHardware.print3d.picker.empty)).toBeTruthy();
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dProductPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./Print3dProductPicker"`

- [ ] **Adım 3: Seçiciyi yaz**

`frontend/src/features/print3d/Print3dProductPicker.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';
import type { Product } from '../../types';
import { formatMoney } from '../hardware-store/storeApi';
import { computePrint3dTotalCents } from './print3dSkus';

/**
 * Sihirbaz adım 1 — menü ürünü çoklu seçimi.
 *
 * Seçim durumu DIŞARIDA (`selected: string[]` + `onChange`) yaşar; sihirbaz
 * onu adımlar arasında taşır ve doğrudan sepet satırına yazar. Bileşenin
 * kendi içinde tuttuğu tek durum arama kutusu ve kategori süzgecidir.
 *
 * Arama İSTEMCİ TARAFINDA: ProductFilters.search sunucuda hiç okunmuyor,
 * yani `useProducts({ search })` çağırmak sessizce filtresiz liste döndürür.
 */
export default function Print3dProductPicker({
  products,
  selected,
  onChange,
  maxSelection,
  basePriceCents,
  perItemCents,
  currency,
}: {
  products: Product[];
  selected: string[];
  onChange: (ids: string[]) => void;
  maxSelection: number;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
}) {
  const { t } = useTranslation('hardware');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) {
      if (p.category?.id) byId.set(p.category.id, p.category.name);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [products]);

  const visible = useMemo(() => {
    // Türkçe küçültme: "İÇECEKLER".toLowerCase() İngilizce kurallarıyla
    // eşleşmez, bu yüzden tr-TR yerel ayarı verilir.
    const needle = search.toLocaleLowerCase('tr-TR').trim();
    return products.filter(
      (p) =>
        (!categoryId || p.category?.id === categoryId) &&
        (!needle || p.name.toLocaleLowerCase('tr-TR').includes(needle)),
    );
  }, [products, search, categoryId]);

  const selectedSet = new Set(selected);
  const atCap = selected.length >= maxSelection;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    if (atCap) return; // tavan dolu — sessiz no-op, düğme zaten disabled
    onChange([...selected, id]);
  };

  const totalCents = computePrint3dTotalCents(
    selected.length,
    basePriceCents,
    perItemCents,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-48 flex-1 rounded border px-3 py-1.5 text-sm"
          placeholder={t('print3d.picker.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={t('print3d.picker.allCategories')}
          className="rounded border px-2 py-1.5 text-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t('print3d.picker.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {products.length === 0 ? (
        <p className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('print3d.picker.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => {
            const picked = selectedSet.has(p.id);
            const thumb = p.images?.[0]?.url ?? p.image ?? null;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`print3d-pick-${p.id}`}
                aria-pressed={picked}
                disabled={!picked && atCap}
                onClick={() => toggle(p.id)}
                className={`overflow-hidden rounded-lg border text-left transition ${
                  picked ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {thumb ? (
                  <img src={thumb} alt={p.name} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 text-slate-300">
                    <ImageOff className="h-6 w-6" aria-hidden="true" />
                  </div>
                )}
                <div className="p-2">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-gray-500">
                    {formatMoney(Math.round(p.price * 100), currency)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-gray-50 p-3">
        <span className="text-sm text-gray-700">
          {t('print3d.picker.selectedCount', { count: selected.length })}
          {atCap && (
            <span className="ml-2 text-xs text-amber-700">
              {t('print3d.picker.maxReached', { max: maxSelection })}
            </span>
          )}
        </span>
        <span className="text-sm">
          <span className="text-gray-500">{t('print3d.picker.livePrice')}: </span>
          <strong data-testid="print3d-live-total">
            {formatMoney(totalCents, currency)}
          </strong>
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dProductPicker.test.tsx`
Expected: PASS — `6 passed`.

- [ ] **Adım 5: Commit**

```bash
git add frontend/src/features/print3d/Print3dProductPicker.tsx frontend/src/features/print3d/Print3dProductPicker.test.tsx
git commit -m "feat(print3d): sihirbaz adım 1 — menü ürünü seçici

Kart ızgarası, istemci-taraflı arama (ProductFilters.search sunucuda hiç
okunmuyor, sunucuya sormak sessizce filtresiz liste döndürürdü), kategori
süzgeci, 50'lik tavan ve canlı fiyat sayacı.

Seçim durumu DIŞARIDA yaşıyor: sihirbaz onu adımlar arasında taşıyor ve
doğrudan sepet satırına yazıyor. Tavan doluyken zaten seçili kartlar hâlâ
çıkarılabilir."
```

---

## Görev 17: Sihirbaz adım 2 — teslimat ve üretim notu

**Files:**
- Create: `frontend/src/features/print3d/Print3dShippingStep.tsx`
- Test: `frontend/src/features/print3d/Print3dShippingStep.test.tsx`

**Interfaces:**
- Consumes: `ShippingAddressForm` + `ShippingAddress` (`hardware-store`), `Branch` (`features/branches`), `hardware:print3d.shipping.*` (Görev 13)
- Produces: `export default function Print3dShippingStep(props: { branches: Branch[]; initialAddress?: ShippingAddress; notes: string; onNotesChange: (v: string) => void; onSubmit: (r: { address: ShippingAddress; branchId?: string }) => void; submitting?: boolean })`; not alanı üst sınırı **500 karakter**

- [ ] **Adım 1: Testi yaz (kırmızı)**

`frontend/src/features/print3d/Print3dShippingStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

// ShippingAddressForm'un kendi spec'i var; burada onu bir düğmeye indirgeyip
// SİHİRBAZIN kablolamasını test ediyoruz.
vi.mock('../hardware-store/ShippingAddressForm', () => ({
  default: ({
    onSubmit,
    submitLabel,
  }: {
    onSubmit: (r: any) => void;
    submitLabel?: string;
  }) => (
    <button
      data-testid="ship-submit"
      onClick={() =>
        onSubmit({
          address: {
            recipientName: 'Op',
            phone: '+90',
            line1: 'L1',
            city: 'İstanbul',
            country: 'Türkiye',
          },
          branchId: 'br-1',
        })
      }
    >
      {submitLabel}
    </button>
  ),
}));

import Print3dShippingStep from './Print3dShippingStep';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

describe('Print3dShippingStep', () => {
  it('reports the address and branchId upward', () => {
    const onSubmit = vi.fn();
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId('ship-submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'br-1' }),
    );
  });

  it('reports note edits upward', () => {
    const onNotesChange = vi.fn();
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={onNotesChange}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(enHardware.print3d.shipping.notesLabel), {
      target: { value: 'Kırmızı boya' },
    });
    expect(onNotesChange).toHaveBeenCalledWith('Kırmızı boya');
  });

  it('caps the production note at 500 characters', () => {
    // Backend CartItemDto.notes @MaxLength(500). Tarayıcı tarafında da
    // sınırlanmazsa alıcı 600 karakter yazıp ödemede 400 alır.
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(enHardware.print3d.shipping.notesLabel),
    ).toHaveAttribute('maxlength', '500');
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dShippingStep.test.tsx`
Expected: FAIL — `Failed to resolve import "./Print3dShippingStep"`

- [ ] **Adım 3: Adımı yaz**

`frontend/src/features/print3d/Print3dShippingStep.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import ShippingAddressForm from '../hardware-store/ShippingAddressForm';
import type { ShippingAddress } from '../hardware-store/storeApi';
import type { Branch } from '../branches/branchesApi';

/**
 * Sihirbaz adım 2 — teslimat.
 *
 * Mevcut ShippingAddressForm AYNEN yeniden kullanılıyor (şubeye gönder /
 * manuel adres, branchId döndürür); tek eklenen şey üretim notu.
 *
 * Not üst sınırı 500: backend CartItemDto.notes @MaxLength(500) taşıyor,
 * yani burada sınırlamazsak alıcı yazdıklarını ödemede 400 olarak görür.
 */
export default function Print3dShippingStep({
  branches,
  initialAddress,
  notes,
  onNotesChange,
  onSubmit,
  submitting,
}: {
  branches: Branch[];
  initialAddress?: ShippingAddress;
  notes: string;
  onNotesChange: (v: string) => void;
  onSubmit: (r: { address: ShippingAddress; branchId?: string }) => void;
  submitting?: boolean;
}) {
  const { t } = useTranslation('hardware');
  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="print3d-notes"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          {t('print3d.shipping.notesLabel')}
        </label>
        <textarea
          id="print3d-notes"
          rows={3}
          maxLength={500}
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder={t('print3d.shipping.notesPlaceholder')}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
        <p className="mt-1 text-right text-[11px] text-gray-400">
          {notes.length}/500
        </p>
      </div>

      <ShippingAddressForm
        initial={initialAddress}
        branches={branches}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel={t('print3d.shipping.continue')}
      />
    </div>
  );
}
```

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dShippingStep.test.tsx`
Expected: PASS — `3 passed`.

- [ ] **Adım 5: Commit**

```bash
git add frontend/src/features/print3d/Print3dShippingStep.tsx frontend/src/features/print3d/Print3dShippingStep.test.tsx
git commit -m "feat(print3d): sihirbaz adım 2 — teslimat ve üretim notu

Mevcut ShippingAddressForm aynen yeniden kullanılıyor (şubeye gönder /
manuel adres, branchId döndürür); üstüne 500 karakterlik üretim notu.
Sınır tarayıcıda da uygulanıyor: backend CartItemDto.notes @MaxLength(500),
yoksa alıcı yazdıklarını ancak ödemede 400 olarak görürdü."
```

---

## Görev 18: Sihirbaz adım 3 — özet, onam, sunucu toplamı

İstemci aritmetiği **asla nihai değildir**: Öde düğmesi ancak sunucudan gelen toplam doğrulandıktan sonra açılır.

**Files:**
- Create: `frontend/src/features/print3d/Print3dSummary.tsx`
- Test: `frontend/src/features/print3d/Print3dSummary.test.tsx`

**Interfaces:**
- Consumes: `CheckoutConsent` + `useConsentComplete` (`features/legal`), `formatMoney` (`hardware-store/storeApi`), `PartnerBadge` (Görev 14), `hardware:print3d.summary.*` (Görev 13)
- Produces: `export default function Print3dSummary(props: { itemCount: number; basePriceCents: number; perItemCents: number; currency: string; partnerUrl: string | null; accepted: string[]; onAcceptedChange: (ids: string[]) => void; serverTotalCents: number | null; verifying: boolean; onPay: () => void; paying: boolean })`

- [ ] **Adım 1: Testi yaz (kırmızı)**

`frontend/src/features/print3d/Print3dSummary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

let consentComplete = true;
vi.mock('../legal/CheckoutConsent', () => ({
  default: () => null,
  useConsentComplete: () => consentComplete,
}));

import Print3dSummary from './Print3dSummary';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function renderSummary(over: Partial<Record<string, unknown>> = {}) {
  const onPay = vi.fn();
  render(
    <Print3dSummary
      itemCount={10}
      basePriceCents={150000}
      perItemCents={5000}
      currency="TRY"
      partnerUrl="https://figurunica.com"
      accepted={['a', 'b', 'c']}
      onAcceptedChange={vi.fn()}
      serverTotalCents={200000}
      verifying={false}
      onPay={onPay}
      paying={false}
      {...(over as any)}
    />,
  );
  return { onPay };
}

describe('Print3dSummary', () => {
  it('renders the base line, the per-item line, zero shipping and the server total', () => {
    renderSummary();
    expect(screen.getByTestId('print3d-line-base').textContent).toContain('1.500,00');
    expect(screen.getByTestId('print3d-line-items').textContent).toContain('500,00');
    // Kargo BİLEREK ₺0 — "kargo dahil" vaadi. Satır yine de gösteriliyor.
    expect(screen.getByTestId('print3d-line-shipping').textContent).toContain('0,00');
    expect(screen.getByTestId('print3d-total').textContent).toContain('2.000,00');
  });

  it('keeps the pay button disabled until all three legal documents are ticked', () => {
    consentComplete = false;
    const { onPay } = renderSummary();
    const btn = screen.getByRole('button', { name: enHardware.print3d.summary.pay });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onPay).not.toHaveBeenCalled();
    consentComplete = true;
  });

  it('keeps the pay button disabled while the server total is still unverified', () => {
    const { onPay } = renderSummary({ serverTotalCents: null, verifying: true });
    const btn = screen.getByRole('button', { name: enHardware.print3d.summary.pay });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onPay).not.toHaveBeenCalled();
    expect(screen.getByText(enHardware.print3d.summary.verifying)).toBeTruthy();
  });

  it('warns and blocks payment when the server total disagrees with the local arithmetic', () => {
    // İstemci aritmetiği ASLA nihai değildir. Ayrışma varsa ödeme açılmaz.
    const { onPay } = renderSummary({ serverTotalCents: 199000 });
    expect(screen.getByText(enHardware.print3d.summary.mismatch)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    expect(onPay).not.toHaveBeenCalled();
  });

  it('fires onPay once everything checks out', () => {
    const { onPay } = renderSummary();
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    expect(onPay).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dSummary.test.tsx`
Expected: FAIL — `Failed to resolve import "./Print3dSummary"`

- [ ] **Adım 3: Özeti yaz**

`frontend/src/features/print3d/Print3dSummary.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import CheckoutConsent, { useConsentComplete } from '../legal/CheckoutConsent';
import { formatMoney } from '../hardware-store/storeApi';
import { computePrint3dTotalCents } from './print3dSkus';
import PartnerBadge from './PartnerBadge';

/**
 * Sihirbaz adım 3 — satır dökümü, yasal onam, ödeme.
 *
 * ÜÇ KAPI, üçü de Öde düğmesini kilitler:
 *   1. üç sözleşme işaretlenmeden ödeme yok;
 *   2. sunucudan gerçek toplam gelmeden ödeme yok (istemci aritmetiği
 *      yalnızca önizlemedir);
 *   3. sunucu toplamı yerel hesapla ayrışıyorsa ödeme yok — böyle bir
 *      ayrışma katalog fiyatının değiştiği anlamına gelir ve alıcıya
 *      gösterilen tutardan farklı bir tutar çekilmemelidir.
 */
export default function Print3dSummary({
  itemCount,
  basePriceCents,
  perItemCents,
  currency,
  partnerUrl,
  accepted,
  onAcceptedChange,
  serverTotalCents,
  verifying,
  onPay,
  paying,
}: {
  itemCount: number;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
  partnerUrl: string | null;
  accepted: string[];
  onAcceptedChange: (ids: string[]) => void;
  serverTotalCents: number | null;
  verifying: boolean;
  onPay: () => void;
  paying: boolean;
}) {
  const { t } = useTranslation('hardware');
  const consentGiven = useConsentComplete(accepted);
  const localTotal = computePrint3dTotalCents(
    itemCount,
    basePriceCents,
    perItemCents,
  );
  const mismatch = serverTotalCents !== null && serverTotalCents !== localTotal;
  const canPay =
    consentGiven && !verifying && !paying && serverTotalCents !== null && !mismatch;

  return (
    <div className="space-y-4">
      <PartnerBadge url={partnerUrl} />

      <div className="space-y-1 rounded border bg-white p-4 text-sm">
        <Row
          testId="print3d-line-base"
          label={t('print3d.summary.baseLine')}
          value={formatMoney(basePriceCents, currency)}
        />
        <Row
          testId="print3d-line-items"
          label={t('print3d.summary.itemLine', { count: itemCount })}
          value={formatMoney(perItemCents * itemCount, currency)}
        />
        {/* Kargo BİLEREK 0: hizmet-yalnız sepette QuoteService kargo eklemez
            ve ilan edilen fiyat "kargo dahil". Satırı gizlemek alıcıyı
            "kargo sonra eklenecek mi?" sorusuyla bırakırdı. */}
        <Row
          testId="print3d-line-shipping"
          label={t('print3d.summary.shipping')}
          value={formatMoney(0, currency)}
        />
        <div className="mt-2 border-t pt-2">
          <Row
            testId="print3d-total"
            label={t('print3d.summary.total')}
            value={formatMoney(serverTotalCents ?? localTotal, currency)}
            bold
          />
        </div>
      </div>

      {verifying && (
        <p className="text-xs text-gray-500">{t('print3d.summary.verifying')}</p>
      )}
      {mismatch && (
        <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {t('print3d.summary.mismatch')}
        </p>
      )}

      <div className="border-t pt-3">
        <h3 className="mb-2 text-xs font-semibold text-gray-900">
          {t('print3d.summary.consentTitle')}
        </h3>
        <CheckoutConsent accepted={accepted} onChange={onAcceptedChange} />
        {!consentGiven && (
          <p className="mt-2 text-xs text-amber-700">
            {t('print3d.summary.consentRequired')}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!canPay}
        onClick={() => canPay && onPay()}
        className="w-full rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('print3d.summary.pay')}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  testId,
}: {
  label: string;
  value: string;
  bold?: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center justify-between ${bold ? 'font-semibold' : ''}`}
    >
      <span className="text-gray-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}
```

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dSummary.test.tsx`
Expected: PASS — `5 passed`.

- [ ] **Adım 5: Commit**

```bash
git add frontend/src/features/print3d/Print3dSummary.tsx frontend/src/features/print3d/Print3dSummary.test.tsx
git commit -m "feat(print3d): sihirbaz adım 3 — özet, onam ve sunucu toplamı

Öde düğmesini üç kapı birden kilitliyor: üç sözleşme işaretlenmeden,
sunucudan gerçek toplam gelmeden, ve sunucu toplamı yerel hesapla
ayrışıyorken ödeme açılmıyor. İstemci aritmetiği yalnızca önizleme.

Kargo satırı ₺0 olarak GÖSTERİLİYOR: gizlemek alıcıyı 'kargo sonra mı
eklenecek?' sorusuyla bırakırdı."
```

---

## Görev 19: Sihirbaz sayfası ve rotalar

**Files:**
- Create: `frontend/src/features/print3d/Print3dWizardPage.tsx`
- Modify: `frontend/src/App.tsx` (lazy import bloğu ~39-44; admin rotaları ~807-818)
- Test: `frontend/src/features/print3d/Print3dWizardPage.test.tsx`

**Interfaces:**
- Consumes: `Print3dProductPicker` (Görev 16), `Print3dShippingStep` (Görev 17), `Print3dSummary` (Görev 18), `useGetPrint3dOffer` (Görev 15), `useCreateCheckoutIntent` + `useQuoteCart` + `stashPendingCheckoutRef` (`hardware-store`), `useProducts` (`features/menu/menuApi`), `useListBranches` (`features/branches/branchesApi`), `PRINT3D_BASE_SKU` / `PRINT3D_ITEM_SKU` (Görev 14)
- Produces: `export default function Print3dWizardPage()`; rota `/admin/store/print3d`; gönderilen sepet **tam olarak iki satır**

- [ ] **Adım 1: Testi yaz (kırmızı)**

`frontend/src/features/print3d/Print3dWizardPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

const offer = {
  data: {
    available: true,
    basePriceCents: 150000,
    perItemCents: 5000,
    currency: 'TRY',
    minItems: 1,
    maxItems: 50,
    partnerName: 'Figurunica',
    partnerUrl: 'https://figurunica.com',
  },
};
const quote = { mutateAsync: vi.fn(), isPending: false };
const intent = { mutateAsync: vi.fn(), isPending: false };
const menuProducts = {
  data: [
    { id: 'p1', name: 'Adana Kebap', price: 100, image: null, images: [], categoryId: 'c1', category: { id: 'c1', name: 'Ana' } },
    { id: 'p2', name: 'Lahmacun', price: 80, image: null, images: [], categoryId: 'c1', category: { id: 'c1', name: 'Ana' } },
  ],
  isLoading: false,
};

vi.mock('./print3dApi', () => ({ useGetPrint3dOffer: () => offer }));
vi.mock('../menu/menuApi', () => ({ useProducts: () => menuProducts }));
vi.mock('../branches/branchesApi', () => ({ useListBranches: () => ({ data: [] }) }));
vi.mock('../hardware-store/storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware-store/storeApi')>();
  return { ...actual, useQuoteCart: () => quote, useCreateCheckoutIntent: () => intent };
});
vi.mock('../hardware-store/checkoutRef', () => ({
  stashPendingCheckoutRef: vi.fn(),
}));
vi.mock('../hardware-store/ShippingAddressForm', () => ({
  default: ({ onSubmit }: { onSubmit: (r: any) => void }) => (
    <button
      data-testid="ship-submit"
      onClick={() =>
        onSubmit({
          address: { recipientName: 'Op', phone: '+90', line1: 'L1', city: 'İstanbul', country: 'Türkiye' },
          branchId: 'br-1',
        })
      }
    >
      ship
    </button>
  ),
}));

let consentComplete = true;
let acceptedIds = ['doc-kvkk', 'doc-sales', 'doc-refund'];
vi.mock('../legal/CheckoutConsent', () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button data-testid="tick-consents" onClick={() => onChange(acceptedIds)}>
      consents
    </button>
  ),
  useConsentComplete: () => consentComplete,
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: any) =>
    sel({ user: { email: 'op@x.com', firstName: 'Op', lastName: 'E', phone: '+905550000000' } }),
}));

import Print3dWizardPage from './Print3dWizardPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function renderWizard() {
  return render(
    <MemoryRouter>
      <Print3dWizardPage />
    </MemoryRouter>,
  );
}

/** Adım 1 → 2 → 3: iki ürün seç, adresi gönder. */
async function walkToSummary() {
  fireEvent.click(screen.getByTestId('print3d-pick-p1'));
  fireEvent.click(screen.getByTestId('print3d-pick-p2'));
  fireEvent.click(screen.getByText(enHardware.print3d.wizard.next));
  fireEvent.click(await screen.findByTestId('ship-submit'));
  await screen.findByTestId('print3d-total');
}

describe('Print3dWizardPage', () => {
  beforeEach(() => {
    consentComplete = true;
    quote.mutateAsync.mockReset();
    quote.mutateAsync.mockResolvedValue({ totalCents: 160000, shippingCents: 0 });
    intent.mutateAsync.mockReset();
    intent.mutateAsync.mockResolvedValue({
      paymentRef: 'CK-1',
      paymentLink: 'https://paytr.example/pay',
    });
  });

  it('asks the server for the real total before enabling payment', async () => {
    renderWizard();
    await walkToSummary();
    expect(quote.mutateAsync).toHaveBeenCalledWith({
      items: [
        { type: 'service', code: 'print3d_base', qty: 1, branchId: 'br-1' },
        {
          type: 'service',
          code: 'print3d_item',
          qty: 2,
          branchId: 'br-1',
          productIds: ['p1', 'p2'],
          notes: undefined,
        },
      ],
    });
  });

  it('posts exactly two service lines with productIds and acceptedDocumentIds', async () => {
    renderWizard();
    await walkToSummary();
    fireEvent.click(screen.getByTestId('tick-consents'));
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    await waitFor(() => expect(intent.mutateAsync).toHaveBeenCalled());
    const body = intent.mutateAsync.mock.calls[0][0];
    expect(body.cart.items).toHaveLength(2);
    expect(body.cart.items[1]).toMatchObject({
      code: 'print3d_item',
      qty: 2,
      productIds: ['p1', 'p2'],
    });
    expect(body.acceptedDocumentIds).toEqual(['doc-kvkk', 'doc-sales', 'doc-refund']);
    expect(body.branchId).toBe('br-1');
  });

  it('keeps the pay button disabled until all three legal documents are ticked', async () => {
    consentComplete = false;
    renderWizard();
    await walkToSummary();
    const btn = screen.getByRole('button', { name: enHardware.print3d.summary.pay });
    expect(btn).toBeDisabled();
  });

  it('redirects to paymentLink on success', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, origin: 'https://app.example' },
      writable: true,
    });
    renderWizard();
    await walkToSummary();
    fireEvent.click(screen.getByTestId('tick-consents'));
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://paytr.example/pay'));
  });

  it('shows the unavailable copy and no picker when the offer is closed', () => {
    offer.data = { ...offer.data, available: false };
    renderWizard();
    expect(screen.getByText(enHardware.print3d.wizard.unavailable)).toBeTruthy();
    expect(screen.queryByTestId('print3d-pick-p1')).toBeNull();
    offer.data = { ...offer.data, available: true };
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d/Print3dWizardPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./Print3dWizardPage"`

- [ ] **Adım 3: Sihirbaz sayfasını yaz**

`frontend/src/features/print3d/Print3dWizardPage.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProducts } from '../menu/menuApi';
import { useListBranches } from '../branches/branchesApi';
import {
  useCreateCheckoutIntent,
  useQuoteCart,
  type CartItem,
  type ShippingAddress,
} from '../hardware-store/storeApi';
import { stashPendingCheckoutRef } from '../hardware-store/checkoutRef';
import { useAuthStore } from '../../store/authStore';
import { useGetPrint3dOffer } from './print3dApi';
import { PRINT3D_BASE_SKU, PRINT3D_ITEM_SKU } from './print3dSkus';
import Print3dProductPicker from './Print3dProductPicker';
import Print3dShippingStep from './Print3dShippingStep';
import Print3dSummary from './Print3dSummary';
import PartnerBadge from './PartnerBadge';

/**
 * /admin/store/print3d — bağımsız üç adımlı sihirbaz.
 *
 * PAYLAŞILAN cartStore KULLANILMAZ: o mağazanın sepeti hizmet satırlarının
 * adedini yönetmiyor (setQty hizmet satırına dokunmuyor), yani çoklu-ürün
 * adedi oradan ifade edilemez. Sihirbaz kendi İKİ satırlık sepetini üretir:
 *
 *   [ { service print3d_base, qty 1 },
 *     { service print3d_item, qty N, productIds: [...] } ]
 *
 * qty burada yalnızca nezaket; sunucu adedi productIds'ten türetir.
 */
export default function Print3dWizardPage() {
  const { t } = useTranslation('hardware');
  const user = useAuthStore((s: any) => s.user);
  const { data: offer } = useGetPrint3dOffer();
  const { data: products = [] } = useProducts();
  const { data: branches = [] } = useListBranches();
  const quote = useQuoteCart();
  const intent = useCreateCheckoutIntent();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState<ShippingAddress | null>(null);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [serverTotalCents, setServerTotalCents] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (!offer?.available) {
    return (
      <div className="space-y-3 p-6">
        <Link to="/admin/store?tab=hardware" className="text-sm text-blue-600 hover:underline">
          {t('common.backToStore')}
        </Link>
        <p className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('print3d.wizard.unavailable')}
        </p>
      </div>
    );
  }

  /** Sunucuya gidecek İKİ satır. Tek üretim yeri — sapma olmasın. */
  const buildCartItems = (): CartItem[] => [
    { type: 'service', code: PRINT3D_BASE_SKU, qty: 1, branchId },
    {
      type: 'service',
      code: PRINT3D_ITEM_SKU,
      qty: selected.length,
      branchId,
      productIds: selected,
      notes: notes.trim() || undefined,
    },
  ];

  async function onShippingSubmit(r: { address: ShippingAddress; branchId?: string }) {
    setAddress(r.address);
    setBranchId(r.branchId);
    setStep(3);
    // Özete geçerken SUNUCU TOPLAMINI iste. İstemci aritmetiği yalnızca
    // önizlemedir; Öde düğmesi bu yanıt gelene kadar kilitli kalır.
    setVerifying(true);
    setServerTotalCents(null);
    try {
      const q = await quote.mutateAsync({
        items: [
          { type: 'service', code: PRINT3D_BASE_SKU, qty: 1, branchId: r.branchId },
          {
            type: 'service',
            code: PRINT3D_ITEM_SKU,
            qty: selected.length,
            branchId: r.branchId,
            productIds: selected,
            notes: notes.trim() || undefined,
          },
        ],
      });
      setServerTotalCents(q.totalCents);
    } finally {
      setVerifying(false);
    }
  }

  async function pay() {
    if (!user || !address) return;
    const result = await intent.mutateAsync({
      cart: { items: buildCartItems(), shippingAddress: address },
      buyer: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        phone: user.phone ?? '',
        address: `${address.line1}, ${address.city}`,
      },
      returnUrl: `${window.location.origin}/admin/store?tab=hardware&intent=pending`,
      branchId,
      acceptedDocumentIds: accepted,
    });
    stashPendingCheckoutRef(result.paymentRef);
    if (result.paymentLink) window.location.assign(result.paymentLink);
  }

  return (
    <div className="space-y-4 p-6">
      <Link to="/admin/store?tab=hardware" className="text-sm text-blue-600 hover:underline">
        {t('common.backToStore')}
      </Link>

      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{t('print3d.wizard.title')}</h1>
        <PartnerBadge url={offer.partnerUrl} />
        <ol className="flex flex-wrap gap-3 pt-2 text-xs">
          {[
            t('print3d.wizard.stepProducts'),
            t('print3d.wizard.stepShipping'),
            t('print3d.wizard.stepSummary'),
          ].map((label, i) => (
            <li
              key={label}
              className={
                step === i + 1 ? 'font-semibold text-violet-700' : 'text-gray-400'
              }
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </header>

      {step === 1 && (
        <>
          <Print3dProductPicker
            products={products}
            selected={selected}
            onChange={setSelected}
            maxSelection={offer.maxItems}
            basePriceCents={offer.basePriceCents}
            perItemCents={offer.perItemCents}
            currency={offer.currency}
          />
          <button
            type="button"
            disabled={selected.length < offer.minItems}
            onClick={() => setStep(2)}
            className="rounded bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {t('print3d.wizard.next')}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <Print3dShippingStep
            branches={branches}
            initialAddress={address ?? undefined}
            notes={notes}
            onNotesChange={setNotes}
            onSubmit={onShippingSubmit}
            submitting={quote.isPending}
          />
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-gray-600 hover:underline"
          >
            {t('print3d.wizard.back')}
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <Print3dSummary
            itemCount={selected.length}
            basePriceCents={offer.basePriceCents}
            perItemCents={offer.perItemCents}
            currency={offer.currency}
            partnerUrl={offer.partnerUrl}
            accepted={accepted}
            onAcceptedChange={setAccepted}
            serverTotalCents={serverTotalCents}
            verifying={verifying}
            onPay={pay}
            paying={intent.isPending}
          />
          <button
            type="button"
            onClick={() => setStep(2)}
            className="text-sm text-gray-600 hover:underline"
          >
            {t('print3d.wizard.back')}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Adım 4: Rotayı bağla**

`frontend/src/App.tsx` — lazy import bloğuna (`MarketplaceAdminPage` tanımının yanına):

```tsx
const Print3dWizardPage = lazyWithReload(
  () => import("./features/print3d/Print3dWizardPage"),
);
```

Admin rotalarına, `<Route path="/admin/store/:sku" element={<ProductDetailPage />} />` satırının **hemen üstüne**:

```tsx
            {/* v3.7.0 — statik segment, dinamik :sku'dan önce sıralanır
                (React Router v6 sıralaması), ama okunurluk için de üstte. */}
            <Route path="/admin/store/print3d" element={<Print3dWizardPage />} />
```

- [ ] **Adım 5: Testleri ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: PASS — sihirbaz `5 passed`; `tsc` çıktısız.

- [ ] **Adım 6: Commit**

```bash
git add frontend/src/features/print3d/Print3dWizardPage.tsx frontend/src/features/print3d/Print3dWizardPage.test.tsx frontend/src/App.tsx
git commit -m "feat(print3d): üç adımlı sihirbaz ve /admin/store/print3d rotası

Paylaşılan cartStore KULLANILMIYOR: o sepet hizmet satırlarının adedini
yönetmiyor, yani çoklu-ürün adedi oradan ifade edilemez. Sihirbaz kendi iki
satırlık sepetini üretiyor ve özet adımına geçerken sunucudan GERÇEK toplamı
alıyor — Öde düğmesi o yanıt gelene kadar kilitli.

Teklif available:false ise sihirbaz hiç açılmıyor."
```

---

## Görev 20: Kiracı sipariş ekranları — boş kalem tablosu yerine print3d bloğu

**Files:**
- Modify: `frontend/src/features/hardware-store/storeApi.ts` (`HardwareOrderSummary` / `HardwareOrderDetail` tipleri ~340-360)
- Modify: `frontend/src/features/hardware-store/HardwareOrderDetailPage.tsx` (kalem tablosu ~76-108)
- Modify: `frontend/src/features/hardware-store/HardwareOrdersListPage.tsx` (`itemCount` hücresi ~142)
- Modify: `frontend/src/features/hardware-store/HardwareCheckoutResult.tsx`
- Test: `frontend/src/features/hardware-store/HardwareOrderDetailPage.test.tsx` (ekleme)
- Test: `frontend/src/features/hardware-store/HardwareOrdersListPage.test.tsx` (ekleme)

**Interfaces:**
- Consumes: `hardware-orders.service` `print3dJob` include (Görev 9); `PartnerBadge` (Görev 14); `hardware:print3d.order.*` / `print3d.result.note` (Görev 13)
- Produces: `export interface HardwareOrderPrint3dJob { id: string; status: string; itemCount: number; totalCents: number; partner: string; items: { productName: string; productImageUrl: string | null; position: number; status: string }[] }`; `HardwareOrderSummary.print3dJob?: HardwareOrderPrint3dJob | null`; `HardwareOrderDetail.print3dJob?: HardwareOrderPrint3dJob | null`

- [ ] **Adım 1: Testleri yaz (kırmızı)**

`frontend/src/features/hardware-store/HardwareOrderDetailPage.test.tsx` — `describe`'a ekle:

```tsx
  it('renders the 3D print block instead of an empty item table when the order carries a print3dJob', () => {
    orderState.data = makeOrder({
      items: [],
      print3dJob: {
        id: 'job-1',
        status: 'queued',
        itemCount: 2,
        totalCents: 160000,
        partner: 'figurunica',
        items: [
          { productName: 'Adana Kebap', productImageUrl: '/img/a.jpg', position: 0, status: 'pending' },
          { productName: 'Lahmacun', productImageUrl: null, position: 1, status: 'pending' },
        ],
      },
    } as any);
    render(
      <MemoryRouter>
        <HardwareOrderDetailPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(enHardware.print3d.order.blockTitle)).toBeTruthy();
    expect(screen.getByText('Adana Kebap')).toBeTruthy();
    expect(screen.getByText('Lahmacun')).toBeTruthy();
    expect(screen.getByText(enHardware.print3d.partnerLabel)).toBeTruthy();
  });
```

`frontend/src/features/hardware-store/HardwareOrdersListPage.test.tsx` — `describe`'a ekle:

```tsx
  it('shows the print3d item count for a service-only order', () => {
    // Backend itemCount alanını hiç döndürmüyor (yalnız FE tipinde var), o
    // yüzden yalnız-hizmet siparişinde bu sütun boş kalıyordu.
    orders.data = [
      makeOrder({
        itemCount: undefined,
        print3dJob: { id: 'job-1', status: 'queued', itemCount: 7, totalCents: 185000, partner: 'figurunica', items: [] },
      }) as any,
    ];
    render(
      <MemoryRouter>
        <HardwareOrdersListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('7')).toBeTruthy();
  });
```

> Her iki dosyada `makeOrder` / `orders` / `orderState` yardımcıları zaten var; alan adlarını dosyadaki mevcut kullanıma göre eşle.

- [ ] **Adım 2: Testleri çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store/HardwareOrderDetailPage.test.tsx src/features/hardware-store/HardwareOrdersListPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 3D printed figurine order`

- [ ] **Adım 3: Tipleri genişlet**

`frontend/src/features/hardware-store/storeApi.ts` — `HardwareOrderSummary` arayüzünün **üstüne**:

```ts
/**
 * v3.7.0 — yalnız-hizmet print3d siparişinde `items` BOŞTUR (hizmet satırları
 * HardwareOrderItem üretmiyor). İş kaydı kalem listesini ve adedini taşır.
 */
export interface HardwareOrderPrint3dJob {
  id: string;
  status: string;
  itemCount: number;
  totalCents: number;
  partner: string;
  items: {
    productName: string;
    productImageUrl: string | null;
    position: number;
    status: string;
  }[];
}
```

`HardwareOrderSummary` içine (`itemCount: number;` satırının ardına):

```ts
  print3dJob?: HardwareOrderPrint3dJob | null;
```

(`HardwareOrderDetail` zaten `extends HardwareOrderSummary` olduğu için ayrıca eklemeye gerek yok.)

- [ ] **Adım 4: Detay sayfasına print3d dalını ekle**

`frontend/src/features/hardware-store/HardwareOrderDetailPage.tsx` — import bloğuna `import PartnerBadge from '../print3d/PartnerBadge';` ekle ve kalem tablosunu saran `<section>` içinde tabloyu koşullu yap:

```tsx
          {order.items.length === 0 && order.print3dJob ? (
            <div className="space-y-2" data-testid="print3d-order-block">
              <h3 className="text-sm font-semibold">
                {t('print3d.order.blockTitle')}
              </h3>
              <p className="text-xs text-gray-500">
                {t('print3d.order.itemLine', { count: order.print3dJob.itemCount })}
              </p>
              <ul className="divide-y text-sm">
                {order.print3dJob.items.map((it) => (
                  <li key={`${it.position}-${it.productName}`} className="flex items-center gap-2 py-2">
                    {it.productImageUrl && (
                      <img src={it.productImageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                    )}
                    <span>{it.productName}</span>
                  </li>
                ))}
              </ul>
              <PartnerBadge url="https://figurunica.com" />
            </div>
          ) : (
            <table className="w-full text-sm">
              {/* mevcut thead + tbody OLDUĞU GİBİ kalır */}
            </table>
          )}
```

> Mevcut `<table>` bloğunu silmeden yukarıdaki koşullunun `else` dalına taşı. `PartnerBadge`'in `url` prop'u burada kaynaktan gelmiyor — sipariş yanıtı ortak URL'ini taşımıyor ve rozet metni URL olmadan da basılır; sabit `https://figurunica.com` vermek yerine `null` geçmek de kabul edilebilir, ama bağlantı vermek alıcıya değer katar ve `safePartnerUrl` onu zaten süzüyor.

- [ ] **Adım 5: Liste sayfasındaki `itemCount` sütununu besle**

`frontend/src/features/hardware-store/HardwareOrdersListPage.tsx` — `OrderRow` içindeki `{order.itemCount}` hücresini değiştir:

```tsx
      {/* v3.7.0 — backend itemCount alanını hiç döndürmüyor (yalnız FE
          tipinde var); yalnız-hizmet print3d siparişinde sütun boş kalıyordu. */}
      <td className="px-4 py-2 text-gray-700">
        {order.print3dJob?.itemCount ?? order.itemCount}
      </td>
```

- [ ] **Adım 6: Dönüş ekranına print3d notunu ekle**

`frontend/src/features/hardware-store/HardwareCheckoutResult.tsx` — `matchedOrder` bulunduktan sonra, başarı dalının içine:

```tsx
      {matchedOrder?.print3dJob && (
        <div className="mt-2 space-y-1">
          <p className="text-sm text-gray-700">{t('print3d.result.note')}</p>
          <PartnerBadge url="https://figurunica.com" />
        </div>
      )}
```

ve `import PartnerBadge from '../print3d/PartnerBadge';` ekle.

- [ ] **Adım 7: Testleri ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/hardware-store
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: PASS / çıktısız.

- [ ] **Adım 8: Commit**

```bash
git add frontend/src/features/hardware-store frontend/src/features/print3d
git commit -m "feat(print3d): kiracı sipariş ekranları boş kalem tablosu göstermiyor

Yalnız-hizmet bir siparişte order.items boş; detay sayfası bunun yerine
3D baskı bloğunu (kalem adları + fotoğraflar + ortak rozeti), liste sayfası
ise print3dJob.itemCount'u basıyor — itemCount sütunu backend'in hiç
döndürmediği bir alana bakıyordu.

PayTR dönüş ekranı da siparişin üretim kuyruğuna girdiğini söylüyor."
```

---

## Görev 21: Superadmin üretim paneli

**Files:**
- Create: `frontend/src/features/superadmin/api/superadminPrint3dApi.ts`
- Create: `frontend/src/pages/superadmin/print3dManifestCsv.ts`
- Create: `frontend/src/pages/superadmin/Print3dProductionPage.tsx`
- Modify: `frontend/src/features/superadmin/components/SuperAdminSidebar.tsx` (`lucide-react` importu ~5-17; `navigation` dizisi ~21-32)
- Modify: `frontend/src/App.tsx` (lazy import ~42-44; superadmin rotaları ~911-912)
- Test: `frontend/src/pages/superadmin/print3dManifestCsv.spec.ts`
- Test: `frontend/src/pages/superadmin/Print3dProductionPage.test.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /v1/superadmin/print3d/jobs…` (Görev 10); `POST /v1/superadmin/shipments/:orderId`, `PATCH /v1/superadmin/shipments/:shipmentId/delivered` (mevcut); `superadmin:print3d.*`, `superadmin:nav.print3d` (Görev 13)
- Produces:
  - `superadminPrint3dApi.ts`: `export interface SaPrint3dJobItem { id: string; productName: string; productImageUrl: string | null; model3dUrl: string | null; position: number; status: string; opsNote: string | null }`; `export interface SaPrint3dShipment { id: string; carrier: string; trackingNo: string | null; status: string; deliveredAt: string | null }`; `export interface SaPrint3dJob { id: string; tenantId: string; tenantName: string | null; status: string; partner: string; partnerRef: string | null; itemCount: number; totalCents: number; currency: string; note: string | null; createdAt: string; hwOrderId: string; items: SaPrint3dJobItem[]; hwOrder?: { id: string; status: string; shippingAddress: Record<string, unknown> | string | null; shipments: SaPrint3dShipment[] } | null }`; `useSaListPrint3dJobs(filters: { status?: string })`, `useSaGetPrint3dJob(id?: string)`, `useSaUpdatePrint3dJobStatus()`, `useSaUpdatePrint3dJobItem()`, `useSaCreateShipment()`, `useSaMarkShipmentDelivered()`
  - `print3dManifestCsv.ts`: `export function print3dManifestCsv(job: SaPrint3dJob): string`

- [ ] **Adım 1: CSV testini yaz (kırmızı)**

`frontend/src/pages/superadmin/print3dManifestCsv.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { print3dManifestCsv } from './print3dManifestCsv';

const job = {
  id: 'job-1',
  tenantId: 't-1',
  tenantName: 'Test Restoran',
  status: 'queued',
  partner: 'figurunica',
  partnerRef: null,
  itemCount: 2,
  totalCents: 160000,
  currency: 'TRY',
  note: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  hwOrderId: 'hw-1',
  items: [
    {
      id: 'i1',
      productName: 'Adana Kebap',
      productImageUrl: '/img/a.jpg',
      model3dUrl: 'https://cdn/a.glb',
      position: 0,
      status: 'pending',
      opsNote: null,
    },
    {
      id: 'i2',
      productName: 'Künefe, "özel"',
      productImageUrl: null,
      model3dUrl: null,
      position: 1,
      status: 'pending',
      opsNote: null,
    },
  ],
} as any;

describe('print3dManifestCsv', () => {
  it('emits a header row plus one row per item', () => {
    const lines = print3dManifestCsv(job).trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('productName,productImageUrl,model3dUrl,qty');
    expect(lines[1]).toBe('"Adana Kebap","/img/a.jpg","https://cdn/a.glb",1');
  });

  it('escapes embedded quotes and commas so the manifest cannot shift columns', () => {
    const lines = print3dManifestCsv(job).trim().split('\n');
    expect(lines[2]).toBe('"Künefe, ""özel""","","",1');
  });
});
```

- [ ] **Adım 2: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/superadmin/print3dManifestCsv.spec.ts`
Expected: FAIL — `Failed to resolve import "./print3dManifestCsv"`

- [ ] **Adım 3: CSV üreticisini yaz**

`frontend/src/pages/superadmin/print3dManifestCsv.ts`:

```ts
import type { SaPrint3dJob } from '../../features/superadmin/api/superadminPrint3dApi';

/** RFC4180 alan kaçışı: gömülü tırnak ikilenir, alan tırnağa alınır. */
function cell(v: string | null): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

/**
 * Figurunica manifestosu — İSTEMCİ TARAFINDA üretilir, sunucuda yeni endpoint
 * yoktur. Her kalem bir figürdür, o yüzden qty her satırda 1.
 */
export function print3dManifestCsv(job: SaPrint3dJob): string {
  const header = 'productName,productImageUrl,model3dUrl,qty';
  const rows = job.items.map(
    (i) =>
      `${cell(i.productName)},${cell(i.productImageUrl)},${cell(i.model3dUrl)},1`,
  );
  return [header, ...rows].join('\n') + '\n';
}
```

- [ ] **Adım 4: Testi yeşil gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/superadmin/print3dManifestCsv.spec.ts`
Expected: PASS — `2 passed`.

- [ ] **Adım 5: Superadmin API kancalarını yaz**

`frontend/src/features/superadmin/api/superadminPrint3dApi.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../../i18n/config';
import { getApiErrorMessage } from '../../../lib/api-error';
import { superAdminApi as api } from './superAdminApi';

export interface SaPrint3dJobItem {
  id: string;
  productName: string;
  productImageUrl: string | null;
  model3dUrl: string | null;
  position: number;
  status: string;
  opsNote: string | null;
}

export interface SaPrint3dShipment {
  id: string;
  carrier: string;
  trackingNo: string | null;
  status: string;
  deliveredAt: string | null;
}

export interface SaPrint3dJob {
  id: string;
  tenantId: string;
  /** Print3dJob'ta tenant ilişkisi yok; sunucu adı ayrı sorguyla ekliyor. */
  tenantName: string | null;
  status: string;
  partner: string;
  partnerRef: string | null;
  itemCount: number;
  totalCents: number;
  currency: string;
  note: string | null;
  createdAt: string;
  hwOrderId: string;
  items: SaPrint3dJobItem[];
  /**
   * YALNIZCA tekil uç noktada (`GET /jobs/:id`) dolu — kuyruk listesi
   * adresi taşımaz, çünkü liste her kiracının teslimat adresini tek ekranda
   * göstermek zorunda değil.
   */
  hwOrder?: {
    id: string;
    status: string;
    shippingAddress: Record<string, unknown> | string | null;
    shipments: SaPrint3dShipment[];
  } | null;
}

export const saPrint3dKeys = {
  jobs: (status?: string) => ['sa', 'print3d', 'jobs', status ?? 'all'] as const,
  job: (id: string) => ['sa', 'print3d', 'job', id] as const,
};

export const useSaListPrint3dJobs = (filters: { status?: string } = {}) =>
  useQuery({
    queryKey: saPrint3dKeys.jobs(filters.status),
    queryFn: async (): Promise<SaPrint3dJob[]> => {
      const r = await api.get('/v1/superadmin/print3d/jobs', { params: filters });
      return r.data;
    },
  });

export const useSaGetPrint3dJob = (id?: string) =>
  useQuery({
    queryKey: saPrint3dKeys.job(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SaPrint3dJob> => {
      const r = await api.get(`/v1/superadmin/print3d/jobs/${id}`);
      return r.data;
    },
  });

export const useSaUpdatePrint3dJobStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      status: string;
      partnerRef?: string;
      opsNote?: string;
    }) => {
      const r = await api.patch(`/v1/superadmin/print3d/jobs/${id}/status`, body);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:error'))),
  });
};

export const useSaUpdatePrint3dJobItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      itemId,
      ...body
    }: {
      jobId: string;
      itemId: string;
      status: string;
      opsNote?: string;
    }) => {
      const r = await api.patch(
        `/v1/superadmin/print3d/jobs/${jobId}/items/${itemId}`,
        body,
      );
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:error'))),
  });
};

/**
 * Kargo için YENİ backend endpoint'i yok — mevcut superadmin/shipments rayı
 * kullanılıyor. Bu panel, o rayın SPA'daki ilk yüzeyidir.
 */
export const useSaCreateShipment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      carrier,
      trackingNo,
    }: {
      orderId: string;
      carrier: string;
      trackingNo?: string;
    }) => {
      const r = await api.post(`/v1/superadmin/shipments/${orderId}`, {
        carrier,
        trackingNo,
      });
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:error'))),
  });
};

export const useSaMarkShipmentDelivered = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shipmentId: string) => {
      const r = await api.patch(`/v1/superadmin/shipments/${shipmentId}/delivered`);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:error'))),
  });
};
```

- [ ] **Adım 6: Panel testini yaz (kırmızı)**

`frontend/src/pages/superadmin/Print3dProductionPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import enSuperadmin from '../../i18n/locales/en/superadmin.json';

const jobs = { data: [] as any[], isLoading: false };
const updateStatus = { mutateAsync: vi.fn(), isPending: false };
const updateItem = { mutateAsync: vi.fn(), isPending: false };
const createShipment = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../features/superadmin/api/superadminPrint3dApi', () => ({
  useSaListPrint3dJobs: () => jobs,
  useSaGetPrint3dJob: (id?: string) => ({
    data: id ? jobs.data.find((j) => j.id === id) : undefined,
  }),
  useSaUpdatePrint3dJobStatus: () => updateStatus,
  useSaUpdatePrint3dJobItem: () => updateItem,
  useSaCreateShipment: () => createShipment,
  useSaMarkShipmentDelivered: () => ({ mutateAsync: vi.fn(), isPending: false }),
  saPrint3dKeys: { jobs: () => ['sa', 'print3d', 'jobs'], job: (id: string) => ['sa', 'print3d', 'job', id] },
}));

import Print3dProductionPage from './Print3dProductionPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'superadmin', enSuperadmin, true, true);
});

const job = {
  id: 'job-1',
  tenantId: 't-1',
  tenantName: 'Test Restoran',
  status: 'queued',
  partner: 'figurunica',
  partnerRef: null,
  itemCount: 2,
  totalCents: 160000,
  currency: 'TRY',
  note: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  hwOrderId: 'hw-1',
  items: [
    { id: 'i1', productName: 'Adana Kebap', productImageUrl: '/img/a.jpg', model3dUrl: null, position: 0, status: 'pending', opsNote: null },
    { id: 'i2', productName: 'Lahmacun', productImageUrl: null, model3dUrl: 'https://cdn/l.glb', position: 1, status: 'pending', opsNote: null },
  ],
  hwOrder: {
    id: 'hw-1',
    status: 'paid',
    shippingAddress: { line1: 'Bağdat Cad. 1', city: 'İstanbul' },
    shipments: [],
  },
};

describe('Print3dProductionPage', () => {
  beforeEach(() => {
    jobs.data = [job];
    updateStatus.mutateAsync.mockReset();
    updateStatus.mutateAsync.mockResolvedValue({});
    createShipment.mutateAsync.mockReset();
    createShipment.mutateAsync.mockResolvedValue({});
    updateItem.mutateAsync.mockReset();
    updateItem.mutateAsync.mockResolvedValue({});
  });

  it('lists queued jobs with tenant, item count and total', () => {
    render(<Print3dProductionPage />);
    expect(screen.getByText('Test Restoran')).toBeTruthy();
    expect(screen.getByTestId('print3d-row-job-1').textContent).toContain('2');
    expect(screen.getByTestId('print3d-row-job-1').textContent).toContain('1.600,00');
  });

  it('shows the Figurunica manifest with product name and photo per item', () => {
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    expect(screen.getByText(enSuperadmin.print3d.manifest.title)).toBeTruthy();
    expect(screen.getByText('Adana Kebap')).toBeTruthy();
    expect(screen.getByAltText('Adana Kebap')).toHaveAttribute('src', '/img/a.jpg');
    expect(screen.getByText('Lahmacun')).toBeTruthy();
  });

  it('advances a job from queued to in_production', async () => {
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    fireEvent.click(screen.getByTestId('print3d-advance'));
    await waitFor(() => expect(updateStatus.mutateAsync).toHaveBeenCalled());
    expect(updateStatus.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1', status: 'in_production' }),
    );
  });

  it('marks a single manifest item as rejected through the item endpoint', async () => {
    // 'rejected' operatörün "bu figür yeniden basılmalı" sinyali; salt-okunur
    // bırakmak PATCH /jobs/:id/items/:itemId rayını ölü bırakırdı.
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    fireEvent.change(screen.getByTestId('print3d-item-status-i1'), {
      target: { value: 'rejected' },
    });
    await waitFor(() => expect(updateItem.mutateAsync).toHaveBeenCalled());
    expect(updateItem.mutateAsync).toHaveBeenCalledWith({
      jobId: 'job-1',
      itemId: 'i1',
      status: 'rejected',
    });
  });

  it('shows the delivery address and creates a shipment through the existing shipments rail', async () => {
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    expect(screen.getByTestId('print3d-address').textContent).toContain('Bağdat Cad. 1');
    fireEvent.change(screen.getByPlaceholderText('Yurtiçi Kargo'), {
      target: { value: 'Aras' },
    });
    fireEvent.click(screen.getByTestId('print3d-create-shipment'));
    await waitFor(() => expect(createShipment.mutateAsync).toHaveBeenCalled());
    // Yeni backend endpoint'i YOK: mevcut superadmin/shipments rayı, sipariş
    // id'siyle çağrılır.
    expect(createShipment.mutateAsync).toHaveBeenCalledWith({
      orderId: 'hw-1',
      carrier: 'Aras',
    });
  });

  it('shows the empty copy when no job is in the selected state', () => {
    jobs.data = [];
    render(<Print3dProductionPage />);
    expect(screen.getByText(enSuperadmin.print3d.empty)).toBeTruthy();
  });
});
```

- [ ] **Adım 7: Testi çalıştır ve kırmızı gör**

Run: `cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/superadmin/Print3dProductionPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./Print3dProductionPage"`

- [ ] **Adım 8: Paneli yaz**

`frontend/src/pages/superadmin/Print3dProductionPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useSaCreateShipment,
  useSaGetPrint3dJob,
  useSaListPrint3dJobs,
  useSaMarkShipmentDelivered,
  useSaUpdatePrint3dJobItem,
  useSaUpdatePrint3dJobStatus,
  type SaPrint3dJob,
} from '../../features/superadmin/api/superadminPrint3dApi';
import { print3dManifestCsv } from './print3dManifestCsv';

const TABS = ['queued', 'in_production', 'produced', 'cancelled'] as const;

/** Bir sonraki ileri adım. produced/cancelled TERMİNAL. */
const NEXT_STATUS: Record<string, string | null> = {
  queued: 'in_production',
  in_production: 'produced',
  produced: null,
  cancelled: null,
};

const fmt = (cents: number, currency: string) =>
  (cents / 100).toLocaleString('tr-TR', { style: 'currency', currency });

/**
 * /superadmin/print3d — Figurunica üretim kuyruğu.
 *
 * Kargo için yeni backend endpoint'i YOK: mevcut
 * POST /v1/superadmin/shipments/:orderId çağrılır. Manifesto dışa aktarımı
 * istemci-taraflı CSV.
 */
export default function Print3dProductionPage() {
  const { t } = useTranslation('superadmin');
  const [status, setStatus] = useState<string>('queued');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: jobs = [] } = useSaListPrint3dJobs({ status });
  // Tekil uç nokta adresi ve kargoları da getirir; liste getirmez.
  const { data: detail } = useSaGetPrint3dJob(openId ?? undefined);
  const updateStatus = useSaUpdatePrint3dJobStatus();
  const updateItem = useSaUpdatePrint3dJobItem();
  const createShipment = useSaCreateShipment();
  const markDelivered = useSaMarkShipmentDelivered();
  const [partnerRef, setPartnerRef] = useState('');
  const [carrier, setCarrier] = useState('');

  const open = useMemo(
    () => detail ?? jobs.find((j) => j.id === openId) ?? null,
    [detail, jobs, openId],
  );

  function downloadManifest(job: SaPrint3dJob) {
    const blob = new Blob([print3dManifestCsv(job)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `figurunica-${job.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">{t('print3d.title')}</h1>
        <p className="text-xs text-gray-500">{t('print3d.subtitle')}</p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`print3d-tab-${s}`}
            onClick={() => {
              setStatus(s);
              setOpenId(null);
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              status === s ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {t(`print3d.tabs.${s}`)}
          </button>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <p className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('print3d.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('print3d.col.tenant')}</th>
                <th className="px-4 py-2">{t('print3d.col.items')}</th>
                <th className="px-4 py-2">{t('print3d.col.total')}</th>
                <th className="px-4 py-2">{t('print3d.col.date')}</th>
                <th className="px-4 py-2">{t('print3d.col.status')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((j) => (
                <tr key={j.id} data-testid={`print3d-row-${j.id}`}>
                  <td className="px-4 py-2">{j.tenantName ?? j.tenantId}</td>
                  <td className="px-4 py-2">{j.itemCount}</td>
                  <td className="px-4 py-2">{fmt(j.totalCents, j.currency)}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {new Date(j.createdAt).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-2">{t(`print3d.tabs.${j.status}`)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      data-testid={`print3d-open-${j.id}`}
                      onClick={() => setOpenId(j.id)}
                      className="text-blue-600 hover:underline"
                    >
                      {t('print3d.manifest.title')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <section className="space-y-3 rounded border bg-white p-4">
          <h2 className="text-sm font-semibold">{t('print3d.manifest.title')}</h2>
          <ul className="divide-y text-sm">
            {open.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2">
                {i.productImageUrl && (
                  <img
                    src={i.productImageUrl}
                    alt={i.productName}
                    className="h-10 w-10 rounded object-cover"
                  />
                )}
                <span className="flex-1">{i.productName}</span>
                {i.model3dUrl && (
                  <a
                    href={i.model3dUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {t('print3d.manifest.model')}
                  </a>
                )}
                {/* Kalem durumu operatörün sinyali: 'rejected' bir figürün
                    yeniden basılması gerektiğini söyler. Salt-okunur bırakmak
                    PATCH /jobs/:id/items/:itemId rayını ölü bırakırdı. */}
                <select
                  aria-label={t('print3d.manifest.itemStatus')}
                  data-testid={`print3d-item-status-${i.id}`}
                  className="rounded border px-1 py-0.5 text-xs"
                  value={i.status}
                  onChange={(e) =>
                    updateItem.mutateAsync({
                      jobId: open.id,
                      itemId: i.id,
                      status: e.target.value,
                    })
                  }
                >
                  {(['pending', 'printed', 'rejected'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`print3d.itemStatus.${s}`)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder={t('print3d.actions.partnerRef')}
              value={partnerRef}
              onChange={(e) => setPartnerRef(e.target.value)}
            />
            <button
              type="button"
              data-testid="print3d-advance"
              disabled={!NEXT_STATUS[open.status]}
              onClick={() =>
                updateStatus.mutateAsync({
                  id: open.id,
                  status: NEXT_STATUS[open.status] as string,
                  partnerRef: partnerRef || undefined,
                })
              }
              className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {t('print3d.actions.advance')}
            </button>
            <button
              type="button"
              data-testid="print3d-cancel"
              disabled={open.status === 'produced' || open.status === 'cancelled'}
              onClick={() =>
                updateStatus.mutateAsync({ id: open.id, status: 'cancelled' })
              }
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t('print3d.actions.cancel')}
            </button>
            <button
              type="button"
              data-testid="print3d-csv"
              onClick={() => downloadManifest(open)}
              className="rounded border px-3 py-1.5 text-sm"
            >
              {t('print3d.actions.exportCsv')}
            </button>
          </div>

          {/* Teslimat adresi + kargo. Kargo için YENİ backend endpoint'i yok:
              mevcut superadmin/shipments rayı çağrılıyor ve bu panel o rayın
              SPA'daki ilk yüzeyi. Adres yalnız tekil uç noktada dolu. */}
          {open.hwOrder && (
            <div className="space-y-2 border-t pt-3 text-sm">
              <h3 className="text-xs font-semibold text-gray-700">
                {t('print3d.manifest.address')}
              </h3>
              <pre
                data-testid="print3d-address"
                className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700"
              >
                {typeof open.hwOrder.shippingAddress === 'string'
                  ? open.hwOrder.shippingAddress
                  : Object.values(open.hwOrder.shippingAddress ?? {})
                      .filter((v) => typeof v === 'string' && v)
                      .join('\n')}
              </pre>

              <ul className="space-y-1">
                {open.hwOrder.shipments.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span>
                      {s.carrier} {s.trackingNo ?? ''} — {s.status}
                    </span>
                    {!s.deliveredAt && (
                      <button
                        type="button"
                        data-testid={`print3d-delivered-${s.id}`}
                        onClick={() => markDelivered.mutateAsync(s.id)}
                        className="rounded border px-2 py-0.5"
                      >
                        {t('print3d.actions.markDelivered')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="rounded border px-2 py-1 text-sm"
                  placeholder="Yurtiçi Kargo"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
                <button
                  type="button"
                  data-testid="print3d-create-shipment"
                  disabled={!carrier.trim()}
                  onClick={() =>
                    createShipment.mutateAsync({
                      orderId: open.hwOrderId,
                      carrier: carrier.trim(),
                    })
                  }
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {t('print3d.actions.createShipment')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Adım 9: Kenar çubuğu ve rota**

`frontend/src/features/superadmin/components/SuperAdminSidebar.tsx` — `lucide-react` importuna `Boxes,` ekle ve `navigation` dizisinde `nav.legal` girdisinin ardına:

```tsx
  { nameKey: 'nav.print3d', href: '/superadmin/print3d', icon: Boxes, defaultLabel: '3D Üretim' },
```

`frontend/src/App.tsx` — lazy import bloğuna:

```tsx
const Print3dProductionPage = lazyWithReload(
  () => import("./pages/superadmin/Print3dProductionPage"),
);
```

superadmin rotalarına, `<Route path="/superadmin/legal" … />` ile `<Route path="/superadmin/settings" … />` arasına:

```tsx
              <Route
                path="/superadmin/print3d"
                element={<Print3dProductionPage />}
              />
```

- [ ] **Adım 10: Testleri ve tipleri doğrula**

```bash
cd /home/tarik/Projects/kds/frontend && npx vitest run src/pages/superadmin src/features/superadmin
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: PASS (mevcut `SuperAdminSidebar.test.tsx` `expected.forEach(...toContain)` kullandığı için yeni bağlantı onu bozmaz) / `tsc` çıktısız.

- [ ] **Adım 11: Commit**

```bash
git add frontend/src/features/superadmin/api/superadminPrint3dApi.ts frontend/src/pages/superadmin/Print3dProductionPage.tsx frontend/src/pages/superadmin/Print3dProductionPage.test.tsx frontend/src/pages/superadmin/print3dManifestCsv.ts frontend/src/pages/superadmin/print3dManifestCsv.spec.ts frontend/src/features/superadmin/components/SuperAdminSidebar.tsx frontend/src/App.tsx
git commit -m "feat(print3d): superadmin üretim paneli

Durum sekmeleri, kiracı/kalem/tutar satırları, Figurunica manifestosu
(fotoğraf + ad + 3D model bağlantısı + kalem durumu) ve istemci-taraflı CSV
dışa aktarımı. İlerlet/iptal düğmeleri terminal durumlarda kilitli.

Kargo için yeni backend endpoint'i yok — panel mevcut superadmin/shipments
rayının SPA'daki ilk yüzeyi."
```

---

## Görev 22: Dokümantasyon ve tüm CI kapılarının son geçişi

Üç elle bakımlı yüzey bugün platformdaki **tek** hizmet satırını sayıyor; yeni satılabilir kalem oraya yazılmazsa satış ekibi ve yardım portalı onu hiç görmez.

**Files:**
- Modify: `docs/SISTEM_TANITIMI.md` (`| Yerinde Kurulum & Eğitim | hizmet / tek seferlik | ₺7.500 |` satırının **altı**)
- Modify: `docs/PAZARLAMACI_REHBERI.md` (`### Hizmet (tek seferlik)` tablosunun **içi**, `| Yerinde Kurulum & Eğitim | **₺7.500** | …` satırının altı)
- Modify: `help/pages/tr/marketplace/products.mdx` (`## Hizmet` altındaki `### Yerinde Kurulum & Eğitim (tek seferlik)` bölümünün **ardı**)
- Modify: `help/pages/en/marketplace/products.mdx` (`## Service` altındaki `### On-site Installation & Training (one-time)` bölümünün **ardı**)

**Interfaces:**
- Consumes: yok
- Produces: yok (belgeleme + kapı görevi)

> ⚠️ **Çıpalar satır numarasıyla DEĞİL içerikle bulunur.** Bu PR üç paralel değişikliğin sonuncusudur; Change 1 ve Change 2 aynı dosyalara satır ekleyip çıkardığı için her mutlak satır numarası kaymış olabilir. Tabloları ve bölümleri "bütünüyle yeniden üretmek" YASAK — yalnız aşağıda adı geçen satırlar eklenir; iki öncekinin eklediği satırlar okunur, ÜSTÜNE YAZILMAZ.

- [ ] **Adım 1: Çıpaları içerikle bul**

```bash
set -o pipefail
cd /home/tarik/Projects/kds
grep -n "Yerinde Kurulum & Eğitim" docs/SISTEM_TANITIMI.md docs/PAZARLAMACI_REHBERI.md help/pages/tr/marketplace/products.mdx
grep -n "On-site Installation & Training" help/pages/en/marketplace/products.mdx
```
Expected: her dosyada tam bir eşleşme. Bulunamazsa Change 1/Change 2 metni yeniden yazmıştır — o zaman bölümün YENİ başlığını bul, satırı oraya ekle.

- [ ] **Adım 2: `docs/SISTEM_TANITIMI.md`**

`| Yerinde Kurulum & Eğitim | hizmet / tek seferlik | ₺7.500 |` satırının **hemen altına**:

```
| 3D baskı figür (taban + ürün başına) | hizmet / tek seferlik | ₺1.500 + ₺50/ürün |
```

- [ ] **Adım 3: `docs/PAZARLAMACI_REHBERI.md`**

`### Hizmet (tek seferlik)` tablosunda, `| Yerinde Kurulum & Eğitim | **₺7.500** | …` satırının **hemen altına**:

```
| 3D Baskı Figür | **₺1.500 + ₺50/ürün** | Menüden seçilen her ürün için bir figür; KDV ve kargo dahil, üretim ortağı Figurunica |
```

- [ ] **Adım 4: `help/pages/tr/marketplace/products.mdx`**

`### Yerinde Kurulum & Eğitim (tek seferlik)` bölümünün `<Callout>` bloğu bittikten sonra, `---` ayıracından **önce**:

```mdx
### 3D Baskı Figür (tek seferlik)

Menünüzden seçtiğiniz her ürün için bir 3D baskı figür üretilir. Üretim ortağı
**Figurunica**; ürünün fotoğrafı varsa referans olarak fotoğraf, yoksa yalnızca
ürün adı kullanılır. Sipariş **Mağaza → 3D baskı figür** sihirbazından verilir.

| Alan | Değer |
| --- | --- |
| Tür | Hizmet |
| Fatura | **Tek seferlik** |
| Fiyat | ₺1.500,00 + ürün başına ₺50,00 (KDV ve kargo dahil) |
| Ne işe yarar | **Hak vermez** — bir üretim siparişidir |
| Bağımlılık | — |

<Callout type="info">
  Bu kalem **tekrar satın alınabilir**: à-la-carte katalogdaki tek seferlik
  eklentilerin aksine her sipariş yeni bir üretim işi doğurur. En az 1, en fazla
  50 ürün seçebilirsiniz.
</Callout>
```

- [ ] **Adım 5: `help/pages/en/marketplace/products.mdx`**

`### On-site Installation & Training (one-time)` bölümünün `<Callout>` bloğundan sonra, `---` ayıracından **önce**:

```mdx
### 3D Print Figurine (one-time)

One 3D printed figurine is produced for each product you pick from your menu.
The production partner is **Figurunica**; the product photo is used as the
reference when there is one, otherwise only the product name. Orders are placed
from the **Store → 3D printed figurine** wizard.

| Field | Value |
| --- | --- |
| Kind | Service |
| Billing | **One-time** |
| Price | ₺1,500.00 + ₺50.00 per product (VAT and shipping included) |
| What it does | **Grants nothing** — it is a production order |
| Dependency | — |

<Callout type="info">
  This item is **repeatable**: unlike the one-time add-ons in the à-la-carte
  catalog, every order mints a new production job. You can pick between 1 and 50
  products.
</Callout>
```

- [ ] **Adım 6: Tüm kapıları çalıştır ve çıktılarını gör**

```bash
set -o pipefail
cd /home/tarik/Projects/kds/backend && npx jest src/modules/checkout src/modules/print3d src/modules/catalog src/modules/marketplace
cd /home/tarik/Projects/kds/backend && npm run test:e2e -- print3d
cd /home/tarik/Projects/kds/backend && npx tsc --noEmit
cd /home/tarik/Projects/kds/backend && npm run lint:ci
cd /home/tarik/Projects/kds/frontend && npx vitest run src/features/print3d src/features/hardware-store src/pages/superadmin
cd /home/tarik/Projects/kds/frontend && npx tsc --noEmit -p tsconfig.json
node scripts/check-i18n-parity.mjs
cd /home/tarik/Projects/kds && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
cd /home/tarik/Projects/kds && node scripts/check-contract-drift.mjs
```
Expected: hepsi yeşil. `cmd | tail` KULLANMA — çıkış kodu `tail`'in olur.

- [ ] **Adım 7: `ALACARTE_CATALOG` tripwire'ının hâlâ yeşil olduğunu doğrula**

Run: `cd /home/tarik/Projects/kds/backend && npx jest src/modules/marketplace/alacarte-catalog-migration.spec.ts src/modules/marketplace/catalog-validation.spec.ts`
Expected: PASS. Bu değişiklik `ALACARTE_CATALOG`'a hiç dokunmadı ve `FOLLOW_UP_SQL`'e giriş eklemedi; suite kırmızıya dönerse sebep bu değişikliğin kendisidir — katlama mekanizmasını sıfırdan yeniden yazma, neyin bozulduğunu bul.

- [ ] **Adım 8: Commit**

```bash
git add docs/SISTEM_TANITIMI.md docs/PAZARLAMACI_REHBERI.md help/pages/tr/marketplace/products.mdx help/pages/en/marketplace/products.mdx
git commit -m "docs(print3d): 3D baskı figürü satılabilir kalem listelerine ekle

SISTEM_TANITIMI, PAZARLAMACI_REHBERI ve yardım portalının iki dili elle
bakımlı ve bugüne kadar platformdaki TEK hizmet satırını sayıyordu; yeni bir
satılabilir kalem buralara yazılmazsa satış ekibi ve yardım portalı onu hiç
görmez.

Yardım sayfası kalemin TEKRAR SATIN ALINABİLİR olduğunu açıkça söylüyor —
à-la-carte tek seferlik eklentilerin aksine."
```

---

## Kapanış kontrol listesi

- [ ] Migration `20260820170000_print3d_service` zincirin son halkası; `20260820100000` / `120000` / `130000` / `140000` / `150000` / `160000`'dan sonra sıralanıyor.
- [ ] `up → down → up` gidiş-dönüşü atılabilir Postgres'te kanıtlandı; ödenmiş iş guard'ı hiçbir şey silmeden durdu; envanter farkı tam **2**.
- [ ] `ALACARTE_CATALOG` **dokunulmadı**, `FOLLOW_UP_SQL`'e giriş **eklenmedi**.
- [ ] Yeni `FEATURE_KEYS` girdisi **yok** (T4 tetiklenmedi).
- [ ] `hardware:print3d.*` ve `superadmin:print3d.*` beş yerelde **gerçek çeviriyle** var; `en`'e Türkçe yazılmadı.
- [ ] `npm run lint:ci` kullanıldı, `npm run lint` **hiç** çalıştırılmadı.
- [ ] Hiçbir commit mesajında AI/Claude izi yok.
