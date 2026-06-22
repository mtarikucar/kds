import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { MachineAuth } from "../../auth/decorators/machine-auth.decorator";
import { ScreenTokenGuard } from "../guards/screen-token.guard";
import { ScreenScopeGuard } from "../guards/screen-scope.guard";
import { RequireScope } from "../decorators/require-scope.decorator";
import { PrismaService } from "../../../prisma/prisma.service";
import { MenuQueryService } from "../../menu/services/menu-query.service";
import { CustomerOrdersService } from "../../customer-orders/services/customer-orders.service";
import { SelfPayQueryService } from "../../customer-orders/services/self-pay-query.service";
import { SelfPayIntentService } from "../../customer-orders/services/self-pay-intent.service";
import { CreateCustomerOrderDto } from "../../customer-orders/dto/create-customer-order.dto";
import {
  CreateBillRequestDto,
  CreateWaiterRequestDto,
} from "../../customer-orders/dto/waiter-request.dto";
import { CreatePayIntentDto } from "../../customer-orders/dto/pay-intent.dto";
import { getClientIp } from "../../../common/helpers/client-ip.helper";
import { CreateDisplayOrderDto } from "../dto/create-display-order.dto";
import { CreateDisplayRequestDto } from "../dto/create-display-request.dto";
import { CreateDisplayPayIntentDto } from "../dto/create-display-pay-intent.dto";

/**
 * Partner /display surface — thin ADAPTERS over the existing customer-orders /
 * self-pay / qr-menu services. Each handler reads the authenticated screen
 * token (req.screen, set by ScreenTokenGuard) and supplies its
 * orderingSessionId / tableId / venue coords to the unchanged services, so
 * NO order/payment/menu logic is reimplemented here. ScreenScopeGuard enforces
 * the per-endpoint @RequireScope against req.screen.scopes.
 */
@ApiTags("Partner · Display")
@ApiSecurity("Screen")
@MachineAuth()
@UseGuards(ScreenTokenGuard, ScreenScopeGuard)
@Controller("v1/display")
export class DisplayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menuQuery: MenuQueryService,
    private readonly customerOrders: CustomerOrdersService,
    private readonly selfPayQuery: SelfPayQueryService,
    private readonly selfPayIntent: SelfPayIntentService,
  ) {}

  @Get("menu")
  @RequireScope("menu:read")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Public menu for the screen's tenant (+ table)" })
  getMenu(@Req() req: any) {
    return this.menuQuery.getPublicMenu(req.screen.tenantId, {
      tableId: req.screen.tableId ?? undefined,
    });
  }

  @Get("orders")
  @RequireScope("orders:read")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Orders placed by this screen's ordering session" })
  getOrders(@Req() req: any) {
    return this.customerOrders.getSessionOrders(req.screen.orderingSessionId);
  }

  @Post("orders")
  @RequireScope("orders:write")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Place an order from the screen" })
  async createOrder(@Req() req: any, @Body() body: CreateDisplayOrderDto) {
    // Geofence: createOrder 400s when the tenant has coords configured and
    // the order lacks them. The screen is installed AT the venue, so we pass
    // the tenant's own coords (read once) — no service change needed.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: req.screen.tenantId },
      select: { latitude: true, longitude: true },
    });

    const dto: CreateCustomerOrderDto = {
      sessionId: req.screen.orderingSessionId,
      tableId: req.screen.tableId ?? undefined,
      items: body.items,
      type: body.type,
      notes: body.notes,
      latitude: tenant?.latitude != null ? Number(tenant.latitude) : undefined,
      longitude:
        tenant?.longitude != null ? Number(tenant.longitude) : undefined,
    };
    return this.customerOrders.createOrder(dto);
  }

  @Post("waiter-requests")
  @RequireScope("requests:write")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Call a waiter for the screen's table" })
  createWaiterRequest(@Req() req: any, @Body() body: CreateDisplayRequestDto) {
    const dto: CreateWaiterRequestDto = {
      sessionId: req.screen.orderingSessionId,
      tableId: req.screen.tableId ?? undefined,
      message: body.message,
    };
    return this.customerOrders.createWaiterRequest(dto);
  }

  @Post("bill-requests")
  @RequireScope("requests:write")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Request the bill for the screen's table" })
  createBillRequest(@Req() req: any, @Body() _body: CreateDisplayRequestDto) {
    const dto: CreateBillRequestDto = {
      sessionId: req.screen.orderingSessionId,
      tableId: req.screen.tableId ?? undefined,
    };
    return this.customerOrders.createBillRequest(dto);
  }

  @Get("payable-items")
  @RequireScope("payments:write")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Items the screen's session can settle" })
  getPayableItems(@Req() req: any) {
    return this.selfPayQuery.getPayableItemsForSession(
      req.screen.orderingSessionId,
    );
  }

  @Post("pay-intent")
  @RequireScope("payments:write")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Create a PayTR hosted-iframe self-pay intent" })
  async createPayIntent(
    @Req() req: any,
    @Body() body: CreateDisplayPayIntentDto,
  ) {
    const ip = getClientIp(req) || req?.connection?.remoteAddress || "0.0.0.0";
    // Return origin is taken from the partner key's allowlist (the partner's
    // own host), never from a client-supplied header — the screen has no
    // browser Origin we can trust. allowedReturnOrigins[0] when set.
    const key = await this.prisma.partnerApiKey.findUnique({
      where: { id: req.screen.partnerApiKeyId },
      select: { allowedReturnOrigins: true },
    });
    const returnOrigin = key?.allowedReturnOrigins?.[0];
    // DTO is structurally the existing CreatePayIntentDto (items + phone).
    return this.selfPayIntent.createPayIntent(
      req.screen.orderingSessionId,
      body as unknown as CreatePayIntentDto,
      ip,
      returnOrigin,
    );
  }

  @Get("pay-status")
  @RequireScope("payments:write")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Poll a self-pay intent's status" })
  getPayStatus(@Req() req: any, @Query("oid") oid: string) {
    return this.selfPayQuery.getPayStatus(req.screen.orderingSessionId, oid);
  }
}
