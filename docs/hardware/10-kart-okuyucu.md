# RFID Personel Kart Okuyucu (USB HID)

> Bu belge, HummyTummy KDS/POS platformunda **Kartlı Vardiya** modülü
> (`module_personnel_card_shift`, ₺4.000 tek seferlik) ile birlikte satılan
> **13.56 MHz Mifare USB HID personel kart okuyucusu** için restoran
> operatörüne ve kurulumu yapan bayiye yönelik kullanım ve uyumluluk
> yönergesidir. Katalog SKU'su: `card-reader-rfid-usb-hid`.
>
> Fiyat, garanti süresi ve tedarik bilgileri **satış öncesi güncel resmi
> kaynaktan doğrulanmalıdır**.

---

## 1. Genel bakış

Cihaz, personel kartındaki 13.56 MHz (ISO/IEC 14443-A, Mifare) etiketin
benzersiz kimliğini (UID) okur ve **USB HID klavye emülasyonu** ile host'a
"yazar": kart okutulduğunda, o an odakta olan alana UID yazılır ve ardından
Enter gönderilir. **Sürücü kurulumu gerekmez**; işletim sistemi cihazı klavye
olarak görür.

**Sistemdeki rolü:** Kartlı Vardiya istasyon ekranı (`/card-shift`) görünmez
ama daima odaklı bir alan tutar; okuyucunun yazdığı UID doğrudan
`POST /personnel/attendance/card-tap` isteğine gider. Sunucu UID'yi düz metin
saklamaz — normalize eder ve peppered HMAC'ini yazar.

**Bu cihaz mali bir cihaz DEĞİLDİR.** Yazarkasa/ÖKC mevzuatı kapsamında
değildir, fiş kesmez, GİB'e bağlanmaz; yalnızca personel devam kaydı üretir.

## 2. Paket içeriği ve teknik özellikler

| Özellik | Değer |
|---|---|
| SKU | `card-reader-rfid-usb-hid` |
| Katalog fiyatı | ₺1.290 (KDV dahil, gösterge açılış fiyatı; superadmin panelinden düzenlenebilir) |
| Paket | 1 × masaüstü okuyucu + 10 × Mifare personel kartı |
| Frekans / standart | 13.56 MHz, ISO/IEC 14443-A (Mifare Classic/NTAG) |
| Host arayüzü | USB Tip-A, HID klavye emülasyonu (sürücüsüz) |
| Çıktı | Kart UID'si + Enter |
| Okuma mesafesi | ~2–5 cm (temassız, temas gerektirmez) |
| Besleme | USB üzerinden (harici adaptör yok) |
| Garanti | 12 ay (üretici/bayi taahhüdü) |

## 3. Kurulum

1. Okuyucuyu istasyon tabletinin/PC'sinin USB portuna tak. Sürücü kurulumu
   yoktur; cihaz birkaç saniye içinde klavye olarak tanınır.
2. Tarayıcıda **Kartlı Vardiya** istasyon ekranını aç: sol menü → **Kartlı
   Vardiya**, ya da Ekip → Kartlı Vardiya sekmesindeki "İstasyon ekranını aç".
3. Bir kartı okut. Ekranda "Kart tanınmadı" görünüyorsa cihaz doğru çalışıyor
   demektir — kart henüz bir personele atanmamıştır.
4. Kartları ata: **Ekip → Kartlı Vardiya** sekmesinde personelin satırındaki
   "Kart ata"ya bas, alan odaklanınca kartı okut. Tablo yalnız kartın **son 4
   hanesini** gösterir.

## 4. Günlük kullanım

- **İlk okutma** günün girişini damgalar, **ikinci okutma** çıkışını.
- Personel molada ise okutma **molayı bitirir**. Mola **başlatma** uygulama
  içinden yapılır: kiosk "molaya çıkıyorum" ile "eve gidiyorum"u ayırt edemez.
- Aynı kart 10 saniye içinde iki kez okutulursa ikincisi **yok sayılır**
  (bazı okuyucular tek okutmada iki kez yazar).

## 5. Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Kart okutunca hiçbir şey olmuyor | İstasyon ekranındaki gizli alan odakta değil | Ekrana bir kez dokun; alan otomatik yeniden odaklanır |
| Ekranda "Kart tanınmadı" | Kart hiçbir personele atanmamış veya personel pasif | Ekip → Kartlı Vardiya'dan kartı ata / personeli aktifleştir |
| Ekranda "Bugün çıkış yapılmış" | Aynı gün zaten giriş **ve** çıkış damgalanmış | Düzeltme gerekiyorsa yönetici puantaj kaydını elden düzenler |
| UID her okutmada farklı yazılıyor | Okuyucu rastgele UID (RID) veren kart okuyor | Sabit UID'li Mifare kart kullan (pakette gelen kartlar sabittir) |
| Menü'de "Kartlı Vardiya" görünmüyor | Modül alınmamış veya lisans sönmüş | Mağaza → Kartlı Vardiya; lisans aktif olmalı |

## 6. Güvenlik notu

Kart, bir **devam kaydı** anahtarıdır; kasa veya kapı erişimi değildir. 13.56
MHz Mifare kartlar kopyalanabilir — riski "arkadaşına kartını verip
damgalatma" düzeyindedir ve bu manuel damgalamada da vardır. Kartlı damgalama
bir **güvenlik kontrolü olarak pazarlanmaz**.

Kart numarası sistemde **düz metin saklanmaz**; yalnızca kiracıya özel bir
HMAC'i ve son 4 hanesi tutulur. Kart iptal edildiğinde geçmiş puantaj kayıtları
silinmez.

## 7. Satış ve devreye alma kontrol listesi

- [ ] Müşteride **Personel Yönetimi** modülü ve **aktif lisans** var mı?
- [ ] **Kartlı Vardiya** modülü satın alındı mı (₺4.000, tek seferlik)?
- [ ] Okuyucu paketi kargolandı mı (okuyucu + 10 kart)?
- [ ] İstasyon cihazı belirlendi mi (tablet/PC) ve tarayıcıda `/card-shift`
      açıldı mı?
- [ ] Tüm personele kart atandı mı, her biri bir kez test okutuldu mu?
- [ ] Müşteriye "tek seferlik ödeme, ama lisans sönerse erişim kapanır"
      açıkça söylendi mi?
