import type { SaPrint3dJob } from '../../features/superadmin/api/superadminPrint3dApi';

/** RFC4180 field escaping: embedded quotes are doubled, the field is quoted. */
function cell(v: string | null): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

/**
 * Figurunica manifest — generated CLIENT-SIDE, no new server endpoint. Each
 * item is one figurine, so qty is always 1 per row.
 */
export function print3dManifestCsv(job: SaPrint3dJob): string {
  const header = 'productName,productImageUrl,model3dUrl,qty';
  const rows = job.items.map(
    (i) =>
      `${cell(i.productName)},${cell(i.productImageUrl)},${cell(i.model3dUrl)},1`,
  );
  return [header, ...rows].join('\n') + '\n';
}
