import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  PRINT3D_ITEM_STATUSES,
  PRINT3D_JOB_STATUSES,
  Print3dItemStatus,
  Print3dJobStatus,
} from "../print3d.const";

export class UpdatePrint3dJobStatusDto {
  @ApiProperty({ enum: PRINT3D_JOB_STATUSES })
  @IsIn(PRINT3D_JOB_STATUSES as unknown as string[])
  status!: Print3dJobStatus;

  /** Figurunica'nın kendi iş numarası; operatör panelden girer. */
  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  partnerRef?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  opsNote?: string;
}

export class UpdatePrint3dJobItemDto {
  @ApiProperty({ enum: PRINT3D_ITEM_STATUSES })
  @IsIn(PRINT3D_ITEM_STATUSES as unknown as string[])
  status!: Print3dItemStatus;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  opsNote?: string;
}
