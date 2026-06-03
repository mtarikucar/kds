import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ContactService } from "./contact.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { Public } from "../auth/decorators/public.decorator";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";

@ApiTags("contact")
@Controller("contact")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  // 3 submissions per IP per hour. Paired with the honeypot field in the DTO
  // and CRLF-guarded fields; without this the public form becomes a trivial
  // SMTP open-relay for spammers.
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @Post()
  @ApiOperation({ summary: "Submit a contact form message (Public endpoint)" })
  @ApiResponse({ status: 201, description: "Message sent successfully" })
  create(@Body() createContactDto: CreateContactDto) {
    return this.contactService.create(createContactDto);
  }

  // Admin moderation endpoints — SuperAdmin only.
  //
  // ContactMessage is a PLATFORM-LEVEL model (no tenantId; messages are
  // addressed to HummyTummy itself via the marketing landing form, often
  // about competitors, partnership requests, or platform billing). The
  // earlier @Roles(UserRole.ADMIN) used the tenant-realm ADMIN role, so
  // every restaurant tenant's admin could enumerate every contact-form
  // submission to the platform — name, email, phone, message body. Same
  // privilege issue iter-51 closed on PublicReview. Switch to
  // SuperAdminGuard so only platform operators can read inbound mail.
  @UseGuards(SuperAdminGuard)
  @SuperAdminRoute()
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get paginated contact messages (SuperAdmin only)" })
  findAll(@Query("page") page?: string, @Query("limit") limit?: string) {
    const pageNum = page ? parseInt(page, 10) || 1 : 1;
    const limitNum = limit ? parseInt(limit, 10) || 50 : 50;
    return this.contactService.findAll(pageNum, limitNum);
  }

  @UseGuards(SuperAdminGuard)
  @SuperAdminRoute()
  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a single contact message (SuperAdmin only)" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.contactService.findOne(id);
  }

  @UseGuards(SuperAdminGuard)
  @SuperAdminRoute()
  @Patch(":id/read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Mark message as read (SuperAdmin only)" })
  markAsRead(@Param("id", ParseUUIDPipe) id: string) {
    return this.contactService.markAsRead(id);
  }
}
