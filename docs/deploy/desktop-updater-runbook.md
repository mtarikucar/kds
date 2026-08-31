# Masaüstü otomatik güncelleme — runbook

Bu belge, masaüstü sürüm hattını devralan kişinin bilmesi gerekenleri tutar.
Buradaki bilgiler bir oturumdan devralındı ve ilgili kısımları doğrulandı;
neyin doğrulandığı aşağıda ayrıca yazıyor.

## Anahtar nerede — en kırılgan varlık

    ~/.tauri/kds-updater.key           (600)  imzalama anahtarı
    ~/.tauri/kds-updater.key.password  (600)  parolası
    ~/.tauri/kds-updater.key.pub       (600)  genel anahtar

Genel anahtar kimliği **`B20B4E3FB1B46583`** ve aynısı
`frontend/src-tauri/tauri.conf.json` içine gömülüdür.

**Doğrulandı (2026-08-31):** diskteki `.pub` dosyası ile `tauri.conf.json`
içindeki `pubkey` **bayt-aynı**, ikisi de aynı anahtar kimliğini taşıyor.

**Bu dosyaların başka okunabilir kopyası yoktur.** GitHub secret'ları
(`TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`) yazılabilir ama geri okunamaz.
`~/.tauri/` silinirse anahtar kaybolur; rotasyon şart olur ve eski genel
anahtarı gömülü taşıyan **her kurulum elle güncellenmek zorunda kalır** —
otomatik güncelleme onları taşıyamaz. Bu dizini yedekleyin.

## Rotasyon

Yeni çift üretilirse **secret'lar ve `tauri.conf.json` içindeki pubkey aynı
anda** güncellenmelidir. Yalnız birini değiştirmek, bundler'ın
"secret key does not match the public key" uyarısını doğurur ve istemci
güncellemeyi reddeder — sistemin yıllarca sessizce kırık kalmasının sebebi
tam olarak buydu.

## Tauri v2 gerçeği

Kurulum dosyasının **kendisi** güncelleyici artefaktıdır; imza onun yanına
`<installer>.sig` olarak yazılır. Tauri v1'in `.msi.zip` /
`.AppImage.tar.gz` adları **hiç üretilmez**. Workflow uzun süre onları
aradı, bulamadı ve "imzalama yapılandırılmamış" dalına düşerek her sürümü
imzasız yayınladı — üstelik yeşil raporlayarak.

## Doğrulama neden SSH ile yapılıyor

`Verify Release` işi güncelleme manifestini **prod loopback'ine SSH ile**
sorar, genel uca değil. Sebep: Cloudflare, GitHub runner'ına bot kontrolü
sayfası döndürüyor. Genel uçtan `curl` atarsanız sürümü değil WAF'ı
ölçersiniz — sağlam bir sürümü "kırık" raporlar.

Bu, aynı sınıftan başka bir tuzakla akrabadır: bot kontrolü sayfası
**200 + HTML**, kurumsal içerik filtresi **403 + HTML** döner. Durum koduna
bakan her kontrol sessizce yanlış cevap verir. Gövdeyi ayrıştırın.

## Bugünkü garantiler

- İmzalama anahtarı tanımlıyken imza üretilmezse iş **hata verir** (eskiden
  uyarı geçip devam ediyordu).
- `Verify Release` imzalı manifest görmezse sürümü **durdurur**.
- Doğrulandı: v3.16.1 ve v3.16.2 sürümlerinde `Verify Release` yeşil.

## Sürüm nasıl çıkar

`v*.*.*` etiketi iki workflow'u birden tetikler: `Release Deployment`
(backend/frontend/landing/help/developer) ve `Desktop App Release`.
Etiket main'in ucunda olmalı; annotated ve Türkçe gövdeli yazılır
(önceki etiketlere bakın).

## Artık kullanılmayan secret'lar

`TAURI_SIGNING_PRIVATE_KEY*` (2026-06-14) repoda duruyor ama kullanılmıyor.
Silinebilir; devreden oturum dokunmamıştı.
