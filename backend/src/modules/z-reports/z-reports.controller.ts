import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Req,
  HttpStatus,
  Patch,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { ZReportsService } from "./z-reports.service";
import { CreateZReportDto } from "./dto/create-z-report.dto";
import { QueryZReportDto } from "./dto/query-z-report.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";
import { UserRole } from "../../common/constants/roles.enum";

@ApiTags("z-reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller("z-reports")
export class ZReportsController {
  constructor(private readonly zReportsService: ZReportsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Generate a new Z-Report" })
  async generate(
    @CurrentScope() scope: BranchScope,
    @Req() req,
    @Body() createDto: CreateZReportDto,
  ) {
    return this.zReportsService.generateReport(
      scope.tenantId,
      scope.branchId,
      scope.userId ?? req.user.id,
      createDto,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get all Z-Reports" })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "startDate", required: false })
  @ApiQuery({ name: "endDate", required: false })
  async findAll(
    @CurrentScope() scope: BranchScope,
    @Query() query: QueryZReportDto,
  ) {
    return this.zReportsService.findAll(scope, query);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get a specific Z-Report" })
  async findOne(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.zReportsService.findOne(id, scope);
  }

  @Get(":id/pdf")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Download Z-Report as PDF" })
  async downloadPdf(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.zReportsService.generatePdf(id, scope);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=z-report-${id}.pdf`,
    );
    res.send(pdf);
  }

  @Patch(":id/close")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Close/finalize a Z-Report" })
  async close(
    @CurrentScope() scope: BranchScope,
    @Req() req,
    @Param("id") id: string,
  ) {
    return this.zReportsService.closeReport(
      id,
      scope,
      scope.userId ?? req.user.id,
    );
  }

  @Post(":id/send-email")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Send Z-Report via email" })
  async sendEmail(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
    @Body() body: { emails?: string[] },
  ) {
    return this.zReportsService.sendReportEmail(id, scope, body.emails);
  }
}
