import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCustomerDto, UpdateCustomerDto } from "./dto/customer.dto";
import { normalizePhone } from "./customers.helpers";
import { paginated } from "../../common/pagination";

const WAITER_CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  loyaltyPoints: true,
  loyaltyTier: true,
  totalOrders: true,
  createdAt: true,
} as const;

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCustomerDto, tenantId: string) {
    return this.prisma.customer.create({
      data: {
        name: data.name,
        phone: normalizePhone(data.phone),
        email: data.email,
        notes: data.notes,
        birthday: data.birthday ? new Date(data.birthday) : undefined,
        tenantId,
      },
    });
  }

  async findAll(
    tenantId: string,
    role: string | undefined,
    opts: { page?: number; limit?: number; search?: string } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
    const skip = (page - 1) * limit;

    // Iter-78: cap the search needle. opts.search feeds Prisma's
    // contains (ILIKE on name + email, regular LIKE on phone) — three
    // unindexed full-text scans per matching row. This endpoint is
    // accessible to WAITER (front-of-house POS), a much broader role
    // than the iter-74 users.findAll admin gate, so the abuse surface
    // is wider. 200 chars covers every realistic "find Mehmet" needle;
    // longer is not a use case here, and a stolen WAITER token posting
    // a 1MB string would otherwise trigger a 3 × 1MB ILIKE-scan per
    // customer row (10K rows → 30GB of comparison work).
    if (opts.search && opts.search.length > 200) {
      throw new BadRequestException("search must be 200 chars or less");
    }

    const where: Prisma.CustomerWhereInput = { tenantId };
    if (opts.search) {
      const term = opts.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { phone: { contains: term } },
        { email: { contains: term, mode: "insensitive" } },
      ];
    }

    // Front-of-house roles get a trimmed projection — WAITER doesn't need
    // totalSpent, birthday, preferences or notes on the POS customer list.
    const isPrivileged = role === "ADMIN" || role === "MANAGER";
    const select = isPrivileged ? undefined : WAITER_CUSTOMER_SELECT;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        ...(select ? { select } : {}),
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: { orders: { take: 10, orderBy: { createdAt: "desc" } } },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  async update(id: string, data: UpdateCustomerDto, tenantId: string) {
    // Tenant-scoped updateMany avoids TOCTOU between findFirst and update.
    const result = await this.prisma.customer.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: normalizePhone(data.phone) }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.birthday !== undefined && {
          birthday: data.birthday ? new Date(data.birthday) : null,
        }),
      },
    });
    if (result.count !== 1) throw new NotFoundException("Customer not found");
    return this.prisma.customer.findFirst({ where: { id, tenantId } });
  }

  async remove(id: string, tenantId: string) {
    try {
      const result = await this.prisma.customer.deleteMany({
        where: { id, tenantId },
      });
      if (result.count !== 1) throw new NotFoundException("Customer not found");
      return { id, deleted: true };
    } catch (err) {
      // LoyaltyTransaction.customer onDelete is Restrict (migration
      // 20260420180000) so a customer who has earned points cannot be
      // hard-deleted — the audit trail would vanish. Translate the P2003
      // to a clear 409 instead of bubbling up as an opaque 500; the admin
      // UI should steer operators toward the anonymize/soft-delete flow
      // (tracked as a deferred follow-up).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2003"
      ) {
        throw new ConflictException(
          "Cannot delete a customer with loyalty history. Anonymize the record instead.",
        );
      }
      throw err;
    }
  }

  /**
   * Mark a customer as phone-verified. This is deliberately NOT exposed via
   * the UpdateCustomerDto so staff cannot flip the flag manually — only the
   * server-validated OTP flow in PhoneVerificationService reaches this path.
   */
  async markPhoneVerified(customerId: string, tenantId: string) {
    await this.prisma.customer.updateMany({
      where: { id: customerId, tenantId },
      data: { phoneVerified: true },
    });
  }

  /**
   * Privileged internal admission path used by POS/order flows to bind a
   * phone-entered customer to an existing tenant record.
   */
  async findOrCreateByPhone(
    phone: string,
    tenantId: string,
    additional?: { name?: string; email?: string },
  ) {
    const canonical = normalizePhone(phone);
    const existing = await this.prisma.customer.findFirst({
      where: { phone: canonical, tenantId },
    });
    if (existing) return existing;

    // Backfill phoneVerified from the PhoneVerification source of truth. The
    // customer-facing OTP flow (sendOTP → verifyOTP) verifies a (phone,
    // tenant) BEFORE any Customer row necessarily exists — verifyOTP's
    // controller only calls markPhoneVerified `if (customer)`, so a phone
    // verified before its Customer is created would otherwise land here with
    // phoneVerified=false forever. Consumers gate on the Customer.phoneVerified
    // COLUMN (referral.applyReferralCode, self-pay), so that stale-false cache
    // would silently reject an already-verified phone. Any existing verified
    // PhoneVerification row means the phone is genuinely OTP-verified,
    // regardless of who creates the Customer row (QR self-serve or POS
    // admission), so the flag reflects reality.
    const priorVerification = await this.prisma.phoneVerification.findFirst({
      where: { phone: canonical, tenantId, verified: true },
      select: { id: true },
    });

    try {
      return await this.prisma.customer.create({
        data: {
          phone: canonical,
          name: additional?.name || `Customer ${canonical}`,
          email: additional?.email,
          tenantId,
          phoneVerified: !!priorVerification,
        },
      });
    } catch (err) {
      // Concurrent first-identify race: another request created the row
      // between the findFirst and create. Return the existing row instead
      // of surfacing a 500 to the caller.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const recovered = await this.prisma.customer.findFirst({
          where: { phone: canonical, tenantId },
        });
        if (recovered) return recovered;
      }
      throw err;
    }
  }

  async findByPhone(phone: string, tenantId: string) {
    return this.prisma.customer.findFirst({
      where: { phone: normalizePhone(phone), tenantId },
      include: {
        orders: { take: 10, orderBy: { createdAt: "desc" } },
        loyaltyTransactions: { take: 10, orderBy: { createdAt: "desc" } },
      },
    });
  }

  async updateStatistics(
    customerId: string,
    tenantId: string,
    orderAmount: number | Prisma.Decimal,
  ) {
    // Serializable isolation: the read-modify-write below is a classic
    // lost-update target — two concurrent orders for the same customer
    // would each read totalOrders=N, both write N+1, and the database
    // would land at N+1 instead of N+2. Postgres' default READ
    // COMMITTED doesn't catch this; Serializable does (the second tx
    // gets a 40001 and Prisma retries it).
    return this.prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, tenantId },
        });
        if (!customer) throw new NotFoundException("Customer not found");

        const amount = new Prisma.Decimal(orderAmount);
        const newTotalOrders = customer.totalOrders + 1;
        const newTotalSpent = new Prisma.Decimal(customer.totalSpent).add(
          amount,
        );
        const newAverageOrder = newTotalSpent.div(newTotalOrders);

        const result = await tx.customer.updateMany({
          where: { id: customerId, tenantId },
          data: {
            totalOrders: newTotalOrders,
            totalSpent: newTotalSpent,
            averageOrder: newAverageOrder,
            lastVisit: new Date(),
          },
        });
        if (result.count !== 1)
          throw new BadRequestException("Customer update race");
        return tx.customer.findFirstOrThrow({
          where: { id: customerId, tenantId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getAnalytics(
    tenantId: string,
    options?: { startDate?: Date; endDate?: Date },
  ) {
    const whereNew: Prisma.CustomerWhereInput = { tenantId };
    if (options?.startDate || options?.endDate) {
      whereNew.createdAt = {};
      if (options.startDate) whereNew.createdAt.gte = options.startDate;
      if (options.endDate) whereNew.createdAt.lte = options.endDate;
    }

    const [totalCustomers, newCustomers, topCustomers, avg] = await Promise.all(
      [
        this.prisma.customer.count({ where: { tenantId } }),
        this.prisma.customer.count({ where: whereNew }),
        this.prisma.customer.findMany({
          where: { tenantId },
          orderBy: { totalSpent: "desc" },
          take: 10,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            totalOrders: true,
            totalSpent: true,
            averageOrder: true,
            loyaltyPoints: true,
          },
        }),
        this.prisma.customer.aggregate({
          where: { tenantId },
          _avg: { totalSpent: true },
        }),
      ],
    );

    return {
      totalCustomers,
      newCustomers,
      topCustomers,
      averageLifetimeValue: avg._avg.totalSpent ?? 0,
    };
  }

  async getCustomerProfile(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            finalAmount: true,
            createdAt: true,
          },
        },
        loyaltyTransactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }
}
