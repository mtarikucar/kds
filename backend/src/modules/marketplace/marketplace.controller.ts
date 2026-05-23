import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { AddOnCatalogService } from './addon-catalog.service';
import { TenantMarketplaceService } from './tenant-marketplace.service';
import { PurchaseAddOnDto } from './dto/addon.dto';

@ApiTags('Marketplace')
@Controller('v1/marketplace')
export class MarketplaceController {
  constructor(
    private readonly catalog: AddOnCatalogService,
    private readonly tenant: TenantMarketplaceService,
  ) {}

  // Public catalog endpoint — visible from the landing site, no auth needed.
  // Returns only `published` rows.
  @Public()
  @Get('addons')
  @ApiOperation({ summary: 'Public marketplace catalogue (published add-ons)' })
  list(@Query('kind') kind?: string) {
    return this.catalog.listPublic().then((rows) =>
      kind ? rows.filter((r) => r.kind === kind) : rows,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('addons/mine')
  @ApiOperation({ summary: 'List add-ons currently held by the authenticated tenant' })
  mine(@Req() req: any) {
    return this.tenant.listMine(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('addons/purchase')
  @ApiOperation({ summary: 'Purchase / activate an add-on for the authenticated tenant' })
  purchase(@Req() req: any, @Body() dto: PurchaseAddOnDto) {
    return this.tenant.purchase(req.user.tenantId, {
      addOnCode: dto.addOnCode,
      quantity: dto.quantity,
      branchId: dto.branchId,
    });
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('addons/:tenantAddOnId')
  @ApiOperation({ summary: 'Cancel a held add-on (at period end by default)' })
  cancel(
    @Req() req: any,
    @Param('tenantAddOnId') id: string,
    @Query('immediate') immediate?: string,
  ) {
    return this.tenant.cancel(req.user.tenantId, id, immediate === 'true');
  }
}
