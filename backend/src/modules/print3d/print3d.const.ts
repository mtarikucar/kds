/**
 * 3D baskı figür hizmetinin tek doğruluk kaynağı — SKU'lar, fiyat sabitleri,
 * durum sözlükleri, üretim ortağı kimliği.
 *
 * Bu dosya HİÇBİR ŞEY IMPORT ETMEZ (entitlement-keys.const.ts deseni): hem
 * quote/checkout hem migration sürüklenme testi hem de tohum aynı değerleri
 * okur, ve bir import döngüsü bu üçlünün herhangi birini kırar.
 *
 * FİYAT SABİTLERİ YALNIZCA tohum/migration kaynağı ve sürüklenme testi
 * içindir. QuoteService fiyatı HER ZAMAN hardware_products satırından okur —
 * yoksa her fiyat değişikliği bir deploy isterdi.
 */

/** hardware_products.serviceMeta.serviceType değeri. */
export const PRINT3D_SERVICE_TYPE = "print3d";

/** Print3dJob.partner kolonunun bugünkü tek değeri. */
export const PRINT3D_PARTNER = "figurunica";

/** Kullanıcıya gösterilen ortak adı. Çeviri edilmez — bu bir marka. */
export const PRINT3D_PARTNER_LABEL = "Figurunica";

/**
 * Varsayılan ortak sitesi. Aynı adlı OPSİYONEL backend env değişkeni
 * (PRINT3D_PARTNER_URL) bunu ezebilir: ticari taraf değişirse yeniden
 * derleme gerekmesin. VITE_ değişkeni bundle'a gömülür ve platform-üstü bir
 * ayar tablosu yok, o yüzden değer backend'de durur.
 */
export const PRINT3D_PARTNER_URL_DEFAULT = "https://figurunica.com";

/** Taban hizmet bedeli satırı — sepette her zaman qty 1. */
export const PRINT3D_BASE_SKU = "print3d_base";
/** Ürün başına satır — adedi SUNUCUDA seçilen ürün sayısından türer. */
export const PRINT3D_ITEM_SKU = "print3d_item";

/** ₺1.500, KDV dahil (katalogdaki tüm fiyatlar brüttür). */
export const PRINT3D_BASE_PRICE_CENTS = 150_000;
/** ₺50, KDV dahil. */
export const PRINT3D_ITEM_PRICE_CENTS = 5_000;

export const PRINT3D_MIN_ITEMS = 1;
export const PRINT3D_MAX_ITEMS = 50;

/**
 * İş durumu YALNIZCA üretimi izler. Kargo/teslim Shipment'ta ve
 * HardwareOrder.status'ta yaşar; aynı olguyu iki yerde tutmak kaçınılmaz
 * olarak ayrışır.
 *   queued -> in_production -> produced
 *   queued|in_production -> cancelled   (terminal)
 */
export const PRINT3D_JOB_STATUSES = [
  "queued",
  "in_production",
  "produced",
  "cancelled",
] as const;

export const PRINT3D_ITEM_STATUSES = [
  "pending",
  "printed",
  "rejected",
] as const;

export type Print3dJobStatus = (typeof PRINT3D_JOB_STATUSES)[number];
export type Print3dItemStatus = (typeof PRINT3D_ITEM_STATUSES)[number];
