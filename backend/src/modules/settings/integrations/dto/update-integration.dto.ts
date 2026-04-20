import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateIntegrationDto } from './create-integration.dto';

// `integrationType` and `provider` are the compound unique key AND drive
// the encryption policy in IntegrationsService (sensitive types get
// AES-256-GCM; hardware types stay plaintext). Allowing updates to either
// lets an admin smuggle plaintext credentials into a previously-encrypted
// row by first switching it to a hardware type. Omit them here — callers
// that legitimately want to re-target an integration must delete + create.
export class UpdateIntegrationDto extends PartialType(
  OmitType(CreateIntegrationDto, ['integrationType', 'provider'] as const),
) {}
