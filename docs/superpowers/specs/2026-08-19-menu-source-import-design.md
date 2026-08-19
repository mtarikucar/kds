# Menüyü kaynaktan içe aktarma — tasarım

**Tarih:** 2026-08-19
**Durum:** onaylandı, plana geçilecek
**Branch:** `feat/menu-source-import`

## Problem

Menü yönetiminde ürün eklemenin bugün iki yolu var ve ikisi de ayrı düğmede duruyor: fotoğraftan
dijitalleştirme (`MenuImportTab`) ve elle toplu giriş (`BulkAddModal`). Bir restoranın menüsü zaten
bir yerde dururken — kendi sitesinde, bir PDF'te, bir Excel dosyasında — operatörün onu tek tek
yeniden yazması gerekiyor.

İstenen: tek bir **"Toplu ekle"** düğmesi, altında üç seçenek — **kaynak ver** (link veya dosya),
**fotoğraftan al**, **manuel toplu ekle**. "Kaynak ver" verilen adresteki veriyi çözümleyip ürünlere
dönüştürecek.

Paket servis (Yemeksepeti / Getir / Trendyol) sayfaları **kapsam dışı** — ayrıca teknik olarak da
erişilemez durumdalar; gerekçe "Kapsam dışı" bölümünde.

## Bugün ne var

41 ajanlı bir keşif turuyla çıkarıldı, her madde dosya:satır ile doğrulandı.

| Parça | Yer | Durum |
|---|---|---|
| SSRF koruması | `backend/src/common/net/url-safety.ts:122` `assertPublicHttpUrl` | **Hazır ve testli** |
| Taslak normalizasyonu | `menu-import.service.ts:175` `normaliseDraft(raw)` | **Aynen kullanılacak** |
| Commit | `menu-import.service.ts:246` `commitDraft(dto, tenantId)` + `POST /menu/import/commit` | Kaynaktan bağımsız, plan kapısı yok |
| Taslak sözleşmesi | `menu-import.dto.ts` `CommitMenuImportDto` | Evrensel şekil |
| Claude taşıması | `menu-import.service.ts:126-153` | Ortaklaştırılacak |
| Kontör ölçümü | `MenuAiQuotaService.claim/attachJob/voidUsage` | Aynen kullanılacak |
| Açılır menü primitifi | `components/ui/dropdown-menu.tsx` (örnek: `QrCodeDisplay.tsx:292`) | Aynen kullanılacak |

Eksikler: backend'de HTML ayrıştırıcı yok (cheerio/jsdom), CSV **okuyucu** yok (`csv.util.ts` yalnızca
`toCsv` yazıyor), XLSX okuyucu yok, PDF metin çıkarıcı yok (`pdfkit` yalnızca üretir).

Ve düzeltilmesi gereken bir varsayım: `commitDraft` **kategorileri** isme göre eşliyor ama **ürünleri
her zaman yeniden yaratıyor** (`menu-import.service.ts:322` `this.products.create`). Çakışma tespiti
hiç yok.

## Mimari

Tek yeni uç, içerik tipine göre üç çıkarıcı, sonrasında bugünkü hat:

```
link  ya da  yüklenen dosya
        │
        ▼
  assertPublicHttpUrl  (link ise)
        │
        ▼
  içerik tipi tespiti            ← sihirli baytlar > Content-Type > uzantı (bu öncelikle)
        │
        ├─ CSV / XLSX / Sheets ──► sütun eşleyici ──┐    AI yalnızca eşleme için, satırlar için değil
        ├─ PDF ──────────────────► Claude document ─┤
        └─ HTML / diğer ─────────► metin → Claude ──┘
                                                    │
                                            normaliseDraft()          ← değişmeden
                                                    │
                                            çakışma işaretleme        ← YENİ
                                                    │
                                     MenuDraftReviewGrid              ← çıkarılacak
                                                    │
                                     POST /menu/import/commit         ← çakışma dalı eklenir
```

### İçerik tipi nasıl belirlenir

Öncelik sırası **sihirli baytlar → `Content-Type` başlığı → uzantı**. Sunucular sık sık yanlış
`Content-Type` gönderir (`application/octet-stream` ile servis edilen PDF, `text/html` ile servis
edilen CSV), uzantı ise hiç bulunmayabilir. İlk 8 bayt `%PDF-` ise PDF, `PK\x03\x04` ise XLSX
sayılır — başlık ne derse desin. Hiçbiri karar vermiyorsa HTML yoluna düşülür, çünkü o yol metni
Claude'a verdiği için en toleranslı olanıdır.

### Neden CSV/XLSX'te satırlar AI'a gitmiyor

Yapılandırılmış veride model gereksiz ve zararlı: yüzlerce satır `max_tokens: 8000`'i taşırır, ayrıca
model sayıları yeniden yazarken hata yapabilir. Bunun yerine **yalnızca başlık satırı + ilk 5 örnek
satır** modele gider ve dönen tek şey sütun eşlemesidir:

```json
{ "name": "Ürün Adı", "price": "Fiyat", "category": "Kategori",
  "description": "Açıklama", "taxRate": null }
```

Kalan satırlar bu eşlemeyle **yerelde** dönüştürülür. Tek küçük çağrı, tam doğruluk, sabit maliyet.
Başlıklar zaten tanınabiliyorsa (`ad|isim|ürün|name`, `fiyat|price|tutar`, …) model hiç çağrılmaz.

## Bileşenler

### `MenuSourceFetcher` (yeni, `backend/src/modules/menu/services/`)

Tek sorumluluk: bir adresten baytları güvenle getirmek.

- `assertPublicHttpUrl` **iki fazlı** çağrılır — webhook modülünün deseni: kabulde bir kez
  (`webhook-outbound.service.ts:120`), sokete bağlanmadan hemen önce bir kez daha
  (`webhook-delivery-worker.service.ts:203`). DNS rebinding için gerekli.
- Yönlendirme en fazla **3**, her yönlendirmede hedef **yeniden doğrulanır**.
- Zaman aşımı 15s, gövde **10MB**'da kesilir (akışı durdur, kısmî içerikle devam etme).
- `UnsafeUrlError` → `BadRequestException`, mesaj aynen taşınır (webhook modülüyle aynı davranış).
- Timeout/boyut eşikleri `numericEnv()` ile ayarlanabilir (`common/config/numeric-env.util.ts`).

Doğrudan dosya yüklemesinde fetcher atlanır, baytlar `FilesInterceptor`'dan gelir.

### `MenuSourceExtractor` (yeni)

`{ bytes, contentType, filename? }` → `CommitMenuImportDto`.

| Tip | Yol | Yeni bağımlılık |
|---|---|---|
| `text/csv`, `text/plain` | `csv-parse` → sütun eşleyici | `csv-parse` |
| `.xlsx` / `.xls` | `xlsx` → ilk sayfa → sütun eşleyici | `xlsx` |
| Google Sheets linki | `/edit` → `/export?format=csv` normalize, sonra CSV yolu | — |
| `application/pdf` | Claude `document` bloğu (base64) | **yok** |
| `text/html` ve diğer | script/style/nav/footer at, metne indir, Claude | **yok** |

**Google Sheets tuzağı:** paylaşımı kapalı bir sayfanın `/export` adresi 4xx değil, **HTTP 200 + Google
giriş sayfası HTML'i** döner. Durum koduna güvenilemez; içerik tipi ve gövde başı denetlenip
"bu sayfa herkese açık değil" diye ayrı bir hata verilir.

**CSV tuzağı:** `csv.util.ts:6-14`'teki formül-enjeksiyonu kaçışı ihracat tarafında başa `'` ekliyor.
İthalatta bu ters döner — baştaki tek tırnak temizlenmeli, yoksa ürün adı `'Adana Kebap` olur.

### Uzun kaynak: parçalama

Mevcut çağrı `max_tokens: 8000`. Koca bir site ya da çok sayfalı PDF bunu taşırır ve JSON ortadan
kesilir; kullanıcı jenerik "menü okunamadı" görür.

Çözüm: çıkarılan metin parçalara bölünür, parça başına bir Claude çağrısı yapılır, dönen taslaklar
**kategori adına göre** birleştirilir (aynı isimli kategorilerin ürünleri birleşir). Parça sayısı
tavanlıdır (varsayılan 6) ve aşılırsa iş reddedilir — sessizce yarısını almaktansa açık hata.

Bölme satır sınırında yapılır, karakter ortasında değil: metin satırlara ayrılır ve parça bir eşiğe
(varsayılan 24.000 karakter) ulaşana kadar satır eklenir. Ardışık parçalar **son 15 satırı paylaşır**;
bu örtüşme, tam sınıra denk gelen bir kategori başlığının altındaki ürünlerin başlıksız kalmasını
önler. Örtüşmeden doğan yinelenen ürünler birleştirmede `(kategori, ad)` ikilisiyle tekilleştirilir.

**Her parça ayrı kontör düşer.** `claim(tenantId, "PHOTO", n)` tek seferde `n = parça sayısı` ile
çağrılır; herhangi bir parça patlarsa tamamı `voidUsage` ile iade edilir.

### Claude taşımasının ortaklaştırılması

`menu-import.service.ts:126-153` bloğu `private askClaude(contentBlocks, prompt): Promise<string>`
olarak çıkarılır. `parseMenuPhotos` ve yeni `parseMenuSource` aynı fonksiyonu çağırır; tek fark
içerik bloğu dizisidir (`image` / `document` / `text`). Aynı `ANTHROPIC_URL`, aynı
`anthropic-version: 2023-06-01`, aynı `MENU_IMPORT_MODEL`, aynı 120s.

### Çakışma çözümü (yeni davranış)

**Parse dönüşünde:** her taslak ürün, tenant'ın mevcut ürünlerine karşı `(kategori adı, ürün adı)`
ikilisiyle, büyük/küçük harf duyarsız ve boşluk kırpılmış olarak karşılaştırılır. Eşleşen satır
`conflict: { existingProductId, existingPrice }` taşır.

Taslaktaki kategori tenant'ta henüz yoksa o kategorinin hiçbir satırı çakışamaz — eşleştirme
kategori kapsamlıdır, menü genelinde değil. Aynı ürün adı iki farklı kategoride yaşayabilir
(ör. "Ayran" hem İçecekler'de hem Menüler'de) ve bunlar ayrı ürünlerdir.

**İnceleme ızgarasında:** çakışan satırlar ayrı bir görsel durumda gösterilir, mevcut fiyat yanında
belirir. Üstte toplu seçim, satır bazında da değiştirilebilir:

| Seçim | Etki |
|---|---|
| `SKIP` | Satır commit'e gitmez |
| `UPDATE_PRICE` | Yalnızca `price` güncellenir — açıklama, foto, seçenek, koleksiyon korunur |
| `CREATE` | Yine de yeni ürün yaratılır |

Varsayılan `SKIP` (en güvenli — mevcut emeği bozmaz).

**Sözleşme değişikliği:** `MenuImportProductDraftDto`'ya `onConflict?: "SKIP" | "UPDATE_PRICE" | "CREATE"`
ve `existingProductId?: string` eklenir. `commitDraft` bu dalları uygular ve `CommitSummary`'ye
`productsUpdated` ile `productsSkipped` alanları gelir.

`existingProductId` istemciden geldiği için **tenant'a ait olduğu sunucuda yeniden doğrulanır** —
başka tenant'ın ürününü güncellemeye çalışan bir istek reddedilir.

## Frontend

### Üç seçenekli tek düğme

`MenuManagementPage.tsx`'teki iki düğme ("Toplu ekle", "Fotoğraftan menü") tek `DropdownMenu` altında
birleşir: **Kaynak ver** · **Fotoğraftan al** · **Manuel toplu ekle**. Üçü de aynı `Modal size="full"`
içine açılır; `importDirty` koruması üçünü birden kapsayacak şekilde genişletilir.

AI gerektiren iki seçenek (`Kaynak ver`, `Fotoğraftan al`) bugünkü gibi `useMenuImportStatus()`
(`{configured}`) ile koşullanır — anahtar yoksa görünmezler.

### Önce yapılacak refactor

İnceleme ızgarası bugün bir bileşen değil: düzenleme davranışının tamamı `MenuImportTabInner` içinde
kapanış olarak duruyor (`MenuImportTab.tsx:118-178` değiştiriciler, `:64-82` memolar, `:180-220`
commit, `:317-470` JSX). İkinci bir kaynak onu kullanamaz.

Çıkarılacak:

- `<MenuDraftReviewGrid draft onChange onCommit onCancel isCommitting conflictPolicy onConflictPolicyChange />`
  — salt sunum, kaynaktan habersiz.
- `useMenuDraft(initial)` — değiştiriciler, `totalItems`/`invalidRowCount`, commit öncesi temizleme.
- Ortak `cellCls` ve `TAX_RATES` (`MenuImportTab.tsx:24-26`) ızgarayla birlikte taşınır.

Aynı refactor turunda düzeltilecek iki mevcut kusur:

1. `<FeatureGate feature="aiContentGeneration">` şu an **tüm akışı** sarıyor (`MenuImportTab.tsx:44-48`),
   inceleme ızgarası ve özet dahil. Yalnızca parse adımını sarmalı — yoksa planı düşen bir tenant
   elindeki taslağı göremez, commit ucu bilerek kapısız olduğu hâlde.
2. Commit'te başarısız satırlar atılıyor (`:209-211` `setDraft(null)`), yalnızca ilk 8 hata
   gösteriliyor (`:499`) ve tekrar denemek mümkün değil. `BulkAddModal` bunu doğru yapıyor
   (`BulkAddModal.tsx:129-137`: başarısız satır anahtarlarından `Set` kurup yalnız onları tutuyor,
   modalı açık bırakıyor). O algoritma ızgaraya taşınır ve 8'lik tavan yükseltilir — bir site
   kazımasında 8'den çok satır patlayabilir.

### Yeni istemci ucu

`useParseMenuSource()` — `{ url }` ya da `FormData(file)` alır, `MenuImportDraft` döner. Mevcut
`useParseMenuPhotos` `File[]` + multipart'a sabitlenmiş durumda, o yüzden ayrı hook.

## Kapsam dışı

**Paket servis sayfaları (Yemeksepeti / Getir / Trendyol / Migros).** Ürün kararı olarak çıkarıldı;
teknik olarak da bugün erişilemezler:

- Dört adapter menüyü **yalnızca iter** — `PUT /v2/chains/{chainCode}/catalog`,
  `PUT /restaurants/{id}/menu`. Katalog **okuma** hiçbirinde yok; `fetchMenu|getMenu|pullMenu|getCatalog`
  araması tüm modülde sıfır sonuç veriyor.
- Sayfaları kazımak JS çalıştırmayı ve bot korumasını aşmayı gerektirir; backend'de headless tarayıcı
  yok ve sunucu IP'sinden geçme ihtimali düşük.
- Modül `@RequiresIntegration("delivery")` ile kapalı, vendor başına ₺2.490/yıl.

İleride istenirse doğru yol kazıma değil, bağlı tenant'lar için adapter'lara `fetchMenu()` eklemektir —
ayrı bir iş.

**Tekrarlayan senkron.** "Kaynak ver" tek seferlik bir içe aktarmadır. Linki saklayıp periyodik
yeniden çekme bu turda yok.

## Test

| Ne | Nasıl |
|---|---|
| Sütun eşleyici | Saf birim testi — Türkçe/İngilizce başlıklar, eksik sütun, baştaki `'`, ondalık virgül |
| Çakışma tespiti + üç dal | `menu-import.service.spec.ts`'e yeni vakalar; `UPDATE_PRICE`'ın yalnızca fiyata dokunduğu iddia edilir |
| Tenant sızıntısı | Başka tenant'ın `existingProductId`'siyle `UPDATE_PRICE` isteği reddedilmeli |
| Fetcher güvenliği | `url-safety.spec.ts` desenini izleyen testler: özel IP, yönlendirmeyle özel IP'ye kaçış, gövde tavanı, timeout |
| Sheets kapalı-paylaşım | 200 + HTML gövdesi geldiğinde ayrı hata |
| Parçalama | Uzun metnin parçalandığı, taslakların kategoriye göre birleştiği, tavan aşımında reddedildiği |
| Kontör iadesi | Herhangi bir parça patladığında `voidUsage` çağrıldığı |
| Izgara refactor | Mevcut `MenuImportTab` testleri yeşil kalmalı; ızgara için ayrı render testi |

## Bağımlılıklar

Eklenecek: `csv-parse` ve bir XLSX okuyucu. XLSX tarafında paket seçimi plan aşamasında
netleşecek — npm'deki `xlsx` (SheetJS) paketinin bilinen güvenlik geçmişi var ve npm sürümü
uzun süre güncellenmedi; `exceljs` ya da SheetJS'in kendi dağıtım kanalı değerlendirilecek.
Girdi doğrudan kullanıcıdan gelen bir dosya olduğu için bu seçim ciddiye alınmalı.
PDF için hiçbir şey gerekmiyor — Claude base64 `application/pdf`
`document` bloğunu doğrudan kabul ediyor (32MB / 600 sayfa sınırı).

Kontör kovası mevcut `AiQuotaKind` içindeki `"PHOTO"`dur (`menu-ai-quota.service.ts:6` —
`"PHOTO" | "VIDEO" | "MODEL3D"`). Yeni bir kova eklemek katalog ve plan tarafında ayrı iş açardı;
"menü dijitalleştirme" kovasını paylaşmak doğru davranış.
