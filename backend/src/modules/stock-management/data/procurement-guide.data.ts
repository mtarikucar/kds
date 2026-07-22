// backend/src/modules/stock-management/data/procurement-guide.data.ts
import type { GuideCategory } from '../services/procurement-category.matcher';

export type VolumeTier = 'SMALL_CAFE' | 'MID_RESTAURANT' | 'MULTI_BRANCH';
export type ChannelKey =
  | 'CASH_CARRY' | 'WHOLESALE_MARKET' | 'ONLINE_B2B'
  | 'PRODUCER_COOP' | 'LOCAL_BUTCHER_WHOLESALER' | 'DISTRIBUTOR';

export interface GuideSource { id: string; title: string; publisher: string; url: string; accessedAt: string; }
export interface ChannelAdvice {
  channelKey: ChannelKey;
  rankForTier: Record<VolumeTier, number>; // 1 = best; higher = worse; 0 = not recommended
  advantageNoteKey: string;  // i18n key (stock.json guide.*)
  minOrderNoteKey: string;
  paymentNoteKey: string;
  eInvoiceNoteKey: string;
  sourceIds: string[];
}
export interface CategoryGuide {
  categoryKey: GuideCategory;
  recommendationKeyByTier: Record<VolumeTier, string>; // one-liner i18n key
  channels: ChannelAdvice[];
  ruleKeys: string[]; // 2-3 practical-rule i18n keys
}
export interface ProcurementGuide {
  version: string;
  midTierMonthlySpendTRY: number; // tier threshold: annualized 90d spend ≥ this → MID_RESTAURANT
  categories: CategoryGuide[];
  sources: GuideSource[];
}

// Phase 3 fill — content sourced entirely from
// docs/research/2026-07-22-tr-restaurant-procurement-channels.md (cited, adversarially
// verified). Do not add claims beyond that report; if it lacked category/channel-specific
// evidence, the note falls back to a conservative generic line (see report §6 "Dışarıda
// bırakılanlar" for what was deliberately excluded, e.g. Metro vade/taksit — refuted).

// Channel note keys are channel-generic facts, reused across every category the channel
// appears in (report §2: one profile per channel, not per category).
const noteKeys = (channel: ChannelKey) => ({
  advantageNoteKey: `guide.note.${channel}.advantage`,
  minOrderNoteKey: `guide.note.${channel}.minOrder`,
  paymentNoteKey: `guide.note.${channel}.payment`,
  eInvoiceNoteKey: `guide.note.${channel}.eInvoice`,
});

const recKeys = (categoryKey: GuideCategory): Record<VolumeTier, string> => ({
  SMALL_CAFE: `guide.rec.${categoryKey}.SMALL_CAFE`,
  MID_RESTAURANT: `guide.rec.${categoryKey}.MID_RESTAURANT`,
  MULTI_BRANCH: `guide.rec.${categoryKey}.MULTI_BRANCH`,
});

// Sources: report §7. Ids mirror the report's own [Sn] citation labels for traceability
// (only sources with full title/publisher/url in §7 are encoded here — a few inline
// citations in the report body, e.g. S22-27/S32/S39/S50, lack that metadata and are
// deliberately not turned into standalone entries; their claims are instead backed here
// by the nearest fully-cited source covering the same legal/factual basis).
const SOURCES: GuideSource[] = [
  { id: 's1', title: 'Metro Gastro Servis', publisher: 'Metro Türkiye', url: 'https://www.metro-tr.com/gastroservis', accessedAt: '2026-07-22' },
  { id: 's2', title: 'Bizim Toptan HORECA Ürünleri (indirim örnekleri)', publisher: 'Bizim Toptan', url: 'https://www.bizimtoptan.com.tr/horeca-urunleri', accessedAt: '2026-07-22' },
  { id: 's3', title: 'Sebze ve Meyve Ticareti — Sıkça Sorulan Sorular', publisher: 'T.C. Ticaret Bakanlığı', url: 'https://ticaret.gov.tr/ic-ticaret/sikca-sorulan-sorular/sebze-ve-meyve-ticareti', accessedAt: '2026-07-22' },
  { id: 's12', title: 'TÜİK TÜFE Haziran 2026 — gıda ve alkolsüz içecek yıllık %35,45 artış', publisher: 'TÜİK (alomaliye.com aktarımı)', url: 'https://www.alomaliye.com/2026/07/03/enflasyon-rakamlari-tufe-haziran-2026/', accessedAt: '2026-07-22' },
  { id: 's7', title: 'Tespo İçecek Kategorisi (kademeli/nakit indirim)', publisher: 'Tespo', url: 'https://eticaret.tespo.com.tr/c/icecek', accessedAt: '2026-07-22' },
  { id: 's17', title: 'Metro Türkiye — Sıkça Sorulan Sorular (vergi mükellefi %1 KDV)', publisher: 'Metro Türkiye', url: 'https://www.metro-tr.com/hakkimizda/sss', accessedAt: '2026-07-22' },
  { id: 's18', title: 'Toptancı Hali Yönetmeliği — hal rüsumu oranları (%1/%2)', publisher: 'Mevzuat.gov.tr', url: 'https://mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.16340.pdf', accessedAt: '2026-07-22' },
  { id: 's19', title: 'Sebze ve Meyve Ticareti ve Toptancı Halleri Hakkında Kanun (5957) md. 8', publisher: 'Mevzuat.gov.tr', url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5957.pdf', accessedAt: '2026-07-22' },
  { id: 's20', title: 'Toptancı Halleri — Sıkça Sorulan Sorular', publisher: 'T.C. Ticaret Bakanlığı (hal.gov.tr)', url: 'https://www.hal.gov.tr/Sayfalar/ToptanciHalleriSorular.aspx', accessedAt: '2026-07-22' },
  { id: 's21', title: 'Komisyoncu azami komisyon oranı (%8) — Yönetmelik', publisher: 'Mevzuat.gov.tr', url: 'https://mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.16340.pdf', accessedAt: '2026-07-22' },
  { id: 's28', title: 'Yaş Meyve Sebze Tedarik Zincirinde Fiyat Oluşumu', publisher: 'TCMB', url: 'https://tcmbblog.org/wps/wcm/connect/blog/tr/main+menu/analizler/yas-meyve-sebze-tedarik-zincirinde-fiyat-olusumu', accessedAt: '2026-07-22' },
  { id: 's29', title: 'Onay ve Kayıt Kapsamına Giren Gıda İşletmeleri', publisher: 'T.C. Tarım ve Orman Bakanlığı', url: 'https://www.tarimorman.gov.tr/Konu/1053/Onay-ve-Kayit-Kapsamina-giren-gida-isletmeleri', accessedAt: '2026-07-22' },
  { id: 's30', title: 'Gıda İşletme Kayıt Belgesi Nasıl Alınır (2026 Güncel)', publisher: 'SNG Kalite', url: 'https://www.sngkalite.com.tr/blog/gida-isletme-kayit-belgesi-nasil-alinir-2026-guncel-basvuru-rehberi', accessedAt: '2026-07-22' },
  { id: 's31', title: 'Soğuk Zincir Nedir? Gıda İşletmeleri Saklama Kuralları', publisher: 'Hijyen Akademi', url: 'https://hijyenakademi.net/blog/soguk-zincir-nedir-gida-isletmeleri-saklama-kurallari', accessedAt: '2026-07-22' },
  { id: 's35', title: 'Kesimhanelerde Kamera Sistemi ve Dijital Takip Zorunlu Olacak', publisher: 'Dare Medya', url: 'https://www.daremedya.com/kesimhanelerde-kamera-sistemi-ve-dijital-takip-zorunlu-olacak', accessedAt: '2026-07-22' },
  { id: 's36', title: 'Restoranlarda Satın Alma Yönetimi Nasıl Yapılmalıdır', publisher: 'Narpos', url: 'https://narpos.com.tr/blog/restoranlarda-satin-alma-yonetimi-nasil-yapilmalidir/221', accessedAt: '2026-07-22' },
  { id: 's38', title: 'Bonservis (Esas Holding) Profili', publisher: 'ACK Food Solutions', url: 'https://ackfoodsolutions.com/bonservis/', accessedAt: '2026-07-22' },
  { id: 's40', title: 'Toptanmarketi.com', publisher: 'Toptanmarketi', url: 'https://toptanmarketi.com/', accessedAt: '2026-07-22' },
  { id: 's41', title: 'Bidfood Türkiye', publisher: 'Bidfood (Bidcorp)', url: 'https://www.bidfood.com.tr/bidfood-turkey?lang=tr', accessedAt: '2026-07-22' },
  { id: 's43', title: 'Bidfood Müşteri Segmentleri', publisher: 'Bidfood (Bidcorp)', url: 'https://www.bidfood.com.tr/custommers?lang=tr', accessedAt: '2026-07-22' },
  { id: 's43b', title: 'Çok Şubeli Restoranlarda Stok ve Maliyet Kontrolü', publisher: 'RobotPOS', url: 'https://www.robotpos.com/blog_new/cok-subeli-restoran-stok-maliyet-kontrolu', accessedAt: '2026-07-22' },
  { id: 's46', title: "STAH'tan TÜRES Üyelerine Özel Hijyen Kampanyası", publisher: 'TÜRES', url: 'https://tures.org.tr/guncel/uyelik-avantajlari/stahtan-tures-uyelerine-ozel-hijyen-kampanyasi', accessedAt: '2026-07-22' },
  { id: 's51', title: 'Otel/Restoran İçin Toptan Temizlik ve Ambalaj Ürünleri', publisher: 'Detay Global', url: 'https://www.detayglobal.com.tr/blog/icerik/otel-restoran-toptan-temizlik-urunleri', accessedAt: '2026-07-22' },
  { id: 's52', title: 'Ünallar Tedarik Market', publisher: 'Ünallar Tedarik', url: 'https://www.unallartedarik.com/', accessedAt: '2026-07-22' },
  { id: 's55', title: 'Karton Bardak Maliyeti', publisher: 'Mottocup', url: 'https://mottocup.com/blog/karton-bardak-maliyeti/', accessedAt: '2026-07-22' },
  { id: 's58', title: 'Katma Değer Vergisi Oranları', publisher: 'Özdoğrular', url: 'https://www.ozdogrular.com.tr/v1/önemli-bilgiler/item/16043-katma-değer-vergisi-oranları_08-09-25', accessedAt: '2026-07-22' },
  { id: 's61', title: 'e-Fatura Kayıtlı Kullanıcılar Sorgulama', publisher: 'GİB (Gelir İdaresi Başkanlığı)', url: 'https://ebelge.gib.gov.tr/efaturakayitlikullanicilar.html', accessedAt: '2026-07-22' },
];

export const PROCUREMENT_GUIDE: ProcurementGuide = {
  version: '2026-07-22.v1',
  midTierMonthlySpendTRY: 150000,
  sources: SOURCES,
  categories: [
    {
      // Report §2.3, §5 row 1: local butcher/wholesaler for trust+flexibility (small),
      // approved distributor contract for volume (mid/multi), cash&carry only for frozen.
      categoryKey: 'MEAT',
      recommendationKeyByTier: recKeys('MEAT'),
      channels: [
        { channelKey: 'LOCAL_BUTCHER_WHOLESALER', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 2, MULTI_BRANCH: 2 }, ...noteKeys('LOCAL_BUTCHER_WHOLESALER'), sourceIds: ['s29', 's30', 's31', 's36'] },
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 2, MID_RESTAURANT: 0, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s2', 's7', 's61'] },
        { channelKey: 'DISTRIBUTOR', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 1, MULTI_BRANCH: 1 }, ...noteKeys('DISTRIBUTOR'), sourceIds: ['s12', 's29', 's31', 's35', 's36', 's43', 's43b', 's61'] },
      ],
      ruleKeys: ['guide.rule.MEAT.1', 'guide.rule.MEAT.2', 'guide.rule.MEAT.3'],
    },
    {
      // Report §2.2, §5 row 2: local greengrocer/hal broker (small), hal spot+planned (mid),
      // producer co-op — fully rüsum-exempt — for high fresh-produce volume (multi).
      categoryKey: 'PRODUCE',
      recommendationKeyByTier: recKeys('PRODUCE'),
      channels: [
        { channelKey: 'WHOLESALE_MARKET', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 1, MULTI_BRANCH: 2 }, ...noteKeys('WHOLESALE_MARKET'), sourceIds: ['s3', 's18', 's19', 's20', 's21'] },
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 2, MID_RESTAURANT: 0, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s2', 's61'] },
        { channelKey: 'PRODUCER_COOP', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 0, MULTI_BRANCH: 1 }, ...noteKeys('PRODUCER_COOP'), sourceIds: ['s3', 's18', 's19', 's28'] },
      ],
      ruleKeys: ['guide.rule.PRODUCE.1', 'guide.rule.PRODUCE.2', 'guide.rule.PRODUCE.3'],
    },
    {
      // Report §2.1, §5 row 3: cash&carry is the default for dry/ambient goods at every
      // tier below multi-branch; online B2B complements it; multi-branch centralizes.
      categoryKey: 'DRY_GOODS',
      recommendationKeyByTier: recKeys('DRY_GOODS'),
      channels: [
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 1, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s1', 's2', 's7', 's17', 's61'] },
        { channelKey: 'ONLINE_B2B', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 2, MULTI_BRANCH: 2 }, ...noteKeys('ONLINE_B2B'), sourceIds: ['s40', 's41', 's43', 's61'] },
        { channelKey: 'DISTRIBUTOR', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 0, MULTI_BRANCH: 1 }, ...noteKeys('DISTRIBUTOR'), sourceIds: ['s12', 's43', 's43b', 's61'] },
      ],
      ruleKeys: ['guide.rule.DRY_GOODS.1', 'guide.rule.DRY_GOODS.2', 'guide.rule.DRY_GOODS.3'],
    },
    {
      // Report §2.3, §5 row 4: cash&carry + local distributor (small), approved cold-chain
      // dairy distributor contract (mid), regional distributor framework (multi).
      categoryKey: 'DAIRY',
      recommendationKeyByTier: recKeys('DAIRY'),
      channels: [
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 0, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s2', 's61'] },
        { channelKey: 'DISTRIBUTOR', rankForTier: { SMALL_CAFE: 2, MID_RESTAURANT: 1, MULTI_BRANCH: 1 }, ...noteKeys('DISTRIBUTOR'), sourceIds: ['s12', 's31', 's36', 's43', 's61'] },
      ],
      ruleKeys: ['guide.rule.DAIRY.1', 'guide.rule.DAIRY.2', 'guide.rule.DAIRY.3'],
    },
    {
      // Report §2.1, §4, §5 row 5: cash&carry cash-discount (small), brand distributor deal
      // + cash&carry (mid — Metro Gastro Servis reaches this tier), brand distributor
      // central agreement (multi).
      categoryKey: 'BEVERAGE',
      recommendationKeyByTier: recKeys('BEVERAGE'),
      channels: [
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 2, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s1', 's2', 's7', 's17', 's61'] },
        { channelKey: 'DISTRIBUTOR', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 1, MULTI_BRANCH: 1 }, ...noteKeys('DISTRIBUTOR'), sourceIds: ['s12', 's43', 's58', 's61'] },
      ],
      ruleKeys: ['guide.rule.BEVERAGE.1', 'guide.rule.BEVERAGE.2', 'guide.rule.BEVERAGE.3'],
    },
    {
      // Report §3, §5 row 6: cash&carry (small), specialist wholesaler (Detay/Ünallar) +
      // online B2B (mid), specialist-wholesaler framework + central (multi) — long shelf
      // life makes bulk/framework buying the clear win here.
      categoryKey: 'PACKAGING',
      recommendationKeyByTier: recKeys('PACKAGING'),
      channels: [
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 0, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s2', 's61'] },
        { channelKey: 'DISTRIBUTOR', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 1, MULTI_BRANCH: 1 }, ...noteKeys('DISTRIBUTOR'), sourceIds: ['s12', 's43', 's51', 's52', 's55', 's61'] },
        { channelKey: 'ONLINE_B2B', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 2, MULTI_BRANCH: 0 }, ...noteKeys('ONLINE_B2B'), sourceIds: ['s38', 's41', 's61'] },
      ],
      ruleKeys: ['guide.rule.PACKAGING.1', 'guide.rule.PACKAGING.2', 'guide.rule.PACKAGING.3'],
    },
    {
      // Report §3, §5 row 7: cash&carry (small), specialist wholesaler + trade-association
      // member campaigns e.g. TÜRES (mid), single specialist supplier for all branches (multi).
      categoryKey: 'CLEANING',
      recommendationKeyByTier: recKeys('CLEANING'),
      channels: [
        { channelKey: 'CASH_CARRY', rankForTier: { SMALL_CAFE: 1, MID_RESTAURANT: 0, MULTI_BRANCH: 0 }, ...noteKeys('CASH_CARRY'), sourceIds: ['s2', 's61'] },
        { channelKey: 'DISTRIBUTOR', rankForTier: { SMALL_CAFE: 0, MID_RESTAURANT: 1, MULTI_BRANCH: 1 }, ...noteKeys('DISTRIBUTOR'), sourceIds: ['s12', 's43', 's46', 's51', 's61'] },
      ],
      ruleKeys: ['guide.rule.CLEANING.1', 'guide.rule.CLEANING.2', 'guide.rule.CLEANING.3'],
    },
  ],
};
