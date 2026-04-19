import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { MailerService } from './mailer.service';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private prisma: PrismaService,
    private mailerService: MailerService,
  ) {}

  async create(dto: CreateContactDto) {
    // Honeypot: silently accept-and-ignore rather than throwing so bots can't
    // probe whether the field is being inspected.
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn(`Honeypot triggered from contact form (${dto.email})`);
      return {
        success: true,
        message: 'Your message has been sent successfully. We will get back to you soon!',
      };
    }

    const contactMessage = await this.prisma.contactMessage.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        message: dto.message,
        status: 'NEW',
      },
    });
    this.logger.log(`New contact message ${contactMessage.id} from ${dto.email}`);

    // Only admin notification is emailed. User confirmation was previously
    // sent to the submitter-supplied email address, which turned the SMTP
    // sender into a spam cannon (attacker posts `email = victim@...`). The
    // in-page success toast is sufficient confirmation for real users.
    const adminSent = await this.mailerService.sendAdminNotification({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
    });
    if (!adminSent) {
      this.logger.warn(`Admin notification not sent for contact ${contactMessage.id}`);
    }

    return {
      success: true,
      message: 'Your message has been sent successfully. We will get back to you soon!',
    };
  }

  async findAll(page = 1, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.contactMessage.count(),
    ]);
    return { data, total, page: safePage, pageSize: safeLimit };
  }

  async findOne(id: string) {
    const row = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Contact message not found');
    return row;
  }

  async markAsRead(id: string) {
    const result = await this.prisma.contactMessage.updateMany({
      where: { id },
      data: { status: 'READ' },
    });
    if (result.count !== 1) throw new NotFoundException('Contact message not found');
    return this.findOne(id);
  }
}
