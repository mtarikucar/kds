import { IsString, IsNotEmpty } from 'class-validator';

export class AssignLeadDto {
  @IsString()
  @IsNotEmpty()
  assignedToId: string;
}
