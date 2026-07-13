# KDS — Dış Entegrasyon / Satın Alma / İşbirliği Checklist

> ✅ = yapıldı (kanıt: prod canlı + Secrets.md kayıtları) · ⚠ = kısmen/teyit gerek · 🔄 = başlatıldı/cevap bekleniyor · ☐ = yapılmadı
> Güncelleme: 2026-07-13

**Durum: 15 / 68 tamam** (+ 8 madde 🔄 başlatıldı)

## 1 · Altyapı & Güvenlik — 7/7 ✅
- [x] 1. VPS sunucu (Contabo) + SSH deploy anahtarı *(prod canlı, CI SSH ile deploy ediyor)*
- [x] 2. Alan adı + DNS + TLS sertifikası *(hummytummy.com + api. canlı; Cloudflare kaydı Secrets.md §11)*
- [x] 3. PostgreSQL 15 *(çalışıyor — ⚠ yedekleme düzenini teyit et)*
- [x] 4. Redis 7 *(çalışıyor, boot şartı)*
- [x] 5. SMTP e-posta hesabı (GoDaddy/Titan) *(Secrets.md §10; alarm mailleri çalışıyor)*
- [x] 6. Kripto secret'ları (JWT ×4, ENCRYPTION_MASTER_KEY, INTEGRATION_KEY, IP_HASH_SALT) *(boot-blocking → prod açık = set)*
- [x] 7. GitHub + GHCR container registry *(CI build + push + deploy çalışıyor)*

## 2 · Ödeme — 5/7
- [x] 8. PayTR üye işyeri hesabı + API bilgileri *(⚠ prod boot kanıtı; bir test ödemesiyle canlı tahsilatı teyit et)*
- [x] 9. PayTR canlı mod aktivasyonu *(PAYTR_TEST_MODE=0 boot şartı → set)*
- [x] 10. PayTR bildirim (webhook) URL + IP allowlist
- [x] 11. PayTR return (OK/FAIL) sayfaları *(prod'da zorunlu → set)*
- [ ] 12. 🔄 PayTR tekrarlayan ödeme / kart saklama yetkisi *(yetki talebi PayTR'ye GÖNDERİLDİ 13 Tem; yetki gelince kod: utoken yakalama + renewal cron — adaptör hazır)*
- [x] 13. Havale/EFT için şirket banka hesabı *(superadmin'e IBAN girildi + etkin, 13 Tem)*
- [ ] 14. Banka/acquirer POS entegrasyonu + PCI (veya SoftPOS PSP) — fiziksel kart terminali **(B2)**

## 3 · e-Belge (GİB) — 0/6 (zincir 🔄 başlatıldı — karar: **NİLVERA** primary, Foriba/Sovos yedek)
- [ ] 15. 🔄 Özel entegratör sözleşmesi *(karar: NİLVERA — kod primary-adaptör PR #298/v3.2.115; talep GÖNDERİLDİ 13 Tem: destek@nilvera.com + yedek Foriba/Sovos isortagim@digitalplanet.com.tr; cevap bekleniyor)*
- [ ] 16. Entegratör API kimlik bilgileri → Muhasebe → Ayarlar *(kod hazır: Nilvera apiUrl+apiKey alanları şifreli kayıtla; creds #15'ten gelecek — rehber: docs/tedarik/hazir-form-doldurma-rehberi.md)*
- [ ] 17. Mali mühür / e-imza *(DÜZELTME: şahıs işletmesi için mali mühür ŞART DEĞİL, e-imza yeterli — GİB kuralı; entegratör faturaları kendi mührüyle imzalar. Nilvera'nın "aktivasyon için ne gerekli" cevabına göre e-imza/mühür alınacak — soru mailde soruldu)*
- [ ] 18. GİB e-Arşiv kaydı *(GİB'e AYRI başvuru YOK — entegratör senin adına aktive eder (HR.xml); belgeler: vergi levhası + kimlik + imzalı sözleşme)*
- [ ] 19. GİB e-Fatura mükellef kaydı *(Nilvera aktivasyon linki gönderir → kendi e-imzanla imzalarsın. Zorunluluk: 2025 ciro ≥3M ise 1 Tem 2026; altındaysa GÖNÜLLÜ)*
- [ ] 20. Mükellef sorgu API erişimi *(KOD TAMAM: Nilvera GlobalCompany/Check v3.2.115'te; erişim #16 creds ile otomatik açılır)*

## 4 · ÖKC / Mali Fiş — 0/6 (Paygo hattı 🔄 — **Perşembe 16 Tem ÖS Teams toplantısı**)
- [ ] 21. 🔄 GMP-3 ÖKC sertifikası + Token/Paygo SDK **(B1)** *(Paygo Uğur ÖZDEŞ toplantı önerdi; Perşembe ÖS cevabı gönderildi 13 Tem — gündem: SDK + mesaj-eşleme dok)*
- [ ] 22. Hugin NDA'lı seri protokol/SDK **(B3)** *(taslak hazır: docs/tedarik/dis-talep-taslaklari.md — Paygo netleşince gerekirse)*
- [ ] 23. Beko/Token NDA'lı seri protokol/SDK **(B3)** *(taslak hazır; #21 Token başvurusu bunu kısmen kapsayabilir)*
- [ ] 24. 🔄 Sertifikalı SP630PRO test ünitesi + TSM firma kodu **(B4)** *(Perşembe toplantı gündeminde)*
- [ ] 25. GİB-yetkili ÖKC bayi anlaşması **(B9)** *(toplantıda sorulacak)*
- [ ] 26. GİB YN ÖKC kaydı + cihaz aktivasyonu
> Kod tarafı: legacy `okc` modülü emekli edildi → tek ray `fiscal-core` (PR #297).

## 5 · Paket Servis Platformları — 0/5
- [ ] 27. Yemeksepeti satıcı hesabı + entegrasyon onayı
- [ ] 28. Getir Yemek partner hesabı + API erişimi
- [ ] 29. Trendyol Yemek (GO) partner hesabı + API erişimi
- [ ] 30. Migros Yemek partner hesabı + API erişimi *(+ marketplace add-on tanımı)*
- [ ] 31. Webhook imzalama sırları — env'e ELLE (Yemeksepeti + Trendyol)

## 6 · Bildirim / İletişim — 1/5
- [x] 32. NetGSM hesabı *(Secrets.md §2 — ⚠ onaylı gönderici başlığını [MSGHEADER] teyit et)*
- [ ] 33. Twilio hesabı (uluslararası SMS yedek)
- [ ] 34. İYS / BTK ticari ileti kaydı (pazarlama SMS öncesi)
- [ ] 35. E-posta domaini SPF/DKIM/DMARC kayıtları *(teyit et)*
- [ ] 36. Caller-ID konnektör yazılımı + analog PSTN hat + CLIP

## 7 · Donanım Tedarik — 0/17
- [ ] 37. Hugin yetkili bayi (Tiger T300)
- [ ] 38. Beko/Token yetkili bayi (300TR)
- [ ] 39. Token/Paygo bayi (SP630PRO)
- [ ] 40. Ingenico/Interpay bayi + banka üye işyeri sözleşmesi
- [ ] 41. Epson Türkiye distribütörü (fiş yazıcıları)
- [ ] 42. Star Micronics distribütörü — Meltas
- [ ] 43. Sunmi TR distribütörü — Noyatech (KDS ekran) **(B8)**
- [ ] 44. PENETEK doğrudan OEM (panel PC)
- [ ] 45. Sunmi TR distribütörü — Desnet (el terminali)
- [ ] 46. Samsung yetkili bayi (tablet)
- [ ] 47. Honeywell AIDC distribütörü — Akbarkod
- [ ] 48. Zebra distribütörü — Trendbarkod
- [ ] 49. Cidshow CID602 TR ithalatçı
- [ ] 50. AFANDA para çekmecesi toptan tedarik
- [ ] 51. HummyBox ODM/fason üretici + CE/AEEE/GEKAP/TAREKS **(B5)**
- [ ] 52. RTSP/ONVIF kamera + Jetson Orin (CV edge) **(B10)**
- [ ] 53. Cihaz uyumluluk belgeleri (garanti, CE, TR kılavuz, servis, iade)

## 8 · Masaüstü / Yazılım Sertifikaları — 0/2
- [ ] 54. Windows code-signing sertifikası **(B7)**
- [ ] 55. Apple Developer + notarization + Mac donanım **(B6)**

## 9 · Opsiyonel Servisler — 2/7
- [ ] 56. Google Cloud OAuth (Google ile giriş)
- [x] 57. Sentry hesabı *(release pipeline'da Sentry job'ı çalışıyor)*
- [ ] 58. Anthropic API (menü OCR)
- [x] 59. fal.ai API *(Secrets.md §10b — marketing için alınmış; KDS menü-AI aynı hesabı kullanabilir)*
- [ ] 60. Meshy API (3D menü)
- [ ] 61. AWS + KMS (env-KMS'ten geçiş istenirse)
- [ ] 62. ~~Stripe / iyzico~~ **ŞU AN ALMA — kod yok**

## 10 · Veri / AI — 0/1
- [ ] 63. Etiketli veri seti + YOLOv8 eğitim (kamera/CV) **(B10)**

## 11 · İnsan Gücü / Operasyon — 0/5
- [ ] 64. Saha kurulum teknisyeni ekibi
- [ ] 65. Eğitmen (4h/8h personel eğitimi)
- [ ] 66. Delivery + e-Fatura entegrasyon kurulum ekibi
- [ ] 67. Havale mutabakat + destek hattı (Priority Support SLA)
- [ ] 68. HummyBox depo/RMA operasyonu

---

## Sıradaki 5 öncelik (2026-07-13 itibarıyla)
1. 🔄 **#15 cevabı** Nilvera dönünce: sandbox creds → #16 Ayarlar'a gir → #20 otomatik açılır → uçtan uca sandbox faturası
2. 🔄 **#21/#24** Perşembe (16 Tem) ÖS Paygo Teams toplantısı — 5 teslimat: SDK+mesaj-eşleme, test cihazı, TSM firma kodu, pairing yetkisi, PÖKC cert+handshake parametreleri
3. ☐ **#17** Nilvera'nın imza cevabına göre e-imza (muhtemelen) siparişi — mali mühür değil
4. ☐ **#8 teyidi** PayTR canlı test ödemesi yap
5. ☐ **#31** Kullanılan delivery platformlarının webhook sırlarını env'e ekle

### Bugün yapılanlar (2026-07-13)
- ✅ #13 IBAN superadmin'e girildi · ✅ #12 PayTR yetki talebi gönderildi (kullanıcı)
- 📨 #15 Nilvera + Foriba/Sovos talepleri gönderildi (admin@hummytummy.com; CC software@)
- 📨 #21 Paygo'ya Perşembe-ÖS toplantı cevabı gönderildi (Uğur ÖZDEŞ, Teams)
- 🔧 Kod: okc→fiscal-core konsolidasyonu (PR #297) · Nilvera adaptörü main'de (PR #298, v3.2.115)
- 📝 #17/#18/#19 süreç doğrulaması: e-imza yeterli; e-Arşiv'de GİB'e ayrı başvuru yok; e-Fatura aktivasyon-linki modeli
