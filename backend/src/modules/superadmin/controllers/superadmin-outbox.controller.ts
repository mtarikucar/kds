import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SuperAdminOutboxService } from '../services/superadmin-outbox.service';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminRoute } from '../decorators/superadmin.decorator';

interface ListFailedQuery {
  tenantId?: string;
  type?: string;
  limit?: string;
  cursor?: string;
}

interface RequeueBody {
  ids: string[];
  resetAttempts?: boolean;
}

@ApiTags('SuperAdmin Outbox')
@Controller('superadmin/outbox')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminOutboxController {
  constructor(private readonly outbox: SuperAdminOutboxService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Counts per status — queued/dispatching/dispatched/failed' })
  summary() {
    return this.outbox.summary();
  }

  @Get('failed')
  @ApiOperation({ summary: 'List events that exhausted retries (DLQ readout)' })
  listFailed(@Query() q: ListFailedQuery) {
    return this.outbox.listFailed({
      tenantId: q.tenantId,
      type: q.type,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      cursor: q.cursor,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full payload + envelope of a single outbox event' })
  getEvent(@Param('id') id: string) {
    return this.outbox.getEvent(id);
  }

  @Post('requeue')
  @ApiOperation({ summary: 'Re-queue one or more failed events for the worker' })
  requeue(@Body() body: RequeueBody) {
    return this.outbox.requeue(body?.ids ?? [], { resetAttempts: body?.resetAttempts });
  }
}
