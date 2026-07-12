# Hazır Formları Doldurma Rehberi (Checklist #13, #16)

> Bu iki maddenin **kodu zaten yazılmış**; eksik olan yalnızca **veri girişi**.
> Gerçek IBAN / entegratör şifresi gibi **finansal/kişisel veriyi ben forma
> giremem** (güvenlik kuralı) — adımları göster, değerleri **sen** gir.
> Güncelleme: 2026-07-12

---

## #13 — Havale/EFT için şirket IBAN'ı (superadmin)

**Ne işe yarar:** TRY aboneliklerde kullanıcı "Havale / EFT" seçerse, ödeme
ekranında **bu IBAN** + `HVL-XXXXXXXX` referansı gösterilir; ödeme gelince
superadmin "Bekleyenler"den onaylar.

**Adımlar:**
1. Superadmin olarak giriş yap → sol menü **"Havale"** ( `/superadmin/bank-transfer` ).
2. **Ayarlar** panelinde:
   - **Banka adı** (ör. Ziraat Bankası)
   - **Hesap sahibi** (ör. [firma / şahıs adı])
   - **IBAN** (`TR..` — 26 hane; alan otomatik büyük harfe çevirir)
   - **Açıklama** (ops. — müşteriye gösterilecek talimat)
3. **"Etkin"** anahtarını aç → Kaydet.

> ⚠ Servis, **banka adı + hesap sahibi + IBAN üçü de dolu olmadan** "Etkin"
> yapmayı reddeder (`INCOMPLETE_BANK_TRANSFER_CONFIG`). Üçünü de gir.

**Doğrulama:** Abonelik ödeme ekranında (`Checkout` → "Havale / EFT") IBAN + HVL
referansı görünmeli. Backend: `BankTransferSettings` (singleton `default`).

---

## #16 — e-Belge entegratör kimlik bilgileri (Muhasebe → Ayarlar)

**Seçilen entegratör = NİLVERA** (kodda primary adaptör, PR #298 / v3.2.115).
Foriba/Sovos adaptörü de dursa da yedek; Nilvera'nın kendi `GlobalCompany/Check`
ucu mükellef yönlendirmesini yaptığı için restoran akışına daha iyi oturuyor
(e-Adisyon desteği). Önce **sandbox** creds ile dene.

**Adımlar (Nilvera):**
1. Admin olarak giriş → **Muhasebe** sayfası → **Ayarlar** sekmesi.
2. **Entegrasyon** bölümünde **Sağlayıcı** = **NİLVERA** seç.
3. Nilvera alanlarını gir:
   - **nilveraApiUrl** — Nilvera'nın verdiği API taban adresi (önce test:
     `apitest…`, sonra prod `api…`).
   - **nilveraApiKey** — statik Persisted Access Token (şifreli saklanır; API
     yanıtında geri dönmez, yalnızca `hasNilveraCredentials` görünür).
4. **"Test Connection"** → `/general/Company` probe'u yeşilse anahtar geçerli. Kaydet.

**#20 mükellef sorgu:** Nilvera provider aktifken **ek env/flag gerekmez** —
adaptör kendi `GET /general/GlobalCompany/Check/TaxNumber/{VKN}` ucuyla B2B/B2C
yönlendirmesini yapar (null dönerse enjekte edilen provider'a güvenli düşer).

> **Güvenlik:** gerçek nilveraApiKey / prod IBAN gibi değerleri bu depoya, sohbete
> veya bir dosyaya **yazma**; yalnızca ilgili forma (şifreli saklanır) gir.

**Doğrulama:** Ayarlar kaydından sonra Muhasebe → **e-Belge Durumu** sekmesinde
sağlayıcı = NİLVERA görünmeli; sandbox'ta bir satış faturası kesip senkron
durumunu izle.

---

## Neyi ben yapamam (senin yapman gereken)
- [ ] #13: gerçek **IBAN** girişi (finansal veri)
- [ ] #16: gerçek **nilveraApiKey** girişi (kimlik bilgisi)

İkisi de kodda hazır; ben yalnızca **nereye** gireceğini gösterdim.
