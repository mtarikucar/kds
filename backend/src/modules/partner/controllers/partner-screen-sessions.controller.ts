import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { MachineAuth } from "../../auth/decorators/machine-auth.decorator";
import { PartnerKeyGuard } from "../guards/partner-key.guard";
import { ScreenSessionService } from "../screen-session.service";
import { MintScreenSessionDto } from "../dto/mint-screen-session.dto";
import { RefreshScreenSessionDto } from "../dto/refresh-screen-session.dto";

/**
 * Machine endpoints a partner BACKEND calls (authenticated by its API key) to
 * mint / refresh / revoke per-screen tokens. @MachineAuth makes the global JWT
 * chain step aside; PartnerKeyGuard is the sole authenticator.
 */
@ApiTags("Partner · Screen Sessions")
@ApiSecurity("PartnerKey")
@MachineAuth()
@UseGuards(PartnerKeyGuard)
@Throttle({
  short: { ttl: 10_000, limit: 10 },
  long: { ttl: 60_000, limit: 60 },
})
@Controller("v1/partner/screen-sessions")
export class PartnerScreenSessionsController {
  constructor(private readonly screenSessions: ScreenSessionService) {}

  @Post()
  @ApiOperation({ summary: "Mint a per-screen token. Tokens returned ONCE." })
  mint(@Req() req: any, @Body() dto: MintScreenSessionDto) {
    return this.screenSessions.mint(req.partnerKey, dto);
  }

  @Post("refresh")
  @ApiOperation({ summary: "Rotate a screen's access + refresh tokens" })
  refresh(@Req() req: any, @Body() dto: RefreshScreenSessionDto) {
    return this.screenSessions.refresh(req.partnerKey, dto.refreshToken);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke a single screen session" })
  revoke(@Req() req: any, @Param("id") id: string) {
    return this.screenSessions.revoke(req.partnerKey.tenantId, id);
  }
}
