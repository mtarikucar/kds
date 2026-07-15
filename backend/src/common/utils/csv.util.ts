/**
 * Minimal RFC-4180 CSV serializer for report/accountant exports. A cell is
 * quoted only when it contains a comma, double-quote, CR or newline; embedded
 * quotes are doubled. null/undefined render as empty cells.
 *
 * CSV/formula-injection defence: a cell whose first character is = + - @ (or a
 * leading tab/CR) is executed as a FORMULA by Excel/Sheets/LibreOffice the
 * moment the export is opened — so a STRING cell carrying user-controlled text
 * (a product/category/cashier name like `=HYPERLINK("http://evil","x")`) would
 * run on the accountant's machine. Such string cells are prefixed with a single
 * quote to force text. NUMBER cells are left untouched: they can't carry an
 * injection payload, and prefixing would wrongly turn a legitimate negative
 * value (e.g. an over/short of -50) into text. Matches the escaper in
 * personnel attendance + superadmin audit exports.
 */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const esc = (v: string | number | null | undefined): string => {
    if (v == null) return "";
    const isNumber = typeof v === "number";
    let s = String(v);
    if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Headers are static literals but escape them too for uniformity.
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) {
    lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}
