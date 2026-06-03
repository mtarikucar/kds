import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

/**
 * Class-level constraint that passes when at least one of the named
 * properties on the validated object is a non-empty string. Used by
 * the public reservation DTO where customers must supply *either*
 * email or phone but the choice is theirs.
 *
 * @example
 *   ⁠@AtLeastOneOf(['customerEmail', 'customerPhone'], { message: '...' })
 *   class CreateReservationDto { ... }
 *
 * Behavior notes:
 *   - `null`, `undefined`, and empty/whitespace-only strings count as
 *     "missing"; the user can't sneak past with `{ email: '   ' }`.
 *   - Numbers and booleans are not coerced — this decorator is for
 *     string-shaped contact fields. If we ever apply it to numeric IDs
 *     the implementation will need a broader emptiness check.
 *   - The decorator is class-level (attached to the class itself, not
 *     a property) so its message is surfaced via `constraints[0]` on
 *     the parent target rather than against an individual field.
 */
@ValidatorConstraint({ name: "AtLeastOneOf", async: false })
class AtLeastOneOfConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const keys = args.constraints[0] as string[];
    const obj = args.object as Record<string, unknown>;
    return keys.some((k) => {
      const v = obj[k];
      return typeof v === "string" && v.trim().length > 0;
    });
  }

  defaultMessage(args: ValidationArguments): string {
    const keys = (args.constraints[0] as string[]).join(", ");
    return `At least one of [${keys}] must be provided`;
  }
}

export function AtLeastOneOf(
  keys: string[],
  validationOptions?: ValidationOptions,
): ClassDecorator {
  return function (target: Function) {
    registerDecorator({
      name: "AtLeastOneOf",
      target: target,
      propertyName: undefined as unknown as string, // class-level
      options: validationOptions,
      constraints: [keys],
      validator: AtLeastOneOfConstraint,
    });
  };
}
