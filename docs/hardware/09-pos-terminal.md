# POS / Kart Ödeme Terminali (Banka ECR / SoftPOS)

> **Belge tipi:** Cihaz kılavuzu · **Sistemdeki cihaz tipi:** `Device.kind = pos_terminal` · **Satış tipi:** `PARTNER_REDIRECT` (Tier 2)
>
> **Önce bunu okuyun — bu bir donanım satış kalemi DEĞİLDİR.** Kart ödeme terminalinin donanımını ve komisyon oranını **banka veya lisanslı ödeme kuruluşu (PSP)** sağlar; HummyTummy bir ödeme kuruluşu değildir, POS cihazı **satmaz/stoklamaz** — cihazı sisteme **entegre eder**. Bu yüzden mağazada (`/admin/store`) bu kategori "Sepete Ekle / PayTR ile öde" akışına girmez; müşteri lisanslı bir banka/PSP'ye **yönlendirilir** (`partnerRedirect`). Bayinin geliri donanım marjı değil, **entegrasyon + kurulum + servis** hizmetidir (aşağıda bkz. Bölüm 5).

---

## 1. Genel bakış

Kart ödeme terminali (POS terminali), müşterinin banka/kredi kartıyla temaslı çip (EMV), temassız (NFC) veya manyetik şeritten ödeme yapmasını sağlayan cihazdır. HummyTummy KDS/POS SaaS'ında bu cihaz **`Device.kind = pos_terminal`** olarak modellenir ve amacı, adisyonu kapatırken **kart tahsilatını POS ekranından tetikleyip yalnızca banka ONAY (APPROVED) döndüğünde `Payment` kaydı oluşturmaktır**.

**Sistemdeki rolü ve entegrasyon adaptörleri.** HummyTummy'de kart terminali entegrasyonunun **mimari soyutlaması** (tek bir `PaymentTerminalProvider` sözleşmesi + dört adaptör) mevcuttur; ancak sistem **INERT (devre dışı) sevk edilir** ve köprü tarafındaki **gerçek kart sürücüsü (ör. `ingenico_iwl`) henüz İSKELET/inert'tir** — uçtan uca kart çekimi **hiçbir gerçek terminalde doğrulanmamıştır** (bkz. aşağıdaki "Olgunluk ve inert sevk" notu). Her terminal modeli aynı sözleşmeyi uygular. Dört sağlayıcı (provider) kayıtlıdır:

| Sağlayıcı (`providerId`) | Çalışma şekli | Yetkinlikler | Mali fiş | Durum |
|---|---|---|---|---|
| `gmp3_card` | `bridge` (köprü/agent üzerinden) | `sale`, `void`, **`fiscal_coupled`**, `query_last` | **Kartı çeker VE mali fişi tek işlemde basar (GMP-3)** | İskele + kapılı: gerçek cihaz SDK'sı/köprü sürücüsü henüz tamamlanmadı; sertifikalı donanım eşleşene kadar `CONFIGURED_NOT_ACTIVE` |
| `bank_ecr` | `bridge` | `sale`, `void`, `query_last` | Ayrı: onay sonrası fişi yazarkasa/e‑Fatura hattı keser | İskele + kapılı; köprü kart sürücüsü iskelet, cihaz eşleşene kadar tahsilat **zaman aşımına** düşer (fail-closed) |
| `softpos` | `in_process` (backend → PSP HTTP) | `sale`, `refund`, `query_last` | Ayrı (yazarkasa/e‑Fatura hattı) | `activatable = false`; gerçek PSP HTTP istemcisi henüz bağlı değil → **ACTIVE'e alınamaz** (fail-closed) |
| `simulator` | `in_process` | test | — | Test/eğitim için; **asla ACTIVE olamaz** (yalnız `SIMULATOR`) |

**İki temel mimari fark, mevzuat için kritiktir:**

- **`fiscal_coupled` (GMP-3, "yazarkasa‑POS"):** Cihaz kartı çeker **ve** mali fişi **aynı işlemde** basar. Onay yanıtı `fiscalNo` içerir → bağımsız yazarkasa hattı devreye girmez (çift‑fiş koruması). Sistem, siparişin satır/KDV/tutar bilgisini (`TerminalFiscalContext`) tahsilat komutuna ekler; cihaz, bağımsız yazarkasanın basacağı fişin aynısını basar.
- **Yalnız‑tahsilat (`bank_ecr`, `softpos`):** Cihaz sadece kartı çeker (fiscal_coupled değildir). `Payment` yazıldıktan **sonra** mali fiş, ayrı yazarkasa/e‑Fatura hattından kesilir.

**Bağlantı topolojisi.** Kart POS terminali bir **LAN çevre birimidir**: doğrudan buluta değil, **HummyBox köprüsü (local-bridge) ARKASINDA** çalışır (`bridgeId` set). `bridge` tipi sağlayıcılar (`gmp3_card`, `bank_ecr`) tahsilat komutunu device‑mesh `charge_card` kuyruğuna yazar; köprü bunu cihaza iletir. `softpos` ise `in_process`'tir (köprü gerektirmez, backend PSP'yi HTTP ile çağırır).

**Para güvenliği (tasarım gereği).** `charge_card` komutu **NON_RETRYABLE**'dır: kaybolan bir onay yanıtı asla otomatik yeniden gönderilmez → çift çekim olmaz. `Payment` yalnızca açık `approved === true` sinyalinde yazılır; belirsiz/eksik yanıt `ERROR` sayılır (sipariş açık kalır, para kaydedilmez). Kurtarma denemeleri tükenirse tahsilat `NEEDS_REVIEW`'e park edilir ve operatör mutabakat listesinde görünür (`GET /payment-terminal/reconciliation`).

> **Olgunluk ve inert sevk (önce okuyun).** Kart ödeme‑terminali sistemi bugün **INERT (devre dışı) sevk edilir**: hiçbir tenant'ta `ACTIVE` terminal yoktur, `resolveTerminal` yalnızca `ACTIVE`/`SIMULATOR` durumundaki terminali eşler → sistem tamamen atıl kalır ve manuel kart akışı değişmez (sıfır regresyon). Köprü tarafındaki **gerçek kart sürücüsü (ör. `ingenico_iwl`) iskelet/inert'tir**; `softpos` için **gerçek PSP HTTP istemcisi henüz bağlı değildir**; **uçtan uca kart çekimi hiçbir gerçek terminalde doğrulanmamıştır**. Bu yüzden "kur → aktive et → çalışır" **beklemeyin** — aktivasyon yalnızca yazılım kapısını açar, sahada çekim üretmez. Canlıya alım şunların **tamamını** gerektirir: (1) **sertifikalı donanım**, (2) **banka/PSP üye işyeri sözleşmesi**, (3) **köprü kart sürücüsünün (ve `softpos` için PSP istemcisinin) tamamlanması**, (4) **kart şeması/mali sertifikasyon**. Bunlar tamamlanana kadar tüm gerçek sağlayıcılar kapılı/fail‑closed kalır; sağlanacak kesin sertifikasyon adımları *(banka/PSP ve ilgili kart şeması/GİB kaynağından teyit edilmeli)*.

---

## 2. Modeller ve teknik özellikler

> **Stoklu SKU yoktur.** Aşağıdaki tablolar, sahada karşılaşılan **örnek/temsili donanım aileleridir**; kesin model, tam teknik özellik ve fiyat **bankanın/PSP'nin size tahsis ettiği cihaza** göre değişir. Uydurma model/fiyat verilmemiştir; belirsiz her değer "(sağlayıcıdan teyit)" ile işaretlidir. Mali fiş kesecek YN ÖKC, yalnızca **GİB'in yayımladığı onaylı ÖKC üretici/marka listesindeki** cihazlardan seçilir (liste GİB'den teyit edilmeli).

### 2.1 Banka masaüstü/mobil EFT‑POS (Ingenico, Verifone) — `bank_ecr`

Klasik "bankamatik" tipi kart terminali. Kablolu (Ethernet/telefon hattı) veya GPRS/4G. HummyTummy'ye **ECR/OOS (Ödeme Onaylı Sistem)** protokolü üzerinden, köprüye bağlı seri/soket bağlantısıyla katılır.

| Özellik | Tipik değer |
|---|---|
| Ekran | 2.4"–3.5" renkli (mono da olabilir) — (modele göre) |
| İşlemci / OS | Banka firmware'i (kapalı); genelde ARM Cortex tabanlı |
| Kart okuma | EMV çip + temassız (NFC) + manyetik şerit |
| PIN | Fiziksel donanım PIN pad (PCI‑PTS sertifikalı) |
| Bağlantı | Ethernet RJ45 / GPRS‑4G / (bazı modellerde) Wi‑Fi; ECR için RS‑232 veya USB |
| Yazıcı | Dahili termal (58 mm rulo) — banka slip'i basar |
| Güç | Sabit modelde adaptör; taşınabilir modelde şarjlı Li‑ion pil + dock |
| Sertifika | PCI‑PTS, EMVCo, TROY/Visa/Mastercard onaylı — (banka tahsis eder) |
| HummyTummy entegrasyonu | `bridge` · `charge_card` kuyruğu · **yalnız‑tahsilat**, fiş ayrı (köprü sürücüsü iskelet — bkz. Bölüm 1 inert notu) |

### 2.2 Android SmartPOS / all‑in‑one (PAX, Ingenico AXIUM) — `bank_ecr` veya `gmp3_card`

Dokunmatik Android tabanlı, yazıcısı gömülü "akıllı" terminal. Bazı modelleri **YN ÖKC (yazarkasa) modülü** ile gelir ve GMP‑3 üzerinden mali fiş basabilir → bu durumda `gmp3_card`.

| Özellik | Tipik değer |
|---|---|
| Ekran | 5"–6" kapasitif dokunmatik renkli — (modele göre) |
| İşlemci / OS | Android (üretici güvenlik katmanlı); ARM çok çekirdek |
| Kart okuma | EMV çip + NFC temassız + manyetik |
| Bağlantı | Wi‑Fi + 4G/LTE + Bluetooth; kablo için USB‑C; ECR için USB/soket |
| Yazıcı | Dahili termal, genelde 58 mm rulo |
| Güç | Şarjlı Li‑ion pil + USB‑C/dock şarj |
| YN ÖKC (opsiyon) | GMP‑3 fiscal_coupled — mali fişi cihaz basar |
| HummyTummy entegrasyonu | `bridge` · GMP‑3'te fiş+tahsilat tek işlem (köprü sürücüsü iskelet — bkz. Bölüm 1 inert notu) |

### 2.3 YN ÖKC entegre Yazarkasa‑POS (GMP‑3) — `gmp3_card`

Mali onaylı Yeni Nesil Ödeme Kaydedici Cihaz + entegre banka POS. **Mali fiş yalnızca bu tip onaylı cihazdan kesilir.** HummyTummy tarafında `fiscal_coupled` yetkinliğiyle temsil edilir; yazarkasa entegrasyonu (Hugin/Beko adaptörleri) ile aynı fiş satır yapısını (`TerminalFiscalLine`) kullanır.

| Özellik | Tipik değer |
|---|---|
| Cihaz sınıfı | Basit / Bilgisayar bağlantılı YN ÖKC (GİB onaylı) |
| Kart okuma | EMV + NFC + manyetik (banka POS modülü) |
| Mali birim | GİB güvenli mali modül (GMB); GMP‑3 protokolü |
| Bağlantı | Ethernet / GPRS‑4G; köprüye USB/soket |
| Yazıcı | Dahili termal (mali fiş + Z raporu); rulo genelde 58 mm, bazı YN ÖKC'lerde 80 mm — (üreticiden teyit) |
| Onay | GİB YN ÖKC onayı + banka üye işyeri (banka tahsis eder) |
| HummyTummy entegrasyonu | `bridge` · `fiscal_coupled` · fiş `fiscalNo` döner (köprü sürücüsü iskelet — bkz. Bölüm 1 inert notu) |

### 2.4 SoftPOS (telefonu POS'a çeviren) — `softpos`

Ayrı fiziksel terminal yerine, sertifikalı bir mobil uygulamanın NFC ile temassız kart kabul ettiği çözüm (**PCI CPoC** — temassız; **PCI SPoC** — ekrandan PIN; yeni çözümlerde bunları birleştiren/tamamlayan **PCI MPoC** — PCI SSC, 16.11.2022). HummyTummy'de `in_process` sağlayıcıdır (köprü yok; backend PSP'yi çağırır).

| Özellik | Tipik değer |
|---|---|
| Donanım | Standart Android telefon/tablet (NFC zorunlu) — COTS cihaz |
| Uygulama | Banka/PSP'nin **PCI CPoC/SPoC (veya güncel MPoC) sertifikalı** SoftPOS uygulaması |
| Kart okuma | Yalnız temassız (NFC); çip/manyetik yok |
| PIN | Yüksek tutarda ekrandan PIN (SPoC/MPoC sertifikası gerekli) — (PSP/BKM'den teyit) |
| Yazıcı | Yok; fiş dijital / ayrı ESC‑POS yazıcıdan |
| HummyTummy entegrasyonu | `in_process` · **yalnız‑tahsilat** · şu an `activatable=false` (PSP HTTP bağlı değil) |

---

## 3. Kullanım / operasyon (günlük senaryo)

> **Not:** Aşağıdaki akış, bir terminal `ACTIVE` (canlı) hâle geldiğinde **tasarlanan** operasyonu anlatır. Sistem bugün inert sevk edildiği ve köprü kart sürücüsü iskelet olduğu için bu akış sahada **henüz gerçek terminalde doğrulanmamıştır** (bkz. Bölüm 1). Test için yalnızca fail‑closed `simulator` sağlayıcısı kullanılabilir.

**Ön koşul:** Terminal `ACTIVE` (gerçek para) veya `SIMULATOR` (test) durumunda olmalı. Aksi halde POS, terminali sürmez ve **manuel kart** akışına düşer. POS bunu `GET /payment-terminal/active` ile öğrenir (`{ active, providerId, simulator }`).

Adım adım:

1. Garson/kasiyer POS'ta siparişi "**Ödemeye Geç → KART**" ile kapatmaya başlar.
2. POS, `POST /orders/:orderId/terminal-charge` çağırır. Bu istek **hiçbir şey kaydetmez**; terminale bir tahsilat başlatır (bridge sağlayıcıda `charge_card` kuyruğuna deterministik `idempotencyKey` ile bir komut yazılır).
3. Ekranda "Kartı okutun/takın" bilgisi görünür; müşteri kartı **cihaza** okutur/takar ve gerekiyorsa PIN girer. **Kart verisi HummyTummy'ye girmez — cihazda/bankada kalır.**
4. POS, `GET /orders/:orderId/terminal-charge/:chargeId` ile durumu **poll** eder.
5. Banka yanıtı:
   - **APPROVED** → `Payment` kaydı **şimdi** oluşur (`transactionId = approvalCode/RRN`). GMP‑3 ise cihaz mali fişi de bastı (`fiscalNo`); değilse yazarkasa/e‑Fatura hattı fişi keser.
   - **DECLINED** → Sipariş açık kalır; başka kartla/yöntemle tekrar denenir.
   - **TIMEOUT/ERROR** → Para kaydedilmez; sipariş açık kalır. (Bkz. Bölüm 7 mutabakat.)
6. Hâlâ bekleyen bir tahsilat iptal edilebilir: `POST .../terminal-charge/:chargeId/cancel`.
7. Yanlış tutar/iade: settlement öncesi **void** (`POST .../:chargeId/void`, ADMIN/MANAGER). `Payment` zaten `RECORDED` ise void değil, siparişin **iade (refund)** akışı kullanılır.
8. Gün sonu: Banka POS'undan **gün sonu (settlement)** alınır; HummyTummy'de `GET /payment-terminal/reconciliation` mutabakat listesi kontrol edilir (`NEEDS_REVIEW` kalmamalı).

> **"Bilgi fişi" mali belge değildir.** Yalnız‑tahsilat POS'unun bastığı banka slip'i mali fiş yerine geçmez; mali fiş yalnızca onaylı YN ÖKC/yazarkasadan kesilir. (VUK 483 sıra no.lu Tebliğ şartlarını taşıyan ve her satış için e‑Arşiv/e‑Fatura düzenleyen mükellefler ÖKC kullanımından muaf olabilir — bu halde mali belge, ÖKC fişi yerine e‑Arşiv/e‑Fatura'dır; muafiyet koşulları mali müşavirden teyit edilmeli.)

---

## 4. Kurulum ve sisteme bağlama

### 4.1 Fiziksel kurulum

- Terminali kasa/POS istasyonunun yanına, kablo mesafesinde konumlandırın.
- Banka bağlantısı için Ethernet (RJ45) veya operatör SIM (GPRS/4G); kablosuz modelde Wi‑Fi.
- **HummyBox köprüsüne** bağlantı: modele göre RS‑232 (seri), USB veya yerel ağ soketi. Köprü ve terminal **aynı LAN'da** olmalı.
- Termal rulo (genelde 58 mm) takılı ve dolu olmalı; kesintisiz güç için köprü + terminal tercihen UPS'e bağlı.

### 4.2 Köprü mü, cloud‑direct mi?

Kart POS terminali **her zaman köprü arkasındadır** (LAN çevre birimi). Yani `pos_terminal` cihazının `bridgeId`'si **set** olmalıdır; cloud‑direct (bridgeId null) değildir. `softpos` istisnadır (fiziksel terminal yok, backend PSP'yi doğrudan çağırır → köprü gerekmez).

Önce köprü hazır olmalı: HummyBox, `POST /v1/devices/pair`/claim ile provizyon edilip `online` olmalı ki `pos_terminal` onun altına alınabilsin.

### 4.3 Cihaz slotu ve eşleştirme (gerçek akış)

> **PARTNER_REDIRECT notu:** `pos_terminal` stoklu SKU olmadığı için, mağazada "ödeme → sipariş ödenince slot otomatik açılır" akışı bu cihaz için **çalışmaz**. Cihaz slotu **admin panelde elle** oluşturulur; donanımı banka/PSP verir.

1. **Slot oluştur:** Admin panelde (ilgili şube scope'unda) `pos_terminal` tipinde bir cihaz slotu oluşturun. Sistem **6 karakterli alfanümerik bir `pairCode`** üretir (`[A-Z0-9]`, ör. `K7QX2M` — yalnız rakam değildir) — **10 dk geçerli**, **şube başına en çok 10 bekleyen slot**. Cihaz köprü arkasında olacağı için köprüye bağlayın (`bridgeId`).
2. **Eşleştir:** Cihaz/köprü uygulaması `pairCode` ile `POST /v1/devices/pair` çağırır → **tek‑kullanımlık atomik claim** → sha256‑hash'li **bearer token** döner (**24 saat TTL**). **Ham token yalnız bir kez döner; at‑rest hash'lenir.**
   > ⚠️ **Token otomatik yenilenmez (mevcut sürüm).** Token, heartbeat ile uzamaz; `tokenExpiresAt` heartbeat'te güncellenmez ve süresi geçen token sertçe reddedilir. Bu nedenle bearer token **24 saatte sabit dolar** ve cihaz kimlik doğrulayamaz hale gelir (kart tahsilatı fail‑closed TIMEOUT'a düşer) → şimdilik **periyodik yeniden eşleştirme** gerekir. Heartbeat ile kayan (slide) yenileme henüz devrede değildir. (Bu TTL, `DEVICE_TOKEN_TTL_MS` varsayılanı olarak `pairCode` ile eşleşen cihazlar için — `pos_terminal` dâhil — geçerlidir; **`local_bridge` köprüsü hariçtir**: köprü kendi 30 günlük bearer token'ını taşır (`LOCAL_BRIDGE_TOKEN_TTL_MS`, varsayılan 30 gün).)
3. **Terminal kaydı (register):** `POST /payment-terminal/terminals` ile bir terminal kaydı açın: `providerId` (`gmp3_card` / `bank_ecr` / `softpos` / `simulator`), `serial`, opsiyonel `deviceId` (eşleşen `pos_terminal` slotu) ve `config`. Kayıt **`CONFIGURED_NOT_ACTIVE`** (inert, fail‑closed) başlar — henüz para çekemez.
4. **Aktifleştir:** Sertifikalı donanım eşleştikten sonra `PATCH /payment-terminal/terminals/:id/activation` ile **`ACTIVE`**'e alın. Kapılar: sağlayıcı kayıtlı olmalı; **simülatör asla ACTIVE olamaz** (yalnız `SIMULATOR`); **bridge sağlayıcıda eşleşmiş bir cihaz zorunlu**; `activatable=false` olan sağlayıcı (ör. `softpos`) ACTIVE'e **alınamaz**.
   > ⚠️ **Aktive etmek "çalışır" demek değildir.** `ACTIVE`, yalnızca yazılım kapısını açar; köprünün **gerçek kart sürücüsü (ör. `ingenico_iwl`) hâlâ iskelettir** ve uçtan uca çekim hiçbir gerçek terminalde doğrulanmamıştır. Bu tamamlanmadan `ACTIVE` bir `bridge` terminali sahada onay üretmez (tahsilat fail‑closed TIMEOUT'a düşer). Gerçek canlı çekim için **köprü kart sürücüsünün tamamlanması + sertifikalı donanım + banka/PSP üye işyeri sözleşmesi + kart şeması/mali sertifikasyon** şarttır *(kesin sertifikasyon adımları banka/PSP/kart şeması kaynağından teyit edilmeli)*.
5. **Test:** Gerçek paraya geçmeden uçtan uca deneyin — **ancak gerçek terminal kaydı (`bank_ecr`/`gmp3_card`/`softpos`) SIMULATOR durumuna alınamaz.** `SIMULATOR` durumu yalnızca `providerId='simulator'` kaydı içindir (kapı: SIMULATOR yalnız simülatör sağlayıcıda geçerlidir). Bu nedenle test için **ayrı bir `simulator` sağlayıcılı terminal kaydı** açın ve onu `SIMULATOR`'da çalıştırın (fail‑closed simülatör, sahte onay üretmez); gerçek donanım kaydı ise doğrudan `CONFIGURED_NOT_ACTIVE → ACTIVE` geçişini yapar. **Simülatör testinin geçmesi, gerçek terminalde çekim yapıldığı anlamına gelmez** — köprü kart sürücüsü hâlâ iskelettir (bkz. adım 4 uyarısı).

`resolveTerminal`, yalnızca `ACTIVE` veya `SIMULATOR` durumundaki, retire edilmemiş, önce şubeye özel sonra tenant‑geneli terminali seçer. Bu yüzden **hiçbir tenant'ta ACTIVE terminal yoksa sistem tamamen inert kalır** ve manuel kart akışı değişmez (sıfır regresyon).

---

## 5. Tedarik ve sağlayıcı (bayi için)

> **Bu cihazda bayinin donanım marjı yoktur.** POS donanımını **banka/PSP tahsis eder** ve komisyon oranı, **TCMB'nin belirlediği azami sınırlar çerçevesinde** banka/PSP ile mutabık kalınarak belirlenir; HummyTummy ödeme kuruluşu değildir, cihazı satmaz. Aşağıdaki "maliyet/marj" bu gerçeğe göre yazılmıştır — uydurma alış fiyatı verilmemiştir. (HummyTummy'nin sattığı çevre birimleri için güncel perakende fiyat **katalogdan/QuoteService'ten** gelir, KDV %20 dahil; alış maliyeti ve marj distribütör teklifine göre değişir, burada bağlayıcı değildir.)

**Donanımı kim verir:** Restoran, bir **banka veya lisanslı ödeme kuruluşu (PSP) ile üye işyeri sözleşmesi** yapar; banka POS cihazını (Ingenico/PAX/Verifone vb.) **tahsis eder, kiralar veya ücretsiz verir** (bankaya göre değişir), komisyon oranını da (TCMB azami sınırları altında, ciro/sektöre göre pazarlığa açık) banka belirler. GMP‑3'lü YN ÖKC ise **GİB onaylı yazarkasa üreticisinin yetkili bayisinden/servisinden** alınır (bu kalem QUOTE_ONLY sınıfına girer — teklif/GİB süreci gerekir).

**Türkiye kanalı (örnek, teyit gerekir):**
- Banka POS: müşterinin çalıştığı banka (Ziraat, İş Bankası, Garanti BBVA, vb.) üye işyeri birimi. *(oran/koşul bankadan teyit)*
- Bağımsız PSP/SoftPOS: **TCMB lisanslı (BKM üyesi)** ödeme kuruluşları — ödeme kuruluşu/e‑para lisansını **TCMB** verir (6493 s. Kanun; düzenleme‑denetim‑lisans yetkisi 7192 s. Kanunla (RG 22.11.2019, sayı 30956) 1/1/2020'den itibaren BDDK'dan TCMB'ye devredildi). BKM bir lisans mercii değil, kart sistemleri operatörü/operasyonel‑standart kuruluşudur. *(ürün ve komisyon PSP'den teyit)*
- YN ÖKC: Hugin, Beko/Token, Ingenico ve diğer GİB onaylı üreticilerin yetkili bayileri. *(GİB onaylı marka listesinden teyit)*

**Tedarik süresi:** Banka POS başvuru→kurulum tipik olarak birkaç iş günü; YN ÖKC + GMP‑3 eşleştirme + GİB kaydı daha uzun sürebilir. *(süre bankaya/bölgeye göre değişir — teyit)*

**Bayinin gelir kalemi (donanım değil, hizmet):**
- Kurulum + fiziksel montaj (köprüye bağlama, ağ/soket).
- **GMP‑3 / ECR eşleştirme ve HummyTummy entegrasyonu** (terminal register + activation + test).
- Aylık entegrasyon/servis/destek paketi (SaaS aboneliğiyle beraber).
- HummyBox köprüsü + yazarkasa/ESC‑POS çevre birimleri (bunlar DIRECT_SALE olabilir → asıl donanım marjı burada; fiyat katalogdan/QuoteService'ten gelir).

**Alternatif kaynak:** Müşteri mevcut banka POS'unu (BYO — `ownership='byo'`) getirebilir; bayi yalnız entegrasyonu yapar. Farklı banka/PSP teklifleri kıyaslanabilir (komisyon oranı, TCMB azami sınırı altında pazarlığa açıktır).

---

## 6. Bakım ve sarf malzeme

| Kalem | Detay |
|---|---|
| **Termal rulo** | Genelde **58 mm** genişlik (banka slip'i); YN ÖKC'de üreticinin belirttiği rulo (bazı YN ÖKC'lerde 80 mm). BPA'sız tercih edilir. Yedek rulo bulundurun. |
| **Pil (taşınabilir model)** | Li‑ion; şişme/şarj tutmama olursa değiştirin (banka/servis). Cihazı dock'ta şarjlı tutun. |
| **Temizlik** | Kart yuvası/temassız anteni için kuru/hafif nemli bez; çip okuyucuya temizleme kartı. Ekranı aşındırıcı kimyasalla silmeyin. |
| **Firmware/EMV parametre** | Banka **uzaktan** günceller (EMV kernel, TROY/Visa/MC parametreleri). Cihaz internete/köprüye bağlı olmalı ki güncelleme insin. |
| **YN ÖKC mali güncelleme** | GİB/üretici yazılım güncellemeleri + **mali hafıza/Z raporu** düzeni; yetkili servis kapsamında. |
| **SoftPOS uygulaması** | PSP uygulaması güncel tutulmalı; işletim sistemi ve NFC modülü desteklenen sürümde olmalı (sertifika şartı). |
| **Köprü tarafı** | HummyBox agent güncel; `charge_card` sürücüsü/ECR profili doğru; heartbeat `online`. Token 24s TTL'de dolduğundan periyodik yeniden eşleştirme takvime alınmalı. |
| **Rulo değişimi** | Bittiğinde cihaz uyarır; yeni ruloyu yön işaretine göre takın, kapağı kilitleyin. |

Periyodik kontrol: gün sonu settlement + HummyTummy mutabakat listesi (haftalık en az bir kez), rulo/pil stok kontrolü (aylık), firmware/uygulama sürüm kontrolü (banka/PSP bildirimlerine göre).

---

## 7. Sorun giderme ve arıza

| Belirti | Olası neden | Çözüm |
|---|---|---|
| POS "manuel kart"a düşüyor, terminal sürülmüyor | Terminal `ACTIVE`/`SIMULATOR` değil ya da retire | `GET /payment-terminal/active` kontrol; kaydı `ACTIVE`'e alın (kapıları sağlayın) |
| Tahsilat başlıyor ama hiç yanıt gelmiyor → **TIMEOUT** | Köprü offline / cihaz eşleşmemiş / ECR profili yok / **köprü kart sürücüsü iskelet (henüz gerçek çekim yapmıyor)** / **bearer token 24s'de dolmuş** | Köprü heartbeat'ini, `pos_terminal` eşleşmesini ve `deviceId` bağını kontrol edin; token süresi dolduysa yeniden eşleştirin; sürücü tamamlanmadıysa gerçek çekim beklemeyin; fail‑closed olduğu için **para kaydolmaz** |
| Sürekli **DECLINED** | Bankada kart/limit/POS sorunu | Başka kartla test; banka üye işyeri destek hattı |
| Kart okumuyor (çip) | Kirli/aşınmış çip okuyucu | Temizleme kartı; temassızı deneyin; olmazsa RMA |
| Temassız çalışmıyor | NFC anteni/ayarı | Cihazı yeniden başlatın; SoftPOS'ta NFC iznini açın |
| Kâğıt basmıyor / soluk | Rulo bitti / ters takılı / kafa kirli | Ruloyu doğru yönde takın; kafa temizliği |
| **APPROVED ama `Payment` yazılmadı** | Onay yanıtı kayboldu (ağ) → kurtarma denemesi | Sistem `query_last` ile kurtarır; tükenirse **`NEEDS_REVIEW`** → `GET /payment-terminal/reconciliation`'dan **elle mutabakat** (banka gün sonuyla eşleştir) |
| GMP‑3'te fiş basılmadı | Cihaz fiş modülü/kağıt/mali hafıza sorunu | YN ÖKC servisine; `bank_ecr`/`softpos`'ta fiş zaten ayrı hattan |
| Çift çekim şüphesi | — | Tasarımda `charge_card` NON_RETRYABLE → otomatik çift çekim olmaz; yine de banka gün sonuyla mutabakat yapın |

**Ne zaman RMA / servis:** çip veya temassız okuyucu donanım arızası, PIN pad hatası (PCI kilidi/tamper), yazıcı mekanik arızası, pil şişmesi, açılmama. Kart terminali donanımı **bankaya/yetkili servise** aittir; onarımı bank/PSP/servis üstlenir (bkz. Bölüm 8).

---

## 8. Garanti ve RMA süreci

> Bu cihazda garanti/RMA **HummyTummy'de değil, donanımı veren banka/PSP veya YN ÖKC yetkili servisindedir** (PARTNER_REDIRECT). HummyTummy'nin sattığı/stokladığı bir POS terminali yoktur.

- **Banka POS (`bank_ecr`):** Cihaz genelde bankanın mülkü/kirası; arıza, kayıp, güncelleme bankanın sorumluluğunda. Değişim, banka üye işyeri destek hattı üzerinden — çoğunlukla yerinde/kargo swap. *(süre ve koşul üye işyeri sözleşmesinden — teyit)*
- **YN ÖKC / GMP‑3 (`gmp3_card`):** GİB onaylı üreticinin **yetkili teknik servisi**; mali cihaz olduğu için müdahale yalnız yetkili serviste yapılır. Mali hafıza/Z raporu koruması esastır.
- **SoftPOS (`softpos`):** Donanım müşterinin telefonu (garantisi üreticide); "servis" aslında PSP'nin **uygulama/sertifika** desteğidir.

> **HummyTummy'nin sattığı çevre birimleri için garanti rejimi (B2B).** Bu belge POS terminalini kapsar (partner‑redirect); ancak mağaza (`/admin/store`) üzerinden restoran **işletmesine** satılan çevre birimleri (HummyBox köprüsü, yazarkasa/ESC‑POS yazıcı vb.) bir **B2B (tacirler arası) satıştır**: satıcı HummyTummy/bayi, alıcı kural olarak **tacir** olan restoran işletmesidir. 6502 sayılı Tüketicinin Korunması Hakkında Kanun (RG 28.11.2013, sayı 28835) m.3 tüketiciyi "ticari veya mesleki olmayan amaçlarla hareket eden gerçek/tüzel kişi" olarak tanımlar; restorana satış ticari amaçlı olduğundan tüketici koruması (6502 ayıplı mal hükümleri ve Garanti Belgesi Yönetmeliği asgari süreleri) **kural olarak uygulanmaz**. Bunun yerine **6098 sayılı Türk Borçlar Kanunu** m.219 (satıcı ayıptan sorumlu) ve m.223 (alıcının muayene/ayıp ihbarı külfeti) ile **TTK m.23/1‑c**'nin kesin süreleri (açık ayıp **2 gün**, gizli ayıp **8 gün** içinde inceleme/ihbar) geçerlidir. TBK'nın ayıp hükümleri emredici değildir (satıcının ağır kusuru — m.221 — hariç, sorumsuzluk/sınırlama kaydı geçerlidir); dolayısıyla üreticinin verdiği 12 veya 24 aylık garanti B2B'de geçerli ve **bağlayıcıdır**. (Garanti Belgesi Yönetmeliği — RG 13.6.2014, sayı 29029 — tüketiciye yöneliktir; asgari 2 yıllık süre yalnızca yönetmelik ekindeki listeye tabi tüketici satışlarında uygulanır.) *(İstisna: alıcı istisnaen tüketici sayılırsa — şahıs, ticari amaç dışı — 6502 devreye girer.)*

**Bayinin yükümlülüğü (HummyTummy tarafı):** Entegrasyon kaynaklı sorunlarda (köprü, `charge_card` sürücüsü/ECR profili, terminal register/activation, mutabakat) destek; donanım arızasını doğru muhataba (banka/servis) yönlendirmek. HummyTummy'de cihaz kaydında `warrantyUntil` alanı tutulabilir; `ownership` = `sold | rented | byo` ile sahiplik izlenir (POS terminalinde tipik `rented`/`byo`).

**RMA akışı (özet):** Arıza tespiti → banka/servis kaydı → yedek cihaz/kart okuyucu → yeni cihaz eşleştir (yeni `pairCode` + `POST /v1/devices/pair`) → terminal kaydını yeni `serial`/`deviceId`'ye güncelle → (isterseniz ayrı bir `simulator` sağlayıcılı kayıtla `SIMULATOR`'da uçtan uca doğrulayın; gerçek kaydın kendisi SIMULATOR'a alınamaz) → gerçek kaydı `ACTIVE`'e geçirin.

---

## 9. Regülasyon ve uyumluluk

> Aşağıdaki mevzuat özeti Türkiye içindir; **her sayısal eşik/tarih/oran resmi kaynaktan teyit edilmelidir.**

**Üye işyeri ve BKM.** Kartla ödeme kabulü için işyerinin bir banka/PSP ile **üye işyeri sözleşmesi** yapması zorunludur; donanım, komisyon ve kurallar bu sözleşme + **BKM (Bankalararası Kart Merkezi)** üye işyeri kılavuzuyla belirlenir ([BKM Üye İşyeri Kılavuzu](https://bkm.com.tr/wp-content/uploads/2022/03/Kartl%C4%B1-%C3%96deme-Sistemleri-Kurallar%C4%B1-%C3%9Cye-%C4%B0%C5%9Fyeri-K%C4%B1lavuzu.pdf)). Ödeme hizmeti sunmak **6493 sayılı Kanun** kapsamında lisans gerektirir; bu lisansı **TCMB (Türkiye Cumhuriyet Merkez Bankası)** verir/denetler — 6493 kapsamındaki ödeme/elektronik para kuruluşlarına ilişkin düzenleme‑denetim‑lisans yetkisi **7192 sayılı Kanunla (RG 22/11/2019, sayı 30956) 1/1/2020'den itibaren BDDK'dan TCMB'ye devredilmiştir**. **BKM bir lisans mercii değil, kart sistemleri operatörü/operasyonel‑standart kuruluşudur.** HummyTummy bu lisansa sahip değildir, bu yüzden yalnız entegratördür.

**Kart şeması sertifikaları.** Terminal **EMVCo** (çip/temassız), **PCI‑PTS** (PIN pad donanımı) ve **TROY/Visa/Mastercard** onaylı olmalı; bunları banka/üretici tahsis eder. İşyeri tarafında **PCI‑DSS** yükümlülüğü vardır ([BKM İşyeri Kayıt Sistemi Kuralları](https://www.procompliance.net/wp-content/uploads/2022/09/IsyeriKayitSistemiKurallari.pdf)); kart verisi işyeri sistemine girmediği sürece kapsam daralır (HummyTummy kart verisini görmez — cihaz/bankada kalır).

**SoftPOS özel.** Telefonu POS'a çeviren çözümler **PCI CPoC** (temassız kabul, PCI SSC 2019) veya **PCI SPoC** (COTS üzerinde ekrandan PIN, 2018) sertifikalı bir uygulama gerektirir; PCI SSC **16.11.2022'de bu ikisini birleştiren/tamamlayan PCI MPoC (Mobile Payments on COTS)** standardını yayımlamıştır (önceki CPoC ve SPoC standartları henüz yürürlükten kaldırılmamıştır) ve yeni SoftPOS çözümleri giderek **MPoC** üzerinden değerlendirilir ([PCI SSC MPoC duyurusu](https://www.pcisecuritystandards.org/about_us/press_releases/pci-ssc-publishes-new-standard-for-mobile-payment-solutions/); [PCI CPoC/SPoC özeti](https://eyenikaya.wordpress.com/2021/08/22/pos-cpoc-standardi-softpos-terimleri-hakkinda/)). MPoC, PIN + temassız kabulü tek bir COTS cihazda modüler biçimde birleştirir. Türkiye'de SoftPOS = Android + NFC temassız kart kabulüdür ve **BKM TechPOS** ortak kart‑kabul altyapısı üzerinden yürür; kart kabulü için banka/PSP ile **üye işyeri anlaşması** şarttır. Çözümün mükellefe sunumu ayrıca **VUK 507** uyumunu (GİB onaylı ÖKC/işletmeci entegrasyonu — yani mali eşlemeye/GMP‑3'e bağlanır) gerektirir. Türkiye'de kart şeması (Visa/Mastercard/TROY) tap‑to‑phone programları ve BKM/kart şeması onayları da aranır. Sertifikasız SoftPOS ile kart kabul edilemez — bu yüzden sistemde `softpos` sağlayıcısı `activatable=false` (fail‑closed) kalır. *(SoftPOS için ekrandan PIN eşiği ve yerel onay durumu PSP/BKM/PCI SSC'den resmi kaynaktan teyit edilmeli)*

**Mali entegrasyon (GİB / YN ÖKC / GMP‑3).** GMP‑3, GİB'in kablolu banka POS–ÖKC haberleşme protokolüdür; mükelleflerin satış/fatura sistemlerini **YN ÖKC ile GMP‑3** dokümanına göre eşleştirmesi düzenlenmiştir ([GİB GMP‑3 dokümanı](https://ynokc.gib.gov.tr/UploadedFiles/Files/GMP3_v40_26122017.pdf); [YN ÖKC Teknik Kılavuzu](https://ynokc.gib.gov.tr/UploadedFiles/Files/YN_OKC_TEKNIK_KILAVUZU_08092023.pdf)). Cihazın GİB ile haberleşebilmesi için **TSM (Trusted Service Manager) zorunludur** ve bakım/onarım/aktivasyon/mühürleme yalnızca **yetkili servis** tarafından yapılır; mali hafıza + günlük Z raporu değiştirilemez biçimde GİB'e iletilir. GİB düzenlemelerine göre (özellikle **VUK 483 (RG 30.9.2017, sayı 30196) ve 507 sıra no.lu Genel Tebliğler**) banka EFT‑POS'larının Basit/Bilgisayar bağlantılı YN ÖKC'lerle **entegre çalışması esastır**; "bankaya iade" seçeneği her mükellef/cihaz tipi için mutlak zorunluluk değil, geçiş sürecine bağlı bir uygulamadır *(geçiş koşulları yürürlükteki Tebliğ'den teyit edilmeli)*. YN ÖKC kapsamındaki mükellefler için **her YN ÖKC'den kartlı ödeme kabulü ve üye işyeri anlaşması** yükümlülüğü kamuoyuna **1/7/2024** olarak duyurulmuştur; ancak bu tarih çok sayıda erteleme geçirmiş, kapsam mükellef segmentine göre değişmektedir ([GİB YN ÖKC SSS](https://ynokc.gib.gov.tr/Home/SSS)). *(kesin yürürlük tarihi, kapsam ve mükellef bazlı istisnalar resmi kaynaktan — GİB Tebliğ metni / mali müşavir — teyit edilmelidir)*

- **Mali fiş yalnız onaylı YN ÖKC/yazarkasadan kesilir.** `gmp3_card` (fiscal_coupled) fişi cihaz basar; `bank_ecr`/`softpos`'ta fiş ayrı yazarkasa/e‑Fatura hattından kesilir. **Banka slip'i/"bilgi fişi" mali belge değildir.** (VUK 483 şartlarını taşıyan e‑Arşiv/e‑Fatura mükellefleri ÖKC'den muaf olabilir; muafiyet koşulları mali müşavirden teyit.)

**CE / TSE / AEEE (WEEE).** Terminaller Türkiye Gümrük Birliği kapsamında **CE işaretli** olmalı; CE, ilgili teknik düzenlemelere uygunluğu gösterir — başlıca: **Elektromanyetik Uyumluluk Yönetmeliği (2014/30/AB)** (RG 2.10.2016, sayı 29845), alçak gerilimli modeller için **Belirli Gerilim Sınırları İçin Tasarlanan Elektrikli Ekipman ile İlgili Yönetmelik (2014/35/AB)** (RG 2.10.2016) ve NFC/kablosuz haberleşme içerdiğinden **Telsiz Ekipmanları Yönetmeliği (2014/53/AB)** (RG 5.11.2020, sayı 31295; yetkili BTK); zararlı madde kısıtı için ayrıca **RoHS Yönetmeliği** (RG 26.12.2022, sayı 32055) uygulanır. İlgili **TSE**/emniyet şartları da geçerlidir *(marka bazında teyit)*. Elektronik atık: **Atık Elektrikli ve Elektronik Eşyaların Yönetimi Hakkında Yönetmelik** (RG 26.12.2022, sayı 32055; adı ilga edilen 2012 tarihli "Kontrolü Yönetmeliği"ni yürürlükten kaldırmıştır) kapsamında cihaz çöpe atılmaz; üretici/dağıtıcı **EÇBS/üretici kaydı** yükümlülüğü çerçevesinde yetkili toplama noktasına verilir *(kayıt/bildirim yükümlülüğünün ayrıntısı resmi kaynaktan teyit edilmeli)*. Pil içeren modellerde **atık pil**, Atık Pil ve Akümülatörlerin Kontrolü mevzuatı uyarınca ayrı toplanır.

---

## 10. KVKK ve veri gizliliği

- **Kart verisi.** Terminal, tam kart numarası/PIN'i **kendi güvenli donanımında ve bankada** işler; HummyTummy bu veriyi **görmez/saklamaz**. Sistem yalnız `approvalCode`/`RRN`, kart markası ve **maskeli PAN** (ör. `**** 1234`) gibi ödeme kanıtlarını `Payment` üzerinde tutar — PCI kapsamını daraltan doğru tasarım. Tam PAN'ı hiçbir log/alanda saklamayın.
- **Kişisel veri.** Ödeme işlemi ve fatura/e‑Arşiv kaydı, KVKK anlamında müşteri kişisel verisi içerebilir (isim, vergi no, fiş bilgisi). Bunlar **6698 sayılı KVKK** ve **VUK/mali mevzuat** saklama süreleriyle işlenir; aydınlatma yükümlülüğü işyerine aittir.
- **Cihaz kimlik/token.** Eşleştirme token'ı at‑rest **sha256‑hash** tutulur, ham token bir kez döner; bearer token 24s TTL'lidir (**otomatik yenileme/kayan yenileme mevcut sürümde devrede değil → dolduğunda yeniden eşleştirme gerekir**). Retire/RMA'da cihaz token'ı iptal edilir (anti‑resurrection).
- **Bayinin sorumluluğu.** Kurulumda test kartı/gerçek kart verilerini not almayın; slip'leri güvenli imha edin; köprü ve terminal ağını (LAN) yetkisiz erişime kapalı tutun; SoftPOS telefonunda ekran kilidi/güncel OS zorunlu.

---

## 11. Satış ve devreye alma kontrol listesi

**Satış / uygunluk (öncesi):**
- [ ] Müşteride banka/PSP **üye işyeri sözleşmesi** var mı (yoksa lisanslı banka/PSP'ye **yönlendir** — HummyTummy POS satmaz).
- [ ] YN ÖKC kapsamı ve mali entegrasyon ihtiyacı belirlendi mi (mali müşavirle) — GMP‑3 `gmp3_card` mi, yoksa yalnız‑tahsilat `bank_ecr`/`softpos` mu?
- [ ] SoftPOS isteniyorsa: PSP uygulaması **PCI CPoC/SPoC (veya güncel MPoC) sertifikalı** mı, telefon NFC destekli mi?
- [ ] Donanım sahipliği: `sold | rented | byo` netleşti mi (POS'ta çoğunlukla rented/byo).
- [ ] **Beklenti yönetimi:** Müşteriye kart‑terminali sisteminin bugün **inert sevk edildiği**, köprü kart sürücüsünün iskelet olduğu ve gerçek çekimin **köprü sürücüsü tamamlanıp sertifikasyon bitene kadar mümkün olmadığı** anlatıldı mı? ("kur → aktive → çalışır" vaadi verilmez.)

**Fiziksel + ağ kurulum:**
- [ ] HummyBox köprüsü kurulu, provizyonlu ve `online`.
- [ ] Terminal köprüye bağlı (RS‑232/USB/LAN), banka bağlantısı (Ethernet/4G) var.
- [ ] Termal rulo (58 mm) takılı; UPS önerildi.

**Sisteme bağlama (HummyTummy):**
- [ ] Admin panelde `pos_terminal` slotu oluşturuldu, **6 karakterli alfanümerik `pairCode`** (10 dk) alındı, köprüye (`bridgeId`) bağlandı.
- [ ] `POST /v1/devices/pair` ile eşleştirildi (atomik claim, bearer token bir kez döndü). **Not:** token 24s TTL'de otomatik yenilenmez → periyodik yeniden eşleştirme planlandı.
- [ ] `POST /payment-terminal/terminals` ile terminal kaydı açıldı (`providerId`, `serial`, `deviceId`) → `CONFIGURED_NOT_ACTIVE`.
- [ ] Test için **ayrı `simulator` sağlayıcılı** bir terminal kaydıyla `SIMULATOR`'da uçtan uca test (onay → `Payment`; GMP‑3 senaryosunda `fiscalNo`). Gerçek kayıt SIMULATOR'a alınmaz. **Simülatör geçmesi gerçek terminal çekimini kanıtlamaz** (köprü sürücüsü iskelet).
- [ ] Sertifikalı donanımda gerçek kayıt `CONFIGURED_NOT_ACTIVE → ACTIVE` (`PATCH .../activation`; kapılar geçti: bridge'de eşleşme var, `activatable` uygun). **Uyarı:** `ACTIVE` yalnızca kapıyı açar; köprü kart sürücüsü tamamlanıp sertifikasyon bitene kadar sahada gerçek çekim beklenmez.

**Mali + mutabakat:**
- [ ] GMP‑3'te mali fiş cihazdan basılıyor; yalnız‑tahsilatta yazarkasa/e‑Fatura hattı fiş kesiyor.
- [ ] Banka gün sonu (settlement) alınıyor; `GET /payment-terminal/reconciliation` boş (`NEEDS_REVIEW` yok).

**Regülasyon + veri:**
- [ ] CE/TSE, PCI‑PTS/EMV/TROY onayları (banka tahsis) doğrulandı.
- [ ] KVKK aydınlatma + PCI‑DSS işyeri yükümlülüğü hatırlatıldı; tam PAN saklanmıyor.
- [ ] AEEE/atık pil bertaraf bilgisi verildi.
- [ ] Devir/teslim: rulo stoğu, banka destek hattı, servis muhatabı (RMA) müşteriye bildirildi.

---

### Kaynaklar
- [BKM — Kartlı Ödeme Sistemleri Kuralları Üye İşyeri Kılavuzu](https://bkm.com.tr/wp-content/uploads/2022/03/Kartl%C4%B1-%C3%96deme-Sistemleri-Kurallar%C4%B1-%C3%9Cye-%C4%B0%C5%9Fyeri-K%C4%B1lavuzu.pdf)
- [BKM — İşyeri Kayıt Sistemi (İKS) Kuralları](https://www.procompliance.net/wp-content/uploads/2022/09/IsyeriKayitSistemiKurallari.pdf)
- [GİB — GMP‑3 Harici Donanım/Yazılım Haberleşme Protokolü](https://ynokc.gib.gov.tr/UploadedFiles/Files/GMP3_v40_26122017.pdf)
- [GİB — YN ÖKC Teknik Kılavuzu (Sürüm 7.0)](https://ynokc.gib.gov.tr/UploadedFiles/Files/YN_OKC_TEKNIK_KILAVUZU_08092023.pdf)
- [GİB — Yeni Nesil ÖKC Sık Sorulan Sorular](https://ynokc.gib.gov.tr/Home/SSS)
- [GİB — YN ÖKC Mevzuatı (VUK 483/509 Genel Tebliğleri, GMP‑3)](https://ynokc.gib.gov.tr/Home/Mevzuat)
- [PCI CPoC/SPoC / SoftPOS terimleri](https://eyenikaya.wordpress.com/2021/08/22/pos-cpoc-standardi-softpos-terimleri-hakkinda/)
- [PCI SSC — Mobil Ödeme (MPoC) standardı duyurusu (16.11.2022)](https://www.pcisecuritystandards.org/about_us/press_releases/pci-ssc-publishes-new-standard-for-mobile-payment-solutions/)
- [BKM — Ödeme Çözümleri (TechPOS dâhil)](https://bkm.com.tr/en/products-and-services/payment-solutions/)
- [PAX Türkiye — SoftPOS](https://www.paxturkiye.com/blog/softpos-odeme-sistemleri-sektorunun-en-yeni-urunu-mu)
- [Resmî Gazete — 6493 sayılı Kanun (ödeme/e‑para; lisans yetkisi 7192 s.K. ile TCMB'ye devredildi)](https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6493&MevzuatTur=1&MevzuatTertip=5)
- [Resmî Gazete — 6502 sayılı Tüketicinin Korunması Hakkında Kanun (28.11.2013, sayı 28835)](https://www.resmigazete.gov.tr/eskiler/2013/11/20131128-1.htm)
- [Resmî Gazete — Garanti Belgesi Yönetmeliği (13.6.2014, sayı 29029)](https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm)
- [Resmî Gazete — Alçak Gerilim (LVD) Yönetmeliği 2014/35/AB (2.10.2016)](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-1.htm)
- [Resmî Gazete — Elektromanyetik Uyumluluk (EMC) Yönetmeliği 2014/30/AB (2.10.2016, sayı 29845)](https://www.resmigazete.gov.tr/eskiler/2016/10/20161002-2.htm)
- [Resmî Gazete — Telsiz Ekipmanları (RED) Yönetmeliği 2014/53/AB (5.11.2020, sayı 31295)](https://www.resmigazete.gov.tr/eskiler/2020/11/20201105-6.htm)
- [Resmî Gazete — RoHS Yönetmeliği (26.12.2022, sayı 32055)](https://www.resmigazete.gov.tr/eskiler/2022/12/20221226-2.htm)

> **Not:** Bu belge HummyTummy sistem gerçeklerine (device‑mesh eşleştirme, `pos_terminal`, `payment-terminal` sağlayıcıları, GMP‑3 `fiscal_coupled`) birebir dayanır. Kart tahsilat rayı bugün **inert** sevk edilir (köprü kart sürücüsü iskelet; uçtan uca hiçbir gerçek terminalde doğrulanmadı). Mevzuata ilişkin sayısal eşik/tarih/oranlar ve tedarik/fiyat bilgileri **resmi kaynaktan / banka‑PSP'den teyit** edilmelidir.

> Son güncelleme: 2026-07-02 - sürüm taslağı. Regülasyon/mali bilgiler bilgilendirme amaçlıdır; güncel resmi mevzuat (GİB, BKM, KVKK Kurumu, Ticaret Bakanlığı, ilgili yönetmelikler) esastır.
