import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

// Canonical HardwareOrder lifecycle (schema.prisma model HardwareOrder).
// Append-only transitions plus the two terminal cancel/refund paths.
// Keep this list in sync with checkout.service.ts where transitions
// originate.
const HARDWARE_ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "fulfillment",
  "shipped",
  "delivered",
  "installed",
  "completed",
  "cancelled",
  "refunded",
  "returned",
] as const;

export class ListHardwareOrdersQueryDto {
  @ApiProperty({
    required: false,
    enum: HARDWARE_ORDER_STATUSES,
    description:
      "Optional lifecycle filter. Omit for all of the tenant's orders.",
  })
  @IsOptional()
  @IsString()
  @IsIn(HARDWARE_ORDER_STATUSES as unknown as string[])
  status?: string;
}
