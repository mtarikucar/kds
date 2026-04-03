import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingTasksService } from '../services/marketing-tasks.service';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { TaskFilterDto } from '../dto/task-filter.dto';

@Controller('marketing/tasks')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingTasksController {
  constructor(private readonly tasksService: MarketingTasksService) {}

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentMarketingUser() user: any) {
    return this.tasksService.create(dto, user.id);
  }

  @Get()
  findAll(@Query() filter: TaskFilterDto, @CurrentMarketingUser() user: any) {
    return this.tasksService.findAll(filter, user.id, user.role);
  }

  @Get('today')
  findToday(@CurrentMarketingUser() user: any) {
    return this.tasksService.findToday(user.id, user.role);
  }

  @Get('overdue')
  findOverdue(@CurrentMarketingUser() user: any) {
    return this.tasksService.findOverdue(user.id, user.role);
  }

  @Get('calendar')
  findCalendar(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @CurrentMarketingUser() user: any,
  ) {
    return this.tasksService.findCalendar(dateFrom, dateTo, user.id, user.role);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentMarketingUser() user: any,
  ) {
    return this.tasksService.update(id, dto, user.id, user.role);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.tasksService.complete(id, user.id, user.role);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentMarketingUser() user: any) {
    return this.tasksService.delete(id, user.id, user.role);
  }
}
