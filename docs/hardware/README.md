# Donanım Yönergeleri — İçindekiler & Genel Bakış

Bu set, HummyTummy KDS/POS SaaS platformuyla birlikte kullanılan restoran donanımlarının (yazarkasa/ÖKC, kart terminali, ekranlar, yazıcı, çekmece, barkod okuyucu, arayan-numara cihazı ve HummyBox ağ köprüsü) bayi, kurulumcu ve operatörlere yönelik cihaz-üstü yönerge derlemesidir. Her doküman; cihazın platformdaki rolünü, teknik özellikleri, günlük operasyonu, kurulum/eşleştirme (device-mesh provizyon) akışını, tedarik/bakım/sorun giderme, garanti/RMA, Türkiye regülasyonu ve KVKK başlıklarını kapsar. Amaç, bir cihazın uçtan uca doğru kurulup mevzuata uygun satılıp devreye alınabilmesidir.

> **Ortak uyarı (bilgilendirme amaçlıdır):** Bu dokümanlardaki regülasyon, garanti, vergi ve KVKK açıklamaları bilgilendirme amaçlıdır, hukuki/mali görüş değildir. Mevzuat eşikleri, tarihler, fiyatlar ve model künyeleri "(resmi kaynaktan teyit edilmeli)" olarak işaretlenen yerlerde bağlayıcı değildir; yürürlükteki mevzuat ve üretici/GİB belgeleriyle doğrulanmalıdır. Fiscal (mali) cihazlar dışındaki hiçbir cihaz mali fiş kesmez.

## 0. Başlangıç — Ortak Çerçeve

Herhangi bir cihaz dokümanına geçmeden önce okunması gereken şemsiye belge; regülasyon, garanti/RMA, KVKK ve ortak kurulum/pairing standardı burada tanımlıdır.

- [Genel Çerçeve, Regülasyon ve Ortak Süreçler](./00-genel-cerceve.md) — Kapsam ve `Device.kind`/`ownership` eşlemesi, Türkiye yatay regülasyonu (7223, CE/RoHS, AEEE), 6502/KVKK/PCI, mali mevzuat (YN ÖKC, GMP-3), garanti/RMA politikası ve ortak eşleştirme standardı (6 karakterli alfanümerik pairCode + sha256 token).

## 1. Mali (Fiscal) Cihazlar

Vergi mevzuatına tabi, satışı özel tier'da (yazarkasa = QUOTE_ONLY, kart terminali = PARTNER_REDIRECT) olan cihazlar.

- [Yazarkasa POS (Ödeme Kaydedici Cihaz / ÖKC)](./01-yazarkasa-okc.md) — Yeni Nesil ÖKC'nin mali rolü, Z/X raporu, mali fiş vs bilgi fişi ve köprü-arkası provizyon; köprüdeki yazarkasa sürücülerinin (Hugin iskelet, Beko yok, Ingenico iWL/mali değil) henüz üretime hazır olmadığı uyarısıyla.
- [POS / Kart Ödeme Terminali (Banka ECR / SoftPOS)](./09-pos-terminal.md) — "Ödemeye Geç → KART" akışının yalnız banka ONAY'ında `Payment` yazması, dört sağlayıcı (gmp3_card / bank_ecr / softpos / simulator), `charge_card` NON_RETRYABLE para güvenliği ve NEEDS_REVIEW mutabakatı.

## 2. Ekranlar

Sipariş/mutfak akışını gösteren, provizyonlu (kendi bearer token'ı olan) cihazlar.

- [KDS / Mutfak & Bar Ekranı](./03-kds-ekrani.md) — Sunmi D2s ve PENETEK IP65 panel PC için mutfak/bar ekranı; kurulum, PoE/IP sınıfı ve gerçek prod eşleştirme davranışı (sabit 24 saat token TTL, heartbeat uzatmaz).
- [Tablet (Garson ve Müşteri/Masa Tableti)](./04-tablet.md) — Yazıcılı Sunmi V2 Pro (adisyon/bilgi fişi; mali fiş DEĞİL) ve Samsung Galaxy Tab A9+; cloud-direct provizyon, kiosk/MDM ve periyodik yeniden-eşleştirme gereği.

## 3. Çevre Birimleri (Peripherals)

Genelde HummyBox köprüsü arkasında yerel çevre birimi olarak çalışan cihazlar.

- [Fiş ve Mutfak Yazıcısı (Termal ESC/POS)](./02-fis-mutfak-yazici.md) — 80 mm termal yazıcılar (Epson TM-T20III LAN, TM-T88VI Ethernet, Star TSP143IIIBI Bluetooth); mali olmayan, köprü-arkası LAN çevre birimi olarak çalışır. (Not: Star modeli yerelde Star Line Mode çalışır, ESC/POS değil.)
- [Para Çekmecesi (Cash Drawer)](./07-para-cekmecesi.md) — AFANDA LB-405K; kendi `Device.kind`'ı olmayan, fiş yazıcısının `cash_drawer` capability'siyle modellenen çekmece (drawer-kick + CashDrawerService sayım/onay akışı).
- [Barkod / QR Okuyucu (Scanner)](./05-barkod-okuyucu.md) — Honeywell Voyager 1450g ve Zebra DS2208 el tipi USB-HID okuyucular; stok/menü/QR akışlarındaki rolü ve host-üzerinden device-mesh provizyonu.
- [Arayan Numara Cihazı (Caller ID)](./06-arayan-numara.md) — Cidshow CID602 2-hat Caller ID; analog hattaki FSK/DTMF sinyalini konnektör aracılığıyla HMAC-imzalı webhook ile HummyTummy'ye iletir (caller eklentisiyle kapılı).

## 4. Ağ (Network)

Yerel çevre birimlerini buluta bağlayan köprü.

- [Network Bridge (HummyBox Lite / Pro)](./08-network-bridge-hummybox.md) — Yerel köprü (`local_bridge`); yalnız giden bağlantı kurar (buluta WSS, LAN yazıcıya raw-TCP 9100), yalnız ESC/POS sürücüsü işlevseldir, 30 günlük bearer token'la `/v1/bridges/claim` üzerinden provizyon edilir.

---

## Ortak Konular

Aşağıdaki başlıklar cihaza özgü değildir; tek ve yetkili kaynak **[00-genel-cerceve](./00-genel-cerceve.md)** dokümanıdır. Her cihaz dokümanı bu bölümlere kısaca değinir, ayrıntı ve nihai politika için 00'a yönlendirir:

- **Garanti / RMA:** B2B (bayi→restoran = tacir/TBK) vs tüketici (6502/TKHK) ayrımı, RMA süreç ve kanalı → 00-genel-cerceve, Bölüm 6–8.
- **AEEE / WEEE (e-atık):** Üretici/ithalatçı kaydı ve EÇBS portalı, güncel AEEE Yönetmeliği → 00-genel-cerceve, regülasyon bölümü.
- **KVKK / PCI-DSS:** Veri sorumlusu/işleyen ayrımı, DPA, VERBİS eşikleri, PCI kapsamı → 00-genel-cerceve, KVKK bölümü.
- **Eşleştirme standardı:** 6 karakterli alfanümerik pairCode (`[A-Z0-9]`, 36⁶), sha256 token, sabit 24 saat cihaz token TTL'i (heartbeat uzatmaz) ve provizyon idempotency → 00-genel-cerceve, ortak kurulum/pairing bölümü.

> **Not:** Bu set provizyonlu tüm cihaz sınıflarını kapsar; kapsama girmeyen "önerilen ekipman" (ör. tartı/metroloji cihazları, restoran çağrı cihazı/pager `RESTAURANT_PAGER`, müşteri ekranı `CUSTOMER_DISPLAY` ve benzeri kodda referanslı ama henüz satılmayan/provizyonlanmayan cihaz tipleri, RECOMMENDED_ONLY tier) ayrıca belgelenmemiştir.

*Son güncelleme: 2026-07-02.*
