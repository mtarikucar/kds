import { Injectable, Logger } from '@nestjs/common';
import { KmsDecryptInput, KmsEncryptInput, KmsProvider } from './kms-provider.interface';

/**
 * AWS KMS provider (stub).
 *
 * Real implementation talks to @aws-sdk/client-kms — left unimplemented
 * because pulling in the SDK is a 5MB+ dependency that production should
 * opt into. When ops switches `KMS_PROVIDER=aws`, this stub throws at
 * boot with an actionable error pointing at the install instructions.
 *
 * Recommended runtime config:
 *   KMS_PROVIDER=aws
 *   KMS_AWS_KEY_ID=alias/hummytummy-tenant-credentials
 *   AWS_REGION=eu-central-1
 *   AWS_ROLE_ARN=arn:aws:iam::1234567890:role/hummytummy-backend
 *
 * Encryption context maps onto AWS KMS's native EncryptionContext, so
 * cross-tenant ciphertext misuse fails server-side at decrypt.
 */
@Injectable()
export class AwsKmsProvider implements KmsProvider {
  readonly id = 'aws';
  private readonly logger = new Logger(AwsKmsProvider.name);

  async encrypt(_input: KmsEncryptInput): Promise<Buffer> {
    throw new Error(
      'AwsKmsProvider stub — install @aws-sdk/client-kms and replace this stub. ' +
        'Until then, KMS_PROVIDER=env is the supported configuration.',
    );
  }

  async decrypt(_input: KmsDecryptInput): Promise<string> {
    throw new Error('AwsKmsProvider stub — see encrypt()');
  }

  async healthCheck() {
    return {
      ok: false,
      details: { provider: 'aws', error: 'not implemented; install @aws-sdk/client-kms' },
    };
  }
}
