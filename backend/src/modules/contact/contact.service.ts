import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private prisma: PrismaService,
  ) {}

  async create(createContactDto: CreateContactDto) {
    try {
      // Save to database
      const contactMessage = await this.prisma.contactMessage.create({
        data: {
          name: createContactDto.name,
          email: createContactDto.email,
          phone: createContactDto.phone,
          message: createContactDto.message,
          status: 'NEW',
        },
      });

      this.logger.log(`New contact message received from ${createContactDto.email}`);

      // TODO: Send email notification (requires MailerModule configuration)
      // For now, messages are only saved to database and can be viewed in admin panel

      return {
        success: true,
        message: 'Your message has been sent successfully. We will get back to you soon!',
      };
    } catch (error) {
      this.logger.error(`Failed to create contact message: ${error.message}`);
      throw error;
    }
  }

  async findAll() {
    return this.prisma.contactMessage.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.contactMessage.findUnique({
      where: { id },
    });
  }

  async markAsRead(id: string) {
    return this.prisma.contactMessage.update({
      where: { id },
      data: { status: 'READ' },
    });
  }
}
