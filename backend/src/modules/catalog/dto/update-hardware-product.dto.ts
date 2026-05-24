import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateHardwareProductDto } from './create-hardware-product.dto';

// SKU is immutable after creation — old SKUs may already be on invoices,
// shipping labels, and reorder workflows. Renaming silently breaks audit
// trails.
export class UpdateHardwareProductDto extends PartialType(
  OmitType(CreateHardwareProductDto, ['sku'] as const),
) {}
