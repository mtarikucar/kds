import { plainToInstance } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from "class-validator";

export enum NodeEnvironment {
  Development = "development",
  Production = "production",
  Test = "test",
  Staging = "staging",
}

/**
 * Typed env validation for ConfigModule (app.module.ts).
 *
 * Division of labor with common/helpers/env-validation.ts (the boot
 * validator main.ts runs before Nest starts):
 *
 *   - env-validation.ts owns SECRETS — presence, min length, cross-realm
 *     distinctness, placeholder detection, PAYTR_TEST_MODE. Do not
 *     duplicate those rules here; one source of truth.
 *   - this class owns TYPES/SHAPES the boot validator doesn't check:
 *     NODE_ENV is a known value (catches NODE_ENV=prod silently running
 *     with dev defaults), PORT is a valid port, URL-shaped optionals
 *     parse. It also runs inside Test.createTestingModule(), where
 *     main.ts never executes.
 *
 * Unknown variables are intentionally allowed: modules own their optional
 * config and read it through ConfigService.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(NodeEnvironment)
  NODE_ENV?: NodeEnvironment;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  REDIS_URL?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  METRICS_TOKEN?: string;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    // One aggregated error naming every offending variable — operators fix
    // the whole set in one pass instead of replaying boot per variable.
    const details = errors
      .map((e) => {
        const constraints = Object.values(e.constraints ?? {}).join("; ");
        return `  - ${e.property}: ${constraints || "invalid value"}`;
      })
      .join("\n");
    throw new Error(
      `Environment validation failed (NODE_ENV=${config.NODE_ENV ?? "undefined"}):\n${details}`,
    );
  }

  return validated;
}
