/**
 * 3D baskı SKU'larının SPA tarafındaki tek kopyası.
 *
 * Backend'in print3d.const.ts'i ile aynı iki dize. Elle aynalanan bir sabit
 * her zaman sürüklenme riskidir; risk burada kabul edilebilir çünkü değerler
 * migration'a çivili ve tek bir dosyada duruyor.
 */
export const PRINT3D_BASE_SKU = 'print3d_base';
export const PRINT3D_ITEM_SKU = 'print3d_item';

/** Mağaza ızgarası bu iki ham satırı KART OLARAK basmamalı. */
export function isPrint3dSku(sku: string | undefined | null): boolean {
  return sku === PRINT3D_BASE_SKU || sku === PRINT3D_ITEM_SKU;
}

/**
 * Sihirbazın canlı fiyat sayacı. İSTEMCİ ARİTMETİĞİ NİHAİ DEĞİLDİR — özet
 * adımı ödemeden önce sunucudan gerçek toplamı alır; bu yalnızca önizleme.
 */
export function computePrint3dTotalCents(
  n: number,
  baseCents: number,
  perItemCents: number,
): number {
  return baseCents + perItemCents * Math.max(0, n);
}
