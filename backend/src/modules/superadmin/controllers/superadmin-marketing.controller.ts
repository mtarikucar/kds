import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { Response } from "express";
import { SuperAdminGuard } from "../guards/superadmin.guard";
import { SuperAdminRoute } from "../decorators/superadmin.decorator";
import { CurrentSuperAdmin } from "../decorators/current-superadmin.decorator";
import { SuperAdminMarketingService } from "../services/superadmin-marketing.service";

class UpdateMarketerStatusDto {
  @IsIn(["ACTIVE", "INACTIVE"])
  status!: "ACTIVE" | "INACTIVE";
}

class BulkApproveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}

class MarketerFilterDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(["SALES_MANAGER", "SALES_REP"]) role?:
    | "SALES_MANAGER"
    | "SALES_REP";
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

class CommissionFilterDto {
  @IsOptional() @IsIn(["SIGNUP", "RENEWAL", "UPSELL"]) type?:
    | "SIGNUP"
    | "RENEWAL"
    | "UPSELL";
  @IsOptional() @IsIn(["PENDING", "APPROVED", "PAID"]) status?:
    | "PENDING"
    | "APPROVED"
    | "PAID";
  @IsOptional() @IsString() marketingUserId?: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() period?: string;
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

@ApiTags("SuperAdmin Marketing")
@Controller("superadmin")
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminMarketingController {
  constructor(private readonly marketingService: SuperAdminMarketingService) {}

  // ---------- Marketers ----------

  @Get("marketers")
  @ApiOperation({
    summary: "List all platform marketers with lifetime aggregates",
  })
  listMarketers(@Query() filter: MarketerFilterDto) {
    return this.marketingService.listMarketers({
      ...filter,
      page: filter.page ? Number(filter.page) : undefined,
      limit: filter.limit ? Number(filter.limit) : undefined,
    });
  }

  @Get("marketers/:id")
  @ApiOperation({
    summary: "Get marketer detail with recent leads / commissions",
  })
  getMarketer(@Param("id") id: string) {
    return this.marketingService.getMarketer(id);
  }

  @Patch("marketers/:id/status")
  @ApiOperation({ summary: "Activate or deactivate a marketer" })
  updateStatus(@Param("id") id: string, @Body() dto: UpdateMarketerStatusDto) {
    return this.marketingService.updateMarketerStatus(id, dto.status);
  }

  @Post("marketers/:id/regenerate-referral-code")
  @ApiOperation({
    summary: "Rotate a marketer referral code (old code becomes free)",
  })
  regenerateCode(
    @Param("id") id: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.marketingService.regenerateReferralCode(
      id,
      actorEmail ?? "unknown",
    );
  }

  // ---------- Commissions ----------

  @Get("commissions")
  @ApiOperation({
    summary: "List platform-wide commissions with filters + summary totals",
  })
  listCommissions(@Query() filter: CommissionFilterDto) {
    return this.marketingService.listCommissions({
      ...filter,
      page: filter.page ? Number(filter.page) : undefined,
      limit: filter.limit ? Number(filter.limit) : undefined,
    });
  }

  @Post("commissions/bulk-approve")
  @ApiOperation({
    summary:
      "Bulk-approve PENDING commissions. Skips rows that are not PENDING or have zero amount; " +
      'the audit log carries actorType="SUPERADMIN" and the SA email for traceability.',
  })
  bulkApprove(
    @Body() dto: BulkApproveDto,
    @CurrentSuperAdmin("id") actorId: string,
    @CurrentSuperAdmin("email") actorEmail: string,
  ) {
    return this.marketingService.bulkApproveCommissions(
      dto.ids,
      actorId,
      actorEmail ?? "unknown",
    );
  }

  @Get("commissions/export.csv")
  @ApiOperation({
    summary: "CSV export of commissions matching the given filter",
  })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="commissions.csv"')
  async exportCsv(@Query() filter: CommissionFilterDto, @Res() res: Response) {
    const csv = await this.marketingService.exportCommissionsCsv(filter);
    res.send(csv);
  }
}
