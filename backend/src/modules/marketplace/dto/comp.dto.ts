import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * Operator comp — hand a tenant a product for free.
 *
 * The reason is required and stored on the ownership row. A comp is the one
 * write that gives away money-gated capability, so "who and why" has to be
 * answerable months later without reading application logs.
 */
export class CompProductDto {
  @ApiProperty({
    example: "e2b1…",
    description: "Tenant receiving the product",
  })
  @IsString()
  tenantId!: string;

  @ApiProperty({ example: "module_personnel" })
  @IsString()
  addOnCode!: string;

  @ApiPropertyOptional({
    default: 1,
    description: "Capacity/credit multiples.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({
    example: "Pilot müşteri — 2026 Q3 sözleşmesi",
    description: "Why this was given away. Stored on the ownership row.",
  })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description: "Branch to scope a per-branch product to.",
  })
  @IsOptional()
  @IsString()
  branchId?: string;
}
