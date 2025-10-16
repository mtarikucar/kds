import { PartialType } from '@nestjs/swagger';
import { CreateQrSettingsDto } from './create-qr-settings.dto';

export class UpdateQrSettingsDto extends PartialType(CreateQrSettingsDto) {}
