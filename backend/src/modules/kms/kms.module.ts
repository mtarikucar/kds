import { Global, Logger, Module } from "@nestjs/common";
import { KmsProvider } from "./kms-provider.interface";
import { EnvKmsProvider } from "./env-kms-provider";
import { AwsKmsProvider } from "./aws-kms-provider";

export const KMS_PROVIDER_TOKEN = "KMS_PROVIDER";

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
        const choice = (process.env.KMS_PROVIDER ?? "env").toLowerCase();
        const logger = new Logger("KmsModule");
        const isProd = process.env.NODE_ENV === "production";

        if (choice === "aws") {
          // AwsKmsProvider is a stub: encrypt()/decrypt() throw. Without a
          // boot-time refusal the app comes up clean and only the first
          // write request 500s — that's a discovery delay we don't want
          // when ops flips KMS_PROVIDER=aws. Refuse loudly so misconfig
          // surfaces at deploy time, not at customer time.
          throw new Error(
            "KMS_PROVIDER=aws but AwsKmsProvider is unimplemented. Install @aws-sdk/client-kms " +
              "and replace the stub before pointing prod at it.",
          );
        }
        if (choice !== "env") {
          logger.warn(`Unknown KMS_PROVIDER=${choice} — falling back to 'env'`);
        }
        // In production the env-derived KMS requires a master key. Without
        // it, masterKeyFor(1) returns null and the first encrypt() throws
        // mid-request. Catch that misconfig at boot so deploy.sh's health-
        // probe fails fast instead of serving a broken backend.
        if (
          isProd &&
          !process.env.INTEGRATION_KEY &&
          !process.env.KMS_MASTER_KEY
        ) {
          throw new Error(
            "KMS_PROVIDER=env in production requires INTEGRATION_KEY or KMS_MASTER_KEY " +
              "(or KMS_MASTER_KEY_V<N> for a specific version). None are set — refusing to boot.",
          );
        }
        logger.log(
          `Using env KMS provider${isProd ? "" : " (dev / non-production)"}`,
        );
        return env;
      },
      inject: [EnvKmsProvider, AwsKmsProvider],
    },
  ],
  exports: [KMS_PROVIDER_TOKEN],
})
export class KmsModule {}
