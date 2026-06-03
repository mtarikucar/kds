import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";

/**
 * Caps the serialized size of a free-form JSON property. `@IsObject()` only
 * checks the type, not the size, so without this an admin (or a compromised
 * admin token) could persist a multi-megabyte blob into e.g. specs/details —
 * which is then serialized on every public storefront load (toPublicView).
 * Mirrors the rationale behind the description/images length caps.
 */
export function MaxJsonBytes(max: number, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "maxJsonBytes",
      target: object.constructor,
      propertyName,
      constraints: [max],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null) return true;
          try {
            const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
            return bytes <= (args.constraints[0] as number);
          } catch {
            return false; // circular / non-serializable → reject
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} exceeds the maximum allowed size of ${args.constraints[0]} bytes`;
        },
      },
    });
  };
}
