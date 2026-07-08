import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { OkcService } from "./okc.service";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";

@ApiTags("okc")
@ApiBearerAuth()
@Controller("okc")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class OkcController {
  constructor(private readonly service: OkcService) {}

  @Get("device")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "ÖKC device status (which provider, available?)" })
  deviceStatus() {
    return this.service.deviceStatus();
  }

  @Post("orders/:id/print")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Print an order's fiscal receipt on the ÖKC" })
  printOrderReceipt(
    @Param("id") id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.printOrderReceipt(scope, id);
  }
}
