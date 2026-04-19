import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateLeadDto } from './create-lead.dto';

/**
 * Intentionally omits `assignedToId` — reassignment goes through the
 * dedicated, manager-only `PATCH /leads/:id/assign` endpoint so a rep
 * cannot silently reassign their own lead. `status` and `lostReason`
 * likewise live on `PATCH /leads/:id/status` so every state transition
 * leaves a matching audit entry.
 */
export class UpdateLeadDto extends PartialType(
  OmitType(CreateLeadDto, ['assignedToId'] as const),
) {}
