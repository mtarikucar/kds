import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('tables')
@ApiBearerAuth()
@Controller('tables')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new table (ADMIN, MANAGER)' })
  @ApiResponse({ status: 201, description: 'Table successfully created' })
  @ApiResponse({ status: 409, description: 'Table number already exists' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() createTableDto: CreateTableDto, @Request() req) {
    return this.tablesService.create(createTableDto, req.tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tables' })
  @ApiQuery({ name: 'section', required: false, description: 'Filter by section' })
  @ApiResponse({ status: 200, description: 'List of all tables' })
  findAll(@Request() req, @Query('section') section?: string) {
    return this.tablesService.findAll(req.tenantId, section);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a table by ID' })
  @ApiResponse({ status: 200, description: 'Table details with active orders' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.tablesService.findOne(id, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a table (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Table successfully updated' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  @ApiResponse({ status: 409, description: 'Table number already exists' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(
    @Param('id') id: string,
    @Body() updateTableDto: UpdateTableDto,
    @Request() req,
  ) {
    console.log('Received update payload:', JSON.stringify(updateTableDto, null, 2));
    console.log('Status value:', updateTableDto.status);
    console.log('Status type:', typeof updateTableDto.status);
    return this.tablesService.update(id, updateTableDto, req.tenantId);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Update table status (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'Table status successfully updated' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateTableStatusDto,
    @Request() req,
  ) {
    return this.tablesService.updateStatus(id, updateStatusDto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a table (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Table successfully deleted' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  @ApiResponse({ status: 409, description: 'Table has active orders' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    return this.tablesService.remove(id, req.tenantId);
  }
}
