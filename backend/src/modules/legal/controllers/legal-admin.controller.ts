import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { LegalDocumentsService } from "../services/legal-documents.service";
import { LegalDocumentKind } from "../constants";
import { PublishLegalDocumentDto } from "../dto/publish-document.dto";
import { SuperAdminGuard } from "../../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../../superadmin/decorators/superadmin.decorator";

/**
 * Cross-tenant legal-document management. SuperAdmin only — tenants
 * cannot edit their own KVKK / mesafeli / iade contracts; these are
 * the platform operator's documents and apply uniformly.
 */
@ApiTags("SuperAdmin Legal")
@Controller("superadmin/legal/documents")
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class LegalAdminController {
  constructor(private readonly service: LegalDocumentsService) {}

  @Get()
  @ApiOperation({
    summary: "List all legal-document versions (active + historical)",
  })
  async list(
    @Query("kind") kind?: LegalDocumentKind,
    @Query("locale") locale?: string,
  ) {
    return this.service.listAll(kind, locale);
  }

  @Post("publish")
  @ApiOperation({
    summary:
      "Publish a new version. Atomically flips the previous isCurrent row to false.",
  })
  async publish(@Body() dto: PublishLegalDocumentDto) {
    return this.service.publish(dto);
  }
}
