/**
 * Minimal RFC-4180 CSV serializer for report/accountant exports. A cell is
 * quoted only when it contains a comma, double-quote or newline; embedded
 * quotes are doubled. null/undefined render as empty cells.
 */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) {
    lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}
