# Token/Paygo GMP-3 entegrasyon iş-ortaklığı başvuru e-postası (taslak)

> **Durum:** Sen bir POS/adisyon **yazılım firmasısın**; cihaz senin değil, bir
> **müşterinin** işletmesinde. Token/Paygo ile **ilk kez** muhatap oluyorsun. Bu
> yüzden e-posta bir "kendi cihazım hakkında soru" değil, bir **entegrasyon iş
> ortaklığı başvurusu** — yazılımını Paygo cihazlarıyla uyumlu hale getirip hem
> bu müşteriye hem ileride Paygo kullanan diğer müşterilere hizmet vermek.
>
> **Kime:** Token/Paygo **entegrasyon / iş-ortaklığı masası** (developer/partner).
> Bulamazsan: cihazın geldiği **bankanın ÖKC/entegrasyon birimi** de ikinci bir
> kapı — o müşterinin cihazı hangi bankadan geldiyse oradan da yönlendirme
> isteyebilirsin. `[…]` alanlarını doldur.

---

**Kime:** [Token/Paygo entegrasyon-partner ekibi]
**Konu:** [Firma adı] — Paygo/Token ÖKC'ler için yazılım entegrasyon iş ortaklığı başvurusu (GMP-3)

Merhaba,

Biz **[Firma adı]** olarak restoranlar/işletmeler için **POS ve adisyon
yazılımı** geliştiriyoruz. Yazılımımızı, işletmenin adisyonundan başlattığı
satışı doğrudan **Yeni Nesil ÖKC** üzerinden tamamlayacak (kartı cihaz çeksin +
mali fişi cihaz bassın) şekilde **Paygo/Token cihazlarıyla entegre** etmek
istiyoruz.

Somut vesile: **müşterilerimizden biri** işletmesinde **Paygo SP630PRO ECR**
kullanıyor ve yazılımımızla bu cihaz üzerinden satış yapmak istiyor. Bunu tekil
bir kurulum olarak değil, **Paygo cihazı kullanan tüm müşterilerimize
sunabileceğimiz kalıcı bir entegrasyon** olarak konumlandırmak; yani sizinle
**resmi bir entegrasyon iş ortağı** olarak çalışmak istiyoruz.

Yazılım altyapımız **GMP-3 (GİB Mesajlaşma Protokolü)** üzerinden harici-sistem
entegrasyonuna hazır. İlk kez irtibat kurduğumuz için, hem **iş ortaklığı/
entegrasyon sürecinizi** öğrenmek hem de teknik kaynaklara erişmek istiyoruz.

**1) Süreç hakkında bilgi:**
- Yazılım entegratörü olarak **iş ortaklığı/onboarding süreciniz** nasıl işliyor
  (başvuru, sözleşme, gereksinimler)?
- **Entegrasyon ve sertifikasyon** adımları, tipik **süre** ve varsa **maliyet**.
- Belirli bir müşterinin cihazına bağlanmak için o **işletmenin/bankanın** vermesi
  gereken bir onay/yetkilendirme var mı?

**2) Teknik entegrasyon kaynakları (partner erişimi):**
1. **SP630PRO ECR (ve diğer modelleriniz) için GMP-3 SDK + entegrasyon/mesaj-eşleme
   dokümanı.** Bu cihaz için hangi kütüphaneyi ve hangi dili sağlıyorsunuz
   (Linux SP-nesli GMP-3 kütüphanesi mi, yeni portal SDK'sı — .NET/C++ — mi)?
2. **Bir test/geliştirme cihazı** (veya varsa vendor simülatörü) — sertifikasyonu
   müşterinin canlı cihazını kullanmadan yapmak istiyoruz.
3. **GMP-3 katma-değerli servis aktivasyonu + TSM firma kodu** için gereken
   başvuru/formlar.
4. **Yazılımımız için yazılı eşleşme yetkisi** ("uyumlu hale getirme") — sertifikalı
   eşleşmenin (pairing) önünü açan onay.
5. **PÖKC sertifika zinciri ve handshake parametreleri:** kullanılan port,
   Diffie-Hellman grubu, AES/HMAC şeması, İşlem Sıra No (transaction sequence)
   kuralları.

Uygun olduğunuzda kısa bir görüşme / teknik ekiplerin tanışması için de
memnuniyetle vakit ayırırız.

Şimdiden teşekkürler,

[Ad Soyad] — [Ünvan], [Firma adı]
[Telefon] · [E-posta] · [Web sitesi]
[Firma VKN / Mersis (varsa)]
