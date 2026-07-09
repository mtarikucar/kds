/**
 * e-Belge document-type routing (GİB).
 *
 * A sale must be issued as the CORRECT Turkish e-document, and the current code
 * hardcoded a single profile. The rule:
 *   - e-Fatura (EFATURA): the buyer is a registered e-Fatura mükellefi (found in
 *     the GİB mükellef list) AND carries a valid VKN/TCKN + tax office. B2B.
 *   - e-Arşiv (EARSIVFATURA): everyone else — the final consumer / unregistered
 *     buyer. B2C, the common restaurant case.
 *
 * `isRegisteredEFaturaUser` comes from the GİB mükellef query (via the
 * integrator). When it is unknown (query not run / no integrator credentials),
 * we route to e-Arşiv, which is always valid for a final-consumer sale — the
 * safe default that never wrongly issues a B2B e-Fatura the buyer can't receive.
 *
 * This module is the pure decision + validation layer. Actual issuance (signed
 * UBL, integrator API call, GİB accept lifecycle) is owned by the accounting
 * adapters and requires the operator's integrator credentials + mali mühür/
 * e-imza certificate + GİB certification — see docs/decision on integrator.
 */

export type EDocumentType = "EFATURA" | "EARSIVFATURA";

export interface EDocumentBuyer {
  /** VKN (10 digits, companies) or TCKN (11 digits, individuals). */
  taxId?: string | null;
  taxOffice?: string | null;
  /** From the GİB mükellef query. undefined/null = unknown → treat as not registered. */
  isRegisteredEFaturaUser?: boolean | null;
}

/** A VKN is 10 digits, a TCKN 11 — both all-numeric. */
export function isValidTaxId(taxId?: string | null): boolean {
  if (!taxId) return false;
  return /^\d{10}$/.test(taxId) || /^\d{11}$/.test(taxId);
}

/**
 * Decide the e-document type for a sale. e-Fatura only when the buyer is a
 * confirmed registered e-Fatura user with a valid tax id; otherwise e-Arşiv.
 */
export function resolveEDocumentType(buyer: EDocumentBuyer): EDocumentType {
  if (buyer.isRegisteredEFaturaUser === true && isValidTaxId(buyer.taxId)) {
    return "EFATURA";
  }
  return "EARSIVFATURA";
}

/**
 * Validate the buyer party is complete enough for the chosen document type.
 * Returns a list of human-readable problems (empty = ok). e-Fatura needs a full
 * AccountingCustomerParty; e-Arşiv (B2C) can be issued to a final consumer with
 * minimal buyer data.
 */
export function validateBuyerFor(
  type: EDocumentType,
  buyer: EDocumentBuyer,
): string[] {
  if (type !== "EFATURA") return [];
  const errors: string[] = [];
  if (!isValidTaxId(buyer.taxId)) {
    errors.push("e-Fatura requires a valid buyer VKN (10) / TCKN (11)");
  }
  if (!buyer.taxOffice || !buyer.taxOffice.trim()) {
    errors.push("e-Fatura requires the buyer tax office (vergi dairesi)");
  }
  return errors;
}
