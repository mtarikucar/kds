import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString } from 'class-validator';

export enum TaskType {
  CALL = 'CALL',
  VISIT = 'VISIT',
  DEMO = 'DEMO',
  FOLLOW_UP = 'FOLLOW_UP',
  MEETING = 'MEETING',
  OTHER = 'OTHER',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(TaskType)
  type: TaskType;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
