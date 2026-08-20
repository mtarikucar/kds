import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { Print3dService } from "./print3d.service";

/**
 * Kiracı yüzeyi.
 *
 * Şube kapsamı atlanmıyor ve atlanmamalı: /v1/checkout de şube kapsamlı ve
 * SPA zaten X-Branch-Id gönderiyor. frontend/src/lib/api.ts'teki tenant-wide
 * önek listesine de ekleme YAPILMAZ. (Bilinçli sapma: skip-branch-scope
 * decorator'ı buraya konulmuyor.)
 */
@ApiTags("Print3D")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller("v1/print3d")
export class Print3dController {
  constructor(private readonly print3d: Print3dService) {}

  @Get("offer")
  @ApiOperation({
    summary: "3D baskı figür teklifi — canlı fiyat + üretim ortağı rozeti",
  })
  offer() {
    return this.print3d.getOffer();
  }

  @Get("jobs")
  @ApiOperation({ summary: "Kiracının 3D baskı işleri (kalem + kargo dahil)" })
  listMine(@Req() req: any) {
    return this.print3d.listMine(req.user.tenantId);
  }

  @Get("jobs/:id")
  @ApiOperation({ summary: "Tek 3D baskı işi" })
  getMine(@Req() req: any, @Param("id") id: string) {
    return this.print3d.getMine(req.user.tenantId, id);
  }
}
