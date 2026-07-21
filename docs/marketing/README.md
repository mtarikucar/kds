# Pazar Araştırmaları — Genişleme & Rekabet

Bu klasör, **yeni pazarlara açılma** (market expansion) ve **rekabet** analizi araştırmalarını tek yerde
toplar. Her benchmark, paralel **çok-ajanlı web araştırması + iddia-iddia çürütücü doğrulama** ile
üretildi; kaynaklar ve güven-seviyeleri her belgenin içinde satır satır işaretlidir. İleride incelemek
ve genişletmek için buradadır — kaybolmasın.

> Not: Ülke benchmark'ları **İngilizce** yazıldı (Türk geliştirme ekibi + yerel ülke-partneri ortak dili);
> bu index ve rakip-parite envanteri Türkçe. Durumlar plandır — **hiçbiri kod değildir**, uygulama
> kullanıcı onayına bağlıdır.

## İçindekiler

| Belge | Konu | Durum | Dil |
|---|---|---|---|
| [MARKET_EXPANSION_SCAN.md](./MARKET_EXPANSION_SCAN.md) | **14 ülke** "taze fiskal-fiş zorunluluğu = zorunlu satın alma anı" taraması; puanlı/tier'li sıralama; **Kırgızistan = UZ'den sonra en iyi ilk hamle**; barbell strateji (KG→KZ→Mısır→Ürdün) | 📋 Strateji girdisi | EN |
| [uzbekistan/UZ_EXPANSION_BENCHMARK.md](./uzbekistan/UZ_EXPANSION_BENCHMARK.md) | **Özbekistan** tam-sistem entegrasyon benchmark'ı: fiskalizasyon (OFD/UzQR), yerel ödeme (Payme/Click/Uzum), e-fatura (ЭСФ), veri-yerelleştirme, UZS/dil; dosya-seviyesi kod haritası + scorecard | 📋 DRAFT (review bekliyor) | EN |
| [kyrgyzstan/KG_EXPANSION_BENCHMARK.md](./kyrgyzstan/KG_EXPANSION_BENCHMARK.md) | **Kırgızistan** benchmark'ı (**UZ'den delta**): ФПО (POS=fiskal yazılım), çift vergi НДС+НсП, ELQR tek-QR, ЭСФ bearer-token, veri-yerelleştirme YOK, Kırgızca-Kiril locale; reuse haritası + scorecard | 📋 DRAFT (review bekliyor) | EN |
| [adisyo-parity-inventory.md](./adisyo-parity-inventory.md) | **adisyo** rakip-paritesi: tüm sayfa/modül taksonomisi + HummyTummy'nin gerçekten sunabildiği her şeyin durumu | 📋 Envanter | TR |

## Kilit stratejik sonuç (tarama özeti)

Tez doğru: **yeni çıkan bir fiş/fiskalizasyon zorunluluğu = "zorunlu satın alma anı"**. Ama doğrulama
gösterdi ki çoğu CIS/Balkan penceresi 2019–2022'de **kapandı** (refresh pazarı). *Taze-mandate × UZ-kod-
tekrarı* ekseninde **sadece Kırgızistan iki kadranda birden**. Önerilen sıra (barbell):

1. **Kırgızistan** — en ucuz ikinci deployment (~%70-80 UZ kod-tekrarı), canlı ГНС restoran-icra motoru
2. **Kazakistan** — aynı kod ailesi, 2026 refresh penceresi, en büyük yüksek-tekrar pazar
3. **Mısır** — en taze zorunlu B2C e-fiş, AR locale hazır (orta tekrar)
4. **Ürdün** — JoFotara 2025-04 zorunlu, AR+EN + Türkiye/Nilvera UBL builder tekrarı

**Kaçın/dikkat:** Gürcistan (2027 taze ama tek-devlet-tedarikçi tekeli), Suudi (pencere kapandı), BAE
(B2C hariç, fiş-mandate yok), Romanya (dine-in <€100 muaf). Detay için `MARKET_EXPANSION_SCAN.md`.

## Durum lejantı & açık kalemler

- 📋 = plan/araştırma (kod yok). Uygulama kullanıcı onayına bağlı.
- **UZ benchmark:** kararlar kilitli (ayrı ülke-içi region + yerel partner/reseller + full-parity MVP).
- **KG benchmark:** fiscal/ödeme/hukuk boyutlarının çürütücü-doğrulama pass'i session-limit'te kesildi →
  belgede **⚠** ile işaretli; go-live öncesi yeniden doğrulanmalı.
- Sıradaki mantıklı adım: **Kazakistan benchmark'ı** (barbell #2) veya KG'nin en zor parçası **НсП çift-
  vergi rayı** için implementasyon planı.

## Yöntem

Belgeler; fiskalizasyon/ödeme/e-fatura/hukuk/currency/pazar boyutlarında paralel araştırma ajanları
(EN/RU/UZ/KY/AR birincil kaynaklar: tax-authority portalları, sağlayıcı geliştirici dokümanları, Big-4/
VATupdate ülke kılavuzları, yerel medya) + yüksek-riskli iddiaların çürütücü doğrulaması ile üretildi.
Ham bulgular ve kaynak URL'leri belgelerin gövdesindeki tablolarda; güven-seviyeleri (high/medium/low)
satır bazında işaretli.
