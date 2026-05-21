import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsIn,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateIntentDto {
  @IsString()
  planId: string;

  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle: 'MONTHLY' | 'YEARLY';

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
  @IsUUID('all', { each: true })
  acceptedDocumentIds!: string[];
}
