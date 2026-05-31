import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EmptyStringToUndefined, StringToBoolean } from '../../../common/dto/transforms';

export enum NotificationType {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
  ORDER = 'ORDER',
  STOCK = 'STOCK',
  SYSTEM = 'SYSTEM',
  RESERVATION = 'RESERVATION',
}

export enum NotificationPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreateNotificationDto {
  // Caps are defence-in-depth. Callers are internal (services), but a
  // bug-driven misuse — e.g. an AI-generated error payload getting
  // blasted into every admin feed — would otherwise persist arbitrarily
  // large rows. Title fits a single feed-line; message is generous
  // enough for a stack-trace excerpt.
  @ApiProperty({
    description: 'Notification title',
    example: 'Email Verification Code Sent',
  })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({
    description: 'Notification message',
    example: 'Your 6-digit verification code: 123456',
  })
  @IsString()
  @MaxLength(5000)
  message: string;

  @ApiProperty({
    description: 'Notification type',
    enum: NotificationType,
    example: NotificationType.INFO,
  })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({
    description: 'Tenant ID',
    example: 'uuid',
  })
  @IsUUID()
  tenantId: string;

  @ApiPropertyOptional({
    description:
      'Branch ID (v3.0.0 — required by schema). If omitted, the service falls back to the tenant\'s first active branch for system-wide notifications.',
    example: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'User ID (if notification is for a specific user)',
    example: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Is this a global notification (sent to all users in tenant)?',
    example: false,
    default: false,
  })
  @StringToBoolean()
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({
    description: 'Notification priority',
    enum: NotificationPriority,
    example: NotificationPriority.NORMAL,
    default: NotificationPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({
    description: 'Additional data (JSON)',
    example: { code: '123456', expiresAt: '2024-01-01T00:00:00Z' },
  })
  // class-validator's @IsObject() still rejects strings/arrays/null at
  // runtime; the property type stays `any` so it lines up with Prisma's
  // InputJsonValue (which is a discriminated union, not `Record`).
  @IsOptional()
  @IsObject()
  data?: any;

  @ApiPropertyOptional({
    description: 'Notification expiry date',
    example: '2024-01-01T00:00:00Z',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
