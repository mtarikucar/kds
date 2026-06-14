import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { IngredientMovementsService } from "../services/ingredient-movements.service";
import { CreateIngredientMovementDto } from "../dto/create-ingredient-movement.dto";
import { ListIngredientMovementsQueryDto } from "../dto/list-stock-logs.dto";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";

@ApiTags("stock-management/movements")
@ApiBearerAuth()
@Controller("stock-management/movements")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class IngredientMovementsController {
  constructor(private readonly service: IngredientMovementsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Get all ingredient movements" })
  findAll(
    @CurrentScope() scope: BranchScope,
    @Query() query: ListIngredientMovementsQueryDto,
  ) {
    return this.service.findAll(scope, query);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Create a manual ingredient movement" })
  create(@Body() dto: CreateIngredientMovementDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }
}
