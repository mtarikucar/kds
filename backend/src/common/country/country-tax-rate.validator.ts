import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import { RequestContext } from "../context/request-context";
import { resolveCountryProfile } from "./country.service";

/**
 * Validates a tax-rate field against the AMBIENT tenant's country profile
 * instead of a fixed band. Before this, `@IsIn([0, 1, 10, 20])` made it
 * flatly impossible to enter Uzbekistan's 12% QQS or its 6% catering rate —
 * every UZ operator's product entry would 400 no matter what they typed.
 *
 * MUST resolve the country inside `validate()` (validation time), never at
 * decoration time. `registerDecorator` runs the wrapper function once, when
 * the DTO class is first defined by the module loader — long before any
 * request (and therefore any ambient country) exists. Reading
 * `RequestContext`/`CountryService.ambient()` there would freeze the
 * allowed band to whatever was ambient at import time, which is nothing —
 * i.e. always the TR fallback. That bug would still pass most tests (TR
 * fixtures keep working) and only surface as "every UZ tenant is rejected"
 * in production. `validate()` below is invoked per validation call, so it
 * reads the request-scoped country fresh every time.
 */
export function IsCountryTaxRate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isCountryTaxRate",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        // Presence is @IsOptional's job; undefined/null here means "not
        // supplied" and must pass through untouched.
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          if (typeof value !== "number") return false;
          const profile = resolveCountryProfile(
            RequestContext.get()?.countryCode,
          );
          return profile.taxRates.includes(value);
        },
        // Also resolved at call time (not captured above) so a UZ operator
        // sees UZ's own bands in the 400, not Turkey's — otherwise the
        // error message is actively misleading about what would be accepted.
        defaultMessage(args: ValidationArguments): string {
          const profile = resolveCountryProfile(
            RequestContext.get()?.countryCode,
          );
          return `${args.property} must be one of the allowed rates for ${profile.code}: ${profile.taxRates.join(", ")}`;
        },
      },
    });
  };
}
