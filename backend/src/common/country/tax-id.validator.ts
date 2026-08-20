import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import { RequestContext } from "../context/request-context";
import { resolveCountryProfile } from "./country.service";
import { CountryProfile, CountryTaxIdRule } from "./country-profile.const";

/**
 * Pure predicate: does `value` match ANY of this profile's tax-id shapes?
 * TR: 10-digit VKN (corporate) or 11-digit TCKN (individual). UZ: 9-digit
 * STIR or 14-digit PINFL. Before this validator existed, every operator-
 * entered tax id everywhere in the app was checked against the fixed
 * `/^\d{10,11}$/` TR shape, so every UZ tenant's STIR/PINFL was rejected no
 * matter what was typed.
 *
 * Exported standalone (not just via the decorator below) so plain call
 * sites and the spec can drive it directly — mirrors how
 * `resolveCountryProfile` sits next to `CountryService`.
 */
export function isValidTaxId(value: string, profile: CountryProfile): boolean {
  if (typeof value !== "string") return false;
  return profile.taxIdRules.some((rule) => rule.pattern.test(value));
}

/**
 * Extracts the digit count from a `^\d{N}$`-shaped rule pattern, for
 * building the rejection message below. Every taxIdRules pattern in
 * country-profile.const.ts is shaped this way; if a future country needs a
 * non-fixed-length shape this falls back to "?" rather than throwing.
 */
function ruleDigits(rule: CountryTaxIdRule): string {
  return rule.pattern.source.match(/\{(\d+)\}/)?.[1] ?? "?";
}

/**
 * Validates a tax-id field against the AMBIENT tenant's country profile
 * instead of a fixed VKN(10)/TCKN(11) shape. Same pattern as
 * `@IsCountryTaxRate()` (country-tax-rate.validator.ts) — read that one
 * first, this mirrors it field-for-field.
 *
 * MUST resolve the country inside `validate()` (validation time), never at
 * decoration time. `registerDecorator` runs the wrapper function once, when
 * the DTO class is first defined by the module loader — long before any
 * request (and therefore any ambient country) exists. Reading
 * `RequestContext`/`CountryService.ambient()` there would freeze the
 * accepted shape to whatever was ambient at import time, which is nothing —
 * i.e. always the TR fallback. That bug would still pass most tests (TR
 * fixtures keep working) and only surface as "every UZ tenant's tax id is
 * rejected" in production. `validate()` below is invoked per validation
 * call, so it reads the request-scoped country fresh every time.
 */
export function IsCountryTaxId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isCountryTaxId",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        // Presence is @IsOptional's job; undefined/null here means "not
        // supplied" and must pass through untouched.
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          if (typeof value !== "string") return false;
          const profile = resolveCountryProfile(
            RequestContext.get()?.countryCode,
          );
          return isValidTaxId(value, profile);
        },
        // Also resolved at call time (not captured above) so a UZ operator
        // sees UZ's own shapes (STIR/PINFL) in the 400, not Turkey's
        // VKN/TCKN — otherwise the error message is actively misleading
        // about what would be accepted.
        defaultMessage(args: ValidationArguments): string {
          const profile = resolveCountryProfile(
            RequestContext.get()?.countryCode,
          );
          const shapes = profile.taxIdRules
            .map((r) => `${r.name} (${ruleDigits(r)})`)
            .join(" or ");
          return `${args.property} must match one of ${profile.code}'s formats: ${shapes}`;
        },
      },
    });
  };
}
