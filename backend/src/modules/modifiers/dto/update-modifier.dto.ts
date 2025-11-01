import { PartialType } from '@nestjs/swagger';
import { CreateModifierDto } from './create-modifier.dto';
import { OmitType } from '@nestjs/swagger';

export class UpdateModifierDto extends PartialType(
  OmitType(CreateModifierDto, ['groupId'] as const)
) {}
