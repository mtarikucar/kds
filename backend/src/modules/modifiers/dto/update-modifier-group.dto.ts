import { PartialType } from '@nestjs/swagger';
import { CreateModifierGroupDto } from './create-modifier-group.dto';

export class UpdateModifierGroupDto extends PartialType(CreateModifierGroupDto) {}
