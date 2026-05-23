import { Global, Logger, Module } from '@nestjs/common';
import { KmsProvider } from './kms-provider.interface';
import { EnvKmsProvider } from './env-kms-provider';
import { AwsKmsProvider } from './aws-kms-provider';

export const KMS_PROVIDER_TOKEN = 'KMS_PROVIDER';

/**
 * @Global module that exposes a single `KmsProvider` instance for the
 * whole app. Backing implementation chosen by `KMS_PROVIDER` env var:
 *
 *   env (default)  — derived per-tenant key, in-process. Safe for dev/CI.
 *   aws            — @aws-sdk/client-kms (stub until SDK is installed).
 *
 * Other modules inject via `@Inject(KMS_PROVIDER_TOKEN) kms: KmsProvider`.
 * Swapping providers requires no code change in the consumers.
 */
@Global()
@Module({
  providers: [
    EnvKmsProvider,
    AwsKmsProvider,
    {
      provide: KMS_PROVIDER_TOKEN,
      useFactory: (env: EnvKmsProvider, aws: AwsKmsProvider): KmsProvider => {
        const choice = (process.env.KMS_PROVIDER ?? 'env').toLowerCase();
        const logger = new Logger('KmsModule');
        if (choice === 'aws') {
          logger.log('Using AWS KMS provider');
          return aws;
        }
        if (choice !== 'env') {
          logger.warn(`Unknown KMS_PROVIDER=${choice} — falling back to 'env'`);
        }
        return env;
      },
      inject: [EnvKmsProvider, AwsKmsProvider],
    },
  ],
  exports: [KMS_PROVIDER_TOKEN],
})
export class KmsModule {}
