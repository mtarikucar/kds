import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";
import {
  AttendanceSource,
  AttendanceStatus,
} from "../constants/personnel.enum";
import {
  cardUidHash,
  cardUidLast4,
  isValidCardUid,
  normalizeCardUid,
  staffCardAad,
  STAFF_CARD_HASH_VERSION,
} from "../card-uid";
import { encryptString } from "../../../common/helpers/encryption.helper";
import { AssignCardDto, CardTapDto } from "../dto/card-shift.dto";

export type CardTapAction = "clockIn" | "clockOut" | "breakEnd" | "ignored";

export interface CardStaffRef {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface CardTapResult {
  action: CardTapAction;
  user: CardStaffRef;
  /** The row AttendanceService produced, or null for an ignored tap. */
  attendance: Awaited<ReturnType<AttendanceService["clockIn"]>> | null;
}

export interface CardAssignmentView {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  last4: string | null;
  assignedAt: Date | null;
  assignedById: string | null;
}

/**
 * Resolves "which staff member, which action" for a card tap and then DELEGATES
 * to AttendanceService.
 *
 * It deliberately writes no attendance of its own: lateness, breaks, overtime,
 * overnight shifts, the branch fallback and the P2002 race guard all live in
 * AttendanceService, and a second implementation would drift from them without
 * anything failing.
 */
@Injectable()
export class CardShiftService {
  private readonly logger = new Logger(CardShiftService.name);

  /**
   * Cheap HID readers can emit one physical tap twice. Without this window the
   * second write closes the shift the first one opened, one second later.
   */
  private static readonly DEBOUNCE_MS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
  ) {}

  async tap(tenantId: string, dto: CardTapDto): Promise<CardTapResult> {
    const uid = normalizeCardUid(dto.cardUid);
    if (!isValidCardUid(uid)) {
      throw new BadRequestException({
        code: "CARD_UID_INVALID",
        message: "Kart numarası geçersiz",
      });
    }

    const staff = await this.prisma.user.findFirst({
      where: {
        tenantId,
        // A disabled staff member gets the SAME answer as an unknown card:
        // a distinct error would confirm the card exists.
        status: "ACTIVE",
        staffCardUidHash: cardUidHash(tenantId, uid),
      },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    if (!staff) {
      // last4 is the only affordance that ever leaves this method. Never the
      // raw UID (it would enrol from the log) and never the hash.
      this.logger.warn(
        `Unrecognised staff card tenant=${tenantId} last4=${cardUidLast4(uid)}`,
      );
      throw new NotFoundException({
        code: "CARD_NOT_RECOGNISED",
        message: "Kart tanınmadı",
      });
    }

    // Same query shape clockOut uses — by STATUS, newest first, NOT by today's
    // date — so an overnight shift (date = yesterday) is found.
    const open = await this.prisma.attendance.findFirst({
      where: {
        tenantId,
        userId: staff.id,
        status: {
          in: [AttendanceStatus.CLOCKED_IN, AttendanceStatus.ON_BREAK],
        },
      },
      orderBy: { clockIn: "desc" },
    });

    if (
      open &&
      Date.now() - open.updatedAt.getTime() < CardShiftService.DEBOUNCE_MS
    ) {
      return { action: "ignored", user: staff, attendance: null };
    }

    try {
      if (!open) {
        const row = await this.attendance.clockIn(
          tenantId,
          staff.id,
          dto.notes,
          AttendanceSource.CARD,
        );
        return { action: "clockIn", user: staff, attendance: row };
      }
      if (open.status === AttendanceStatus.ON_BREAK) {
        // Ending a break is not a punch, so it stamps no source column.
        // Starting one stays in the app: a kiosk cannot tell the difference
        // between "going on a break" and "going home".
        const row = await this.attendance.breakEnd(tenantId, staff.id);
        return { action: "breakEnd", user: staff, attendance: row };
      }
      const row = await this.attendance.clockOut(
        tenantId,
        staff.id,
        AttendanceSource.CARD,
      );
      return { action: "clockOut", user: staff, attendance: row };
    } catch (err) {
      // attendance.service.ts:111-115 throws a prose BadRequest. At a kiosk it
      // has to become a code the screen can translate.
      if (
        err instanceof BadRequestException &&
        String(err.message).includes("Already clocked out today")
      ) {
        throw new ConflictException({
          code: "ALREADY_CLOCKED_OUT_TODAY",
          message: "Bugün çıkış yapılmış",
        });
      }
      throw err;
    }
  }

  async assign(
    tenantId: string,
    userId: string,
    actorUserId: string,
    dto: AssignCardDto,
  ): Promise<CardAssignmentView> {
    const uid = normalizeCardUid(dto.cardUid);
    if (!isValidCardUid(uid)) {
      throw new BadRequestException({
        code: "CARD_UID_INVALID",
        message: "Kart numarası geçersiz",
      });
    }

    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException("User not found");

    try {
      const row = await this.prisma.user.update({
        where: { id: userId },
        data: {
          staffCardUidHash: cardUidHash(tenantId, uid),
          // K22: the ONLY thing that makes an ENCRYPTION_MASTER_KEY rotation
          // survivable. Never read on the tap path, never returned.
          staffCardUidEnc: encryptString(uid, staffCardAad(tenantId, userId)),
          staffCardHashVersion: STAFF_CARD_HASH_VERSION,
          staffCardLast4: cardUidLast4(uid),
          staffCardAssignedAt: new Date(),
          staffCardAssignedById: actorUserId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          staffCardLast4: true,
          staffCardAssignedAt: true,
          staffCardAssignedById: true,
        },
      });
      return this.toView(row);
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ConflictException({
          code: "CARD_ALREADY_ASSIGNED",
          message: "Bu kart başka bir personele atanmış",
        });
      }
      throw err;
    }
  }

  async revoke(
    tenantId: string,
    userId: string,
  ): Promise<{ userId: string; revoked: true }> {
    // updateMany with tenantId in the WHERE, not update-by-id: a bare id write
    // is a cross-tenant IDOR.
    const claim = await this.prisma.user.updateMany({
      where: { id: userId, tenantId },
      data: {
        staffCardUidHash: null,
        staffCardUidEnc: null,
        staffCardLast4: null,
        staffCardAssignedAt: null,
        staffCardAssignedById: null,
      },
    });
    if (claim.count === 0) throw new NotFoundException("User not found");
    // Past Attendance rows keep clockInSource='card' on purpose: they really
    // were stamped with a card.
    return { userId, revoked: true };
  }

  async list(tenantId: string): Promise<CardAssignmentView[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId, status: "ACTIVE" },
      // staffCardUidHash / staffCardUidEnc are NOT selected. They must not be
      // able to reach a response by accident.
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        staffCardLast4: true,
        staffCardAssignedAt: true,
        staffCardAssignedById: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return rows.map((r) => this.toView(r));
  }

  private toView(row: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    staffCardLast4: string | null;
    staffCardAssignedAt: Date | null;
    staffCardAssignedById: string | null;
  }): CardAssignmentView {
    return {
      userId: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      last4: row.staffCardLast4,
      assignedAt: row.staffCardAssignedAt,
      assignedById: row.staffCardAssignedById,
    };
  }
}
