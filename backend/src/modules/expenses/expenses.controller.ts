import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { ExpensesService } from "./expenses.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import { LockPeriodDto } from "./dto/lock-period.dto";
import { SetBudgetDto } from "./dto/set-budget.dto";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";

@ApiTags("expenses")
@ApiBearerAuth()
@Controller("expenses")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Record an operating expense" })
  create(@CurrentScope() scope: BranchScope, @Body() dto: CreateExpenseDto) {
    return this.service.create(scope, scope.userId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "List expenses" })
  list(
    @CurrentScope() scope: BranchScope,
    @Query("category") category?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.service.list(scope, { category, startDate, endDate });
  }

  @Get("summary")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Expense totals by category for a window" })
  summary(
    @CurrentScope() scope: BranchScope,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.service.summary(
      scope.tenantId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      scope.branchId,
    );
  }

  @Post("budget")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Set (upsert) a monthly category budget" })
  setBudget(@CurrentScope() scope: BranchScope, @Body() dto: SetBudgetDto) {
    return this.service.setBudget(scope, dto);
  }

  @Get("budget-vs-actual")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Budget vs actual expenses for a month" })
  budgetVsActual(
    @CurrentScope() scope: BranchScope,
    @Query("year") year: string,
    @Query("month") month: string,
  ) {
    return this.service.getBudgetVsActual(
      scope,
      parseInt(year, 10),
      parseInt(month, 10),
    );
  }

  @Put("period-lock")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Lock an accounting period (year + month)" })
  lockPeriod(@CurrentScope() scope: BranchScope, @Body() dto: LockPeriodDto) {
    return this.service.lockPeriod(scope, dto);
  }

  @Delete("period-lock/:year/:month")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Unlock an accounting period" })
  unlockPeriod(
    @CurrentScope() scope: BranchScope,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    return this.service.unlockPeriod(scope, year, month);
  }

  @Get("period-locks")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "List locked accounting periods" })
  listPeriodLocks(@CurrentScope() scope: BranchScope) {
    return this.service.listPeriodLocks(scope);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update an expense" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.service.update(scope, id, dto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Delete an expense" })
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.remove(scope, id);
  }
}
