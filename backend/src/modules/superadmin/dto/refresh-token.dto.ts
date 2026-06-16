import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Body for POST /superadmin/auth/refresh.
 *
 * The endpoint was previously taking `@Body('refreshToken') token: string`
 * — a raw string with no class-validator surface. NestJS's global
 * ValidationPipe only fires when @Body is typed as a class, so a
 * megabyte refreshToken would be JSON-parsed and handed to
 * jwt.verify (which then base64-decodes header+payload before the
 * signature check fails). The 30/min throttle bounds traffic
 * volume but cap the input shape too — defence in depth across
 * the highest-privilege auth surface in the product.
 *
 * 4096 is well above any realistic JWT length (~500-1000 chars in
 * practice) but small enough that the parser never burns CPU on
 * pathological inputs.
 */
export class SuperAdminRefreshTokenDto {
  @ApiProperty({ description: "Refresh token issued at the end of verify-2fa" })
  // Optional: the refresh token now travels in an httpOnly cookie (primary).
  // This body field is a backward-compatible fallback. MaxLength still caps
  // the input to bound jwt.verify CPU on pathological payloads.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}
