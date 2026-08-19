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
import { MenuSourceService } from "../services/menu-source.service";
import { CommitMenuImportDto } from "../dto/menu-import.dto";
import { ParseMenuSourceDto } from "../dto/parse-menu-source.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { UserRole } from "../../../common/constants/roles.enum";

@ApiTags("menu-import")
@Controller("menu/import")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MenuImportController {
  constructor(
    private readonly menuImport: MenuImportService,
    private readonly menuSource: MenuSourceService,
  ) {}

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
  async parse(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Request() req,
  ) {
    const images = (files ?? []).map((f) => ({
      buffer: f.buffer,
      mimetype: f.mimetype,
    }));
    return this.menuImport.parseMenuPhotos(req.tenantId, images);
  }

  // NOT gated with @RequiresFeature here, unlike photo parse: a
  // recognised-header CSV/XLSX never calls the model at all (same free
  // bulk-entry capability BulkAddModal already gets ungated), so gating the
  // whole endpoint would block that path along with the AI ones. The three
  // paths that actually spend a model call — PDF, HTML/text, and the
  // unrecognised-header column-map fallback — assert the entitlement
  // themselves inside MenuSourceService, before any credit is claimed.
  @Post("parse-source")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiConsumes("multipart/form-data", "application/json")
  @ApiOperation({
    summary:
      "Import a menu from a link or an uploaded PDF/CSV/XLSX (no persistence)",
  })
  @UseInterceptors(
    FilesInterceptor("file", 1, {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async parseSource(
    @Body() dto: ParseMenuSourceDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Request() req,
  ) {
    const f = (files ?? [])[0];
    // Same read EntitlementGuard uses (entitlement.guard.ts) — a grant can
    // be branch-scoped, so this must reach MenuSourceService's entitlement
    // check or it 403s a branch the guard-gated photo endpoint would allow.
    const branchId: string | null = req.scope?.branchId ?? null;
    const draft = await this.menuSource.parseSource(
      req.tenantId,
      {
        url: dto.url,
        file: f
          ? {
              buffer: f.buffer,
              mimetype: f.mimetype,
              originalname: f.originalname,
            }
          : undefined,
      },
      branchId,
    );
    // Mark what already exists so the grid can offer a choice.
    return this.menuImport.annotateConflicts(draft, req.tenantId);
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
