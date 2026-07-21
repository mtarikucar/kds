# Finans Konsolidasyonu + Cihaz Birleşimi + Rapor Sadeleşmesi — Tasarım

**Tarih:** 2026-07-21 · **Branch:** `feat/finance-consolidation` (feat/dashboard-redesign üzerine stack'li — `StatCard` shared bileşenini yeniden kullanır; merge sırası: önce dashboard) · **Kapsam:** frontend-only, backend'e dokunulmaz.

## 1. Problem

Aynı mali dünyaya 5+ ayrı kapı var; mekan sahibi bunları anlayamıyor:

- Sidebar'da 3 ayrı para girişi: **Nakit & ÖKC** (`/admin/cash`), **Muhasebe** (`/admin/accounting-backoffice`), **Analitik & Raporlar** (`/admin/reports`) + 2 gizli rota: `/admin/invoices` (aynı `InvoicesPanel`, gate'siz) ve `/admin/fiscal-recovery` (içinde yazarkasa **kayıt paneli** saklı — Ayarlar'da hiç görünmüyor).
- CashPage ÖKC sekmesi var olmayan "Ayarlar → Mali Cihazlar" konumuna yönlendiriyor (CashPage.tsx:200).
- Paygo SP630 iki ayrı sayfadan kayıt edilebiliyor (PaymentTerminalsSettingsPage.tsx:37 ve FiscalRecoveryPage.tsx:165).
- Aynı ciro üç yüzeyde (`reports/sales`, ZReport snapshot, P&L); üç ayrı "Z" kavramı; "beklenen nakit" iki bağımsız hesap.
- Jargon: "X-Report", "Petty Cash", ekranda çıplak enum "Kasaya devir (SAFE_DROP)", "vendor SDK eksik" geliştirici notu, "Konsolide P&L", "SMM (COGS)".
- CashPage tamamen hardcoded Türkçe (`useTranslation` importu yok) — 5-dil parite ihlali.
- Gating tutarsız: fatura paneli bir rotada gate'siz, diğerinde `advancedReports`; "Bahşiş Havuzu" herkese görünüp düşük planda 403-upsell; ÖKC sekmesi add-on yokluğunu sessizce "cihaz yapılandırılmamış" olarak gösteriyor.

Kaynak: 7-ajanlı keşif denetimi (nav-ia, cash-surface, accounting-surface, reports-surface, fiscal-settings-surface, backend-rails, ux-tab-audit) sentezi, 2026-07-21.

## 2. Onaylanan kararlar

1. **Kapsam:** Tam paket, fazlı (5 faz, tek branch, faz-başına-commit — v3.2.126 workspace-konsolidasyon deseni).
2. **Finans kurgusu:** "Genel Bakış + gruplar" — sayfa görev-odaklı Bugün özetiyle açılır.
3. **Gating ilkesi:** "Yasal işler herkese" — fatura/e-Belge + vardiya/kasa + Z gün-sonu her planda; yalnız analiz katmanı (`advancedReports`) gate'li; erişilemeyen sekme **gizlenir** (hide-not-403); tek dürüst upsell yazarkasa add-on kartı.
4. **Cihazlar:** TÜM donanım şube hub'ına (`BranchDetailPage`) birleşir; Finans'ta Cihazlar grubu OLMAZ, yalnız Genel Bakış'ta durum kartı + link.

## 3. Hedef bilgi mimarisi

### 3.1 Sidebar

```
Operasyon
├─ Ekip
├─ Stok
├─ Analitik & Raporlar      (sekmeler tematik gruplanır — §3.4)
└─ Finans                    ← YENİ (navigation.finance, 5 dile eklenir)

Şubeler ve Cihazlar
├─ Şubeler                   (şube hub'ı = tüm donanımın tek evi — §3.5)
└─ Şube Sağlığı
```

Kaldırılan sidebar girişleri: "Nakit & ÖKC", "Muhasebe", "Fiş Kurtarma". Sidebar'ın hide-not-403 deseni korunur.

### 3.2 Finans sayfası (`/admin/finance`, grup anahtarı + `embedded` prop)

**Genel Bakış (varsayılan grup).** Yalnız mevcut endpoint'lerden beslenen kartlar (yeni backend YOK):

| Kart | Kaynak | Koşul |
|---|---|---|
| Kasadaki beklenen nakit | açık `CashierSession` + X-Report | her plan |
| Açık vardiya sayısı + dün kapatılmamış vardiya uyarısı | sessions listesi (`openedAt` < bugün) | her plan |
| Bugünkü satış | `reports/sales` (dashboard KPI hook'u yeniden kullanılır) | `advancedReports` yoksa kart render edilmez |
| Yazarkasa durumu | `GET /v1/fiscal/devices` | fiscal entegrasyonu yoksa dürüst upsell kartı ("Yazarkasa bağlantısı eklenti gerektirir → Mağaza") |
| Mutabakat bekleyen kart çekimleri | payment-terminal mutabakat ucu | terminal varsa |
| Gönderilemeyen belgeler (e-Belge FAILED + fiş kurtarma kuyruğu birleşik sayaç) | eBelge + fiscal-recovery uçları | ilgili entegrasyon varsa |

Uyarılar aksiyon linkli ("→ Kapat", "→ Düzelt"). Kart bileşeni: shared `StatCard`.

**Kasa grubu:** ① Vardiyalar ("X-Report" → "Anlık kasa özeti") ② Kasa Hareketleri ("Petty Cash"/enum etiketleri sadeleşir) ③ **Gün Sonu** — Raporlar'daki "Z-Raporları" sekmesi (`ZReportsSection`) buraya taşınır; "Z geçmişi CSV" düğmesi bu sekmeye katlanır ④ Bahşiş — yalnız `advancedReports` planında görünür.

**Belgeler grubu:** ① Faturalar (`InvoicesPanel` tek ev) ② Gönderilemeyenler — e-Belge resync + **fiş kurtarma kuyruğu yan yana** (fiscal integration gate'i kuyruk bölümüyle birlikte taşınır; entegrasyon yoksa bölüm gizli) ③ Ayarlar (`AccountingSettingsPanel` tek ev).

### 3.3 Gating matrisi (bilinçli davranış değişiklikleri)

| Yüzey | Eski | Yeni |
|---|---|---|
| `/admin/finance` rotası | (yeni) | gate'siz |
| Fatura paneli (backoffice yolu) | `advancedReports` FeatureGate | gate'siz (backend `sales-invoices` zaten gate'siz — asimetri kapanır) |
| Z gün-sonu | `advancedReports` sayfası içinde | her planda (backend `z-reports` zaten gate'siz) |
| Bahşiş | herkese görünür, 403-upsell | `advancedReports` yoksa sekme gizli |
| ÖKC durumu | sessiz "cihaz yapılandırılmamış" | fiscal yoksa dürüst upsell kartı (Genel Bakış) |
| Analiz katmanı (P&L, konsolide, bütçe, tahmin) | `advancedReports` | değişmez (`advancedReports`) |
| Ayarlar→Muhasebe alt sayfası | `integration:accounting` nav / `advancedReports` rota (tutarsız) | Finans→Belgeler→Ayarlar'a redirect |
| Termal yazıcı ekleme | Entegrasyonlar `apiAccess` gate'i | gate'siz (kart terminaliyle aynı "temel donanım" statüsü, şube hub'ında) |

### 3.4 Analitik & Raporlar

Raporlar grubundaki 10 düz sekme → 3 tema (StockPage 3-grup deseni): **Satış** (satış raporu, ödeme yöntemi, saatlik, tahmin) / **Finans & Bütçe** (Kâr-Zarar, konsolide, bütçe-vs-fiili) / **Operasyon** (müşteri, envanter, personel). "Z-Raporları" buradan çıkar (→ Finans/Kasa/Gün Sonu). `inventory`/`staff` feature-gizleme mantığı grup filtrelerine taşınır; "Konsolide"nin backend-403 özel mesajı korunur. İngilizce fallback'ler ("Konsolide P&L", "Z-Reports") düzelir. Analitik grubu değişmez.

### 3.5 Cihazlar → şube hub'ı

`BranchDetailPage` cihaz sekmeleri genişler: **Ödeme Terminalleri** (kayıt + mutabakat; `/admin/settings/payment-terminals` içeriği taşınır) · **Yazarkasa** (kayıt/emeklilik paneli `FiscalRecoveryPage`'den çıkarılır; ADMIN-only korunur; fiscal integration gate sekme düzeyinde) · **Yazıcı & Çekmece** (Entegrasyonlar'daki Tauri-only donanım kartı; web'de sekme render edilmez) · **Ağ** (mevcut mesh). Tek kayıt akışında "fiş de basar mı?" sorusu terminal/yazarkasa ayrımını yapar — Paygo SP630 ikilemi biter. Şube hub'ının mevcut kuralı geçerli: body'den şube çözen her WRITE `allowedBranchIds`'e karşı yeniden doğrulanır.

### 3.6 Redirect seti

`/admin/cash`, `/admin/accounting-backoffice`, `/admin/invoices`, `/admin/fiscal-recovery`, `/admin/settings/payment-terminals`, Ayarlar→Muhasebe alt yolu → yeni konumlarına (grup/sekme query-param'ıyla). Mevcut 19 redirect emsali izlenir; tüm eski derin linkler çalışmaya devam eder.

## 4. Jargon çeviri tablosu (uygulanacak)

| Eski | Yeni |
|---|---|
| ÖKC (başlık/sekme) | Yazarkasa |
| Vardiyalar & X-Report / "X-Report (kapatmadan)" | Vardiyalar / "Anlık kasa özeti (kapatmadan)" |
| Kasa / Petty Cash · "Küçük kasa (petty)" | Kasa Hareketleri · "Küçük kasa" |
| "Kasaya devir (SAFE_DROP)" | "Ana kasaya para devri" |
| Z-Raporları / "Z geçmişi CSV indir" | Gün Sonu Raporları / "Kapanmış vardiya dökümü (CSV)" |
| "…vendor SDK eksik" notu | "Yazarkasa bağlantısı kurulum bekliyor" |
| SMM (COGS) / Prime Cost | Malzeme maliyeti / Malzeme + işçilik maliyeti |
| Konsolide P&L | Tüm şubeler kâr-zarar |
| Bütçe vs Fiili / Varyans | Bütçe karşılaştırması / fark |
| "entegratör" | "e-Belge sağlayıcı bağlantısı" (teknik ad parantezde) |
| "Reddedilen (FAILED) e-Belgeleri…" | "Gönderilemeyen belgeleri yeniden gönder" |
| Tevkifat / Matrah | kalır (yasal terim) + tooltip açıklama |

## 5. Fazlar

1. **Finans iskeleti:** `FinancePage` (grup anahtarı) + `CashPage`/`AccountingBackOfficePage` `embedded` gömme + sidebar tek giriş + redirect seti. `FiscalRecoveryPage` içeriği (kuyruk + **geçici olarak** cihaz kayıt paneli) Belgeler→Gönderilemeyenler'e `embedded` gömülür — kayıt paneli Faz 4'te şube hub'ına ayrışır; böylece hiçbir fazda yetim yüzey kalmaz.
2. **Genel Bakış:** özet kartlar + uyarılar (frontend-only agregasyon, `StatCard`).
3. **Kasa yeniden kurgusu:** `ZReportsSection` taşıma + Bahşiş gizleme + CashPage tam i18n (5 dil) + jargon.
4. **Cihaz birleşimi:** şube hub'ı sekme genişlemesi + terminal/yazarkasa taşıma + Tauri koşullu render + redirect'ler + `apiAccess` gate kaldırma.
5. **Rapor gruplama + kalan jargon + gating tutarlılık süpürmesi** (SettingsLayout Muhasebe, CostingPage "Menü Mühendisliği" gate uyumu, Entegrasyonlar `comingSoon` "Ekle" düğmesi gizlenir).

## 6. Riskler ve önlemler

- **Derin linkler:** redirect seti (§3.6); eski rotalara giden e-posta/bookmark kırılmaz.
- **i18n parite CI:** her yeni anahtar 5 dile (ar/en/ru/tr/uz) aynı commit'te.
- **Sidebar/App.tsx çakışması:** tüm fazlar tek branch'te (v3.2.126 dersi).
- **Test kırılımı:** rota/sekme testleri fazla birlikte güncellenir; tag öncesi FULL vitest + `npm run lint:ci`.
- **Gate açılımı bilinçli:** düşük planlar Z gün-sonu + fatura paneline İLK KEZ UI'dan erişir — ürün kararı §2.3'te onaylı; backend zaten izin veriyordu.
- **Lazy route kuralı:** yeni `FinancePage` rotası `lazyWithReload` ile.

## 7. Kapsam dışı

- Backend değişikliği yok (üç-Z veri modelinin birleştirilmesi, expectedCash hesap birleşimi ayrı bir backend işi — bu tasarım yalnız UI katmanını düzenler).
- Dashboard KPI çalışması (feat/dashboard-redesign) bu spec'e dahil değil; yalnız `StatCard` + KPI hook'ları yeniden kullanılır.
- Ölü `pages/admin/ZReportsPage.tsx` (route edilmemiş) Faz 3'te silinir — davranış değişikliği değil, temizlik.

## 8. Başarı ölçütleri

- Sidebar para girişi 3→1; gizli para rotası 0 (hepsi redirect).
- Şerit başına sekme ≤4; jargon tablosundaki hiçbir eski etiket UI'da kalmaz.
- CashPage dahil tüm yüzeyler i18n'li, 5-dil parite CI yeşil.
- Cihaz kaydı tek akış; "Ayarlar → Mali Cihazlar" gibi var olmayan yönlendirme metni kalmaz.
- tsc 0 hata, eslint temiz, FULL vitest yeşil, prod build başarılı.
