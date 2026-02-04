import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AuditFilterDto,
  AuditExportDto,
  ExportFormat,
  AuditAction,
  EntityType,
} from '../dto/audit-filter.dto';

export interface AuditLogEntry {
  action: AuditAction;
  entityType: EntityType;
  entityId?: string;
  actorId: string;
  actorEmail: string;
  previousData?: any;
  newData?: any;
  metadata?: any;
  targetTenantId?: string;
  targetTenantName?: string;
}

@Injectable()
export class SuperAdminAuditService {
  constructor(private prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        previousData: entry.previousData,
        newData: entry.newData,
        metadata: entry.metadata,
        targetTenantId: entry.targetTenantId,
        targetTenantName: entry.targetTenantName,
      },
    });
  }

  async findAll(filters: AuditFilterDto) {
    const {
      action,
      entityType,
      actorId,
      targetTenantId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = filters;

    const where: any = {};

    if (action) {
      where.action = action;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (actorId) {
      where.actorId = actorId;
    }

    if (targetTenantId) {
      where.targetTenantId = targetTenantId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async export(filters: AuditExportDto): Promise<string> {
    const { format = ExportFormat.CSV, ...filterParams } = filters;

    // Remove pagination for export
    const where: any = {};

    if (filters.action) {
      where.action = filters.action;
    }

    if (filters.entityType) {
      where.entityType = filters.entityType;
    }

    if (filters.actorId) {
      where.actorId = filters.actorId;
    }

    if (filters.targetTenantId) {
      where.targetTenantId = filters.targetTenantId;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000, // Limit export to 10k records
    });

    if (format === ExportFormat.JSON) {
      return JSON.stringify(logs, null, 2);
    }

    // CSV format
    const headers = [
      'ID',
      'Action',
      'Entity Type',
      'Entity ID',
      'Actor ID',
      'Actor Email',
      'Target Tenant ID',
      'Target Tenant Name',
      'Created At',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.action,
      log.entityType,
      log.entityId || '',
      log.actorId,
      log.actorEmail,
      log.targetTenantId || '',
      log.targetTenantName || '',
      log.createdAt.toISOString(),
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join(
      '\n',
    );

    return csv;
  }

  async getRecentActivity(limit: number = 10) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
