import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { InternalTokenGuard } from './internal-token.guard';
import { ReferralDirectoryService } from '../marketing/acl/referral-directory.service';
import { ResolvedReferral } from '../../core-contracts/referral/referral-directory.port';
import {
  INTERNAL_REFERRAL_BASE,
  INTERNAL_REFERRAL_RESOLVE_SEGMENT,
  ResolveReferralResponse,
} from '../../core-contracts/referral/http-contract';

class ResolveReferralDto {
  @IsString()
  @MaxLength(64)
  code: string;
}

/**
 * Server side of {@link ReferralDirectoryPort} after the Phase-5 split.
 * Marketing OWNS the impl (ReferralDirectoryService reads marketing_users);
 * CORE's checkout/payment flow calls this endpoint through its own
 * HttpReferralDirectoryClient to snapshot referral attribution onto the
 * payment row.
 *
 * Contract mirrors the port: `{ resolved: ResolvedReferral | null }` — an
 * unknown/inactive code is a null result, never an error (the port contract
 * says resolveReferralCode must NEVER throw on a bad code). Wrapped in an
 * object so a null result is distinguishable from an empty body.
 *
 * `@SkipThrottle()` because every resolve arrives from core's single egress
 * IP — machine traffic, not a browser; the global 300 req/min per-IP
 * ThrottlerGuard would starve legitimate checkouts under load.
 */
@Controller(INTERNAL_REFERRAL_BASE)
@SkipThrottle()
@UseGuards(InternalTokenGuard)
export class InternalReferralController {
  constructor(private readonly referralDirectory: ReferralDirectoryService) {}

  @Post(INTERNAL_REFERRAL_RESOLVE_SEGMENT)
  @HttpCode(200)
  async resolve(
    @Body() dto: ResolveReferralDto,
  ): Promise<ResolveReferralResponse> {
    const resolved: ResolvedReferral | null =
      await this.referralDirectory.resolveReferralCode(dto.code);
    return { resolved };
  }
}
