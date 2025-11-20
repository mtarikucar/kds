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
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ZReportsService } from './z-reports.service';
import { CreateZReportDto } from './dto/create-z-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('z-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('z-reports')
export class ZReportsController {
  constructor(private readonly zReportsService: ZReportsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Generate a new Z-Report' })
  async generate(@Req() req, @Body() createDto: CreateZReportDto) {
    return this.zReportsService.generateReport(req.user.tenantId, createDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all Z-Reports' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async findAll(@Req() req, @Query() query: any) {
    return this.zReportsService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a specific Z-Report' })
  async findOne(@Req() req, @Param('id') id: string) {
    return this.zReportsService.findOne(id, req.user.tenantId);
  }

  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Download Z-Report as PDF' })
  async downloadPdf(
    @Req() req,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.zReportsService.generatePdf(id, req.user.tenantId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=z-report-${id}.pdf`,
    );
    res.send(pdf);
  }

  @Patch(':id/close')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Close/finalize a Z-Report' })
  async close(@Req() req, @Param('id') id: string) {
    return this.zReportsService.closeReport(id, req.user.tenantId);
  }
}
