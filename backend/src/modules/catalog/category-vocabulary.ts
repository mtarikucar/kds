/**
 * Single source of truth for the hardware category vocabulary (value + TR
 * label + display order). Previously the value list lived in the DTO @IsIn
 * gate, the SPA filter array, and the SPA label map — three hand-synced
 * copies. Now the DTO derives its @IsIn list from here and the SPA fetches it
 * from GET /v1/catalog/categories, so a new category is added in ONE place.
 *
 * (The category→saleMode regulatory map is a separate concern and lives in
 * CATEGORY_DEFAULT_SALE_MODE on the DTO.)
 */
export interface CatalogCategory {
  value: string;
  labelTr: string;
}

export const HARDWARE_CATEGORIES: CatalogCategory[] = [
  { value: "yazarkasa", labelTr: "Yazarkasa POS" },
  { value: "pos_terminal", labelTr: "POS Terminal" },
  { value: "printer", labelTr: "Yazıcı" },
  { value: "kds_screen", labelTr: "KDS Ekranı" },
  { value: "tablet", labelTr: "Tablet" },
  { value: "scanner", labelTr: "Barkod Okuyucu" },
  { value: "caller_id", labelTr: "Arayan Numara" },
  { value: "cash_drawer", labelTr: "Para Çekmecesi" },
  { value: "bridge", labelTr: "Network Bridge" },
  { value: "scale", labelTr: "Tartı" },
  { value: "cable", labelTr: "Kablo" },
  { value: "accessory", labelTr: "Aksesuar" },
  { value: "service", labelTr: "Kurulum & Hizmet" },
];

export const CATEGORY_VALUES = HARDWARE_CATEGORIES.map((c) => c.value);
