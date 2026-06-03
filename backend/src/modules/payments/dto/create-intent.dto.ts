import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsIn,
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
  Matches,
} from "class-validator";

export class CreateIntentDto {
  @IsString()
  planId: string;

  @IsIn(["MONTHLY", "YEARLY"])
  billingCycle: "MONTHLY" | "YEARLY";

  /**
   * IDs of the three current legal documents (KVKK + Mesafeli Satış +
   * İade Politikası) the user just checked at checkout. The service
   * (via ConsentService.verifyAndRecord) re-resolves these against the
   * `isCurrent=true` rows for each kind, then writes three Consent
   * audit rows with ip + userAgent before any PayTR token is minted.
   * Three uuids exactly — frontend pulls them from
   * `/legal/documents/:kind/current`.
   */
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsUUID("all", { each: true })
  acceptedDocumentIds!: string[];

  /**
   * Optional marketer referral code (e.g. "AHMET42"), captured from the
   * `?ref=CODE` link → `ht_ref` first-party cookie → checkout request body.
   * Resolved server-side (via ReferralDirectoryPort) to the owning marketer
   * and snapshotted onto the payment row so the post-settlement commission
   * consumer credits the right rep. An unknown/inactive code is silently
   * ignored — it NEVER blocks checkout.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "referralCode must be alphanumeric" })
  referralCode?: string;
}
