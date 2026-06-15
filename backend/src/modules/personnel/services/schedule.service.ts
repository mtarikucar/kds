import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";
import { AssignShiftDto, BulkAssignShiftDto } from "../dto/assign-shift.dto";

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async getWeeklySchedule(scope: BranchScope, weekStart?: string) {
    const start = weekStart ? new Date(weekStart) : this.getMonday(new Date());
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const assignments = await this.prisma.shiftAssignment.findMany({
      where: {
        ...branchScope(scope),
        date: { gte: start, lte: end },
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        shiftTemplate: true,
      },
      orderBy: [{ date: "asc" }, { user: { firstName: "asc" } }],
    });

    // Staff roster scoped to the active branch. A user is schedulable here
    // if EITHER this is their primaryBranchId OR they're assigned to roam
    // here via the m:n UserBranchAssignment allow-list (primary elsewhere).
    // Filtering on primaryBranchId alone hid assignable roamers from the
    // branch's scheduler.
    const staff = await this.prisma.user.findMany({
      where: {
        tenantId: scope.tenantId,
        status: "ACTIVE",
        OR: [
          { primaryBranchId: scope.branchId },
          {
            branchAssignments: {
              some: { tenantId: scope.tenantId, branchId: scope.branchId },
            },
          },
        ],
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: "asc" },
    });

    return { weekStart: start, weekEnd: end, assignments, staff };
  }

  async assign(scope: BranchScope, dto: AssignShiftDto) {
    const tenantId = scope.tenantId;
    // Validate user belongs to tenant
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId },
    });
    if (!user) throw new NotFoundException("User not found in this tenant");

    // Validate shift template belongs to THIS BRANCH (not just the
    // tenant). Scoping by tenantId alone let a B1 manager pass a B2
    // template id and have the assignment silently land in B2 (the
    // write path below derives branchId from the template). Spreading
    // branchScope(scope) confines the lookup to the actor's active
    // branch, so an out-of-branch template id 404s instead of leaking.
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: dto.shiftTemplateId, ...branchScope(scope) },
    });
    if (!template) throw new NotFoundException("Shift template not found");

    const date = new Date(dto.date);
    date.setHours(0, 0, 0, 0);

    try {
      return await this.prisma.shiftAssignment.create({
        data: {
          userId: dto.userId,
          shiftTemplateId: dto.shiftTemplateId,
          date,
          notes: dto.notes,
          tenantId,
          // Write-path branchId stays derived from the template — the
          // assignment lives where the template lives, not necessarily
          // the actor's active branch.
          branchId: template.branchId,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, role: true },
          },
          shiftTemplate: true,
        },
      });
    } catch (error: any) {
      // v3 branch-scope: the unique key is now [userId, date, branchId],
      // so this P2002 only fires when the user is already assigned for the
      // SAME date IN THE SAME branch — a user CAN now hold a shift in two
      // different branches on the same date. ShiftAssignment carries no
      // other unique constraint, so a P2002 here unambiguously maps to the
      // per-(user, date, branch) collision below.
      if (error.code === "P2002") {
        throw new BadRequestException(
          "User already has a shift assigned for this date in this branch",
        );
      }
      throw error;
    }
  }

  async assignBulk(scope: BranchScope, dto: BulkAssignShiftDto) {
    const successes = [];
    const failures = [];
    for (const assignment of dto.assignments) {
      try {
        const result = await this.assign(scope, assignment);
        successes.push(result);
      } catch (error: any) {
        failures.push({ error: error.message, assignment });
      }
    }
    return { successes, failures, total: dto.assignments.length };
  }

  async remove(scope: BranchScope, id: string) {
    // Branch-scope the read AND the delete. Filtering on tenantId alone
    // let a B1 manager delete a B2 branch's assignment by id (assignments
    // are per-branch physical rows). branchScope(scope) confines both the
    // existence check and the deleteMany to the actor's active branch, so
    // an out-of-branch id 404s instead of being silently removed.
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { id, ...branchScope(scope) },
    });

    if (!assignment) {
      throw new NotFoundException("Shift assignment not found");
    }

    // Defence-in-depth: branch scope in the WHERE (B41-B45 pattern).
    const result = await this.prisma.shiftAssignment.deleteMany({
      where: { id, ...branchScope(scope) },
    });
    if (result.count === 0) {
      throw new NotFoundException("Shift assignment not found");
    }
    return { id };
  }

  private getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
  }
}
