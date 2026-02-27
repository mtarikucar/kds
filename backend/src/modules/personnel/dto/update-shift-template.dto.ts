import { PartialType } from '@nestjs/swagger';
import { CreateShiftTemplateDto } from './create-shift-template.dto';

export class UpdateShiftTemplateDto extends PartialType(CreateShiftTemplateDto) {}
