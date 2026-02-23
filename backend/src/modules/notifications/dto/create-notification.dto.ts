import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsBoolean, IsDateString } from 'class-validator';

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
  @ApiProperty({
    description: 'Notification title',
    example: 'Email Verification Code Sent',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Notification message',
    example: 'Your 6-digit verification code: 123456',
  })
  @IsString()
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
  @IsString()
  tenantId: string;

  @ApiPropertyOptional({
    description: 'User ID (if notification is for a specific user)',
    example: 'uuid',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Is this a global notification (sent to all users in tenant)?',
    example: false,
    default: false,
  })
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
  @IsOptional()
  data?: any;

  @ApiPropertyOptional({
    description: 'Notification expiry date',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
