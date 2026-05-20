import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { LegalDocumentsService } from "../services/legal-documents.service";
import { LegalDocumentKind } from "../constants";
import { Public } from "../../auth/decorators/public.decorator";

@ApiTags("Legal")
@Controller("legal/documents")
export class LegalPublicController {
  constructor(private readonly service: LegalDocumentsService) {}

  /**
   * Active version of a legal document. Public — the /legal/kvkk page
   * and the checkout checkbox both call this without auth. The reply
   * includes `id` because the frontend echoes it back in the
   * create-intent payload as `acceptedDocumentIds`.
   */
  @Public()
  @Get(":kind/current")
  @ApiOperation({
    summary: "Get the currently active version of a legal document",
  })
  @ApiParam({
    name: "kind",
    enum: LegalDocumentKind,
    description:
      "KVKK / DISTANCE_SALES / REFUND_POLICY / TERMS_OF_SERVICE / PRIVACY_POLICY",
  })
  @ApiQuery({ name: "locale", required: false, example: "tr" })
  async getCurrent(
    @Param("kind") kind: string,
    @Query("locale") locale = "tr",
  ) {
    if (!(Object.values(LegalDocumentKind) as string[]).includes(kind)) {
      throw new NotFoundException(`Unknown legal document kind: ${kind}`);
    }
    return this.service.getCurrent(kind as LegalDocumentKind, locale);
  }
}
