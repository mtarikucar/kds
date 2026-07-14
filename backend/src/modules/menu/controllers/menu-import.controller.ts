import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { MenuImportService } from "../services/menu-import.service";
import { CommitMenuImportDto } from "../dto/menu-import.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { UserRole } from "../../../common/constants/roles.enum";

@ApiTags("menu-import")
@Controller("menu/import")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class MenuImportController {
  constructor(private readonly menuImport: MenuImportService) {}

  /** Lets the admin UI show/hide the "digitise from photo" feature. */
  @Get("status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Whether AI menu import is configured" })
  status() {
    return { configured: this.menuImport.isConfigured() };
  }

  // parse is the AI call (Claude OCR) → PRO+ only. commit below is
  // deliberately NOT gated: BulkAddModal drives the same commit endpoint for
  // hand-typed (non-AI) bulk entry, and a downgraded tenant must still be
  // able to commit a draft it already parsed.
  @Post("parse")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Digitise menu photo(s) into an editable draft (no persistence)",
  })
  @UseInterceptors(
    FilesInterceptor("photos", 10, {
      limits: { fileSize: 8 * 1024 * 1024, files: 10 },
    }),
  )
  async parse(@UploadedFiles() files: Array<Express.Multer.File>) {
    const images = (files ?? []).map((f) => ({
      buffer: f.buffer,
      mimetype: f.mimetype,
    }));
    return this.menuImport.parseMenuPhotos(images);
  }

  @Post("commit")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Create categories + products from a reviewed import draft",
  })
  commit(@Body() dto: CommitMenuImportDto, @Request() req) {
    return this.menuImport.commitDraft(dto, req.tenantId);
  }
}
