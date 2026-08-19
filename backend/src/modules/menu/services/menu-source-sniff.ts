/**
 * Decide what a fetched payload actually is.
 *
 * Priority is magic bytes → Content-Type → filename extension, in that order,
 * because servers lie constantly: a PDF arrives as application/octet-stream,
 * a CSV export arrives as text/html, and a link may carry no extension at
 * all. The bytes cannot lie about themselves.
 *
 * Anything we cannot identify falls through to "html", which is the most
 * tolerant path — it reduces whatever it got to text and hands it to the
 * model, rather than refusing outright.
 */
export type SourceKind = "pdf" | "xlsx" | "csv" | "html";

const startsWith = (buf: Buffer, sig: number[]) =>
  buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

export function sniffSourceKind(
  bytes: Buffer,
  contentType?: string,
  filename?: string,
): SourceKind {
  // 1 — magic bytes.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // PK.. (OOXML zip)
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "xlsx"; // legacy .xls (OLE2)

  // 2 — Content-Type, minus any charset parameter.
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  if (mime === "text/csv" || mime === "application/csv") return "csv";

  // 3 — filename extension.
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "csv" || ext === "tsv") return "csv";

  return "html";
}
