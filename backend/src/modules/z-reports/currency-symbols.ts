/**
 * Currency symbol lookup shared by the Z-Report PDF renderer and the
 * email summary. Extracted from z-reports.service during the god-file split
 * so the PDF service and the service can both use it without duplication.
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: "₺",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "C$",
  AUD: "A$",
};
