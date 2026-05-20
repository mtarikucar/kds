/**
 * Mirror of the `kind` column on `legal_documents`. The Prisma schema
 * uses a String field (project convention — see User.role / Order.status)
 * instead of a Prisma enum, so this TypeScript enum is what application
 * code uses for type safety. Values must stay aligned with the schema's
 * comment-documented allowed values.
 */
export enum LegalDocumentKind {
  KVKK = "KVKK",
  DISTANCE_SALES = "DISTANCE_SALES",
  REFUND_POLICY = "REFUND_POLICY",
  TERMS_OF_SERVICE = "TERMS_OF_SERVICE",
  PRIVACY_POLICY = "PRIVACY_POLICY",
}

/**
 * The three documents that block checkout — every paid subscription
 * intent must carry consent for all three. TERMS_OF_SERVICE and
 * PRIVACY_POLICY are also legal documents but are accepted at
 * registration, not at every checkout.
 */
export const CHECKOUT_REQUIRED_KINDS: readonly LegalDocumentKind[] = [
  LegalDocumentKind.KVKK,
  LegalDocumentKind.DISTANCE_SALES,
  LegalDocumentKind.REFUND_POLICY,
] as const;
