import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";
import { Print3dService } from "./print3d.service";
import {
  UpdatePrint3dJobItemDto,
  UpdatePrint3dJobStatusDto,
} from "./dto/print3d-ops.dto";

/**
 * Üretim kuyruğu. Manifesto kiracının menü fotoğraflarını ve teslimat
 * adresini taşıdığı için yalnızca @SuperAdminRoute() arkasında.
 *
 * Kargo için YENİ endpoint yok: panel mevcut
 * POST /v1/superadmin/shipments/:orderId rayını çağırır.
 */
@ApiTags("SuperAdmin · Print3D")
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller("v1/superadmin/print3d")
export class SuperadminPrint3dController {
  constructor(private readonly print3d: Print3dService) {}

  @Get("jobs")
  @ApiOperation({ summary: "Tüm kiracıların 3D baskı üretim kuyruğu" })
  list(@Query("status") status?: string, @Query("partner") partner?: string) {
    return this.print3d.listQueue({ status, partner });
  }

  @Get("jobs/:id")
  @ApiOperation({ summary: "Figurunica manifestosu — kalemler + adres" })
  get(@Param("id") id: string) {
    return this.print3d.getJob(id);
  }

  @Patch("jobs/:id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() body: UpdatePrint3dJobStatusDto,
  ) {
    return this.print3d.updateStatus(id, body);
  }

  @Patch("jobs/:id/items/:itemId")
  updateItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: UpdatePrint3dJobItemDto,
  ) {
    return this.print3d.updateItem(id, itemId, body);
  }
}
