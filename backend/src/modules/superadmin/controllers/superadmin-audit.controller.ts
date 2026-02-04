import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { SuperAdminAuditService } from '../services/superadmin-audit.service';
import { AuditFilterDto, AuditExportDto, ExportFormat } from '../dto/audit-filter.dto';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminRoute } from '../decorators/superadmin.decorator';

@ApiTags('SuperAdmin Audit')
@Controller('superadmin/audit-logs')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminAuditController {
  constructor(private readonly auditService: SuperAdminAuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit logs with pagination and filters' })
  async findAll(@Query() filters: AuditFilterDto) {
    return this.auditService.findAll(filters);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export audit logs to CSV or JSON' })
  async export(@Query() filters: AuditExportDto, @Res() res: Response) {
    const data = await this.auditService.export(filters);
    const format = filters.format || ExportFormat.CSV;

    if (format === ExportFormat.JSON) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=audit-logs.json',
      );
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=audit-logs.csv',
      );
    }

    res.send(data);
  }
}
