import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Manager-only batch assignment. The 200-row ceiling matches the
 * largest selection the UI can realistically build (paginated table at
 * 100/page × 2 pages), and keeps the bulk-write transaction inside
 * Postgres's reasonable size budget. `assignedToId` empty/null → bulk
 * unassign (rare, but symmetric with the single-assign endpoint).
 */
export class BulkAssignLeadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  leadIds: string[];

  @IsOptional()
  @IsString()
  assignedToId?: string | null;
}
