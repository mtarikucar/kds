import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { UserRole } from "../../../common/constants/roles.enum";

/**
 * Support/incident-response tool: PATCH /superadmin/users/:id/role.
 * `@IsEnum(UserRole)` makes an invalid role a 400 at the DTO layer, never a
 * DB write — the whole point of this endpoint is to give support a safe
 * path that replaces going straight to Postgres / Prisma Studio (the v3.2.x
 * incident that planted an invalid "OWNER" role in the first place).
 */
export class UpdateUserRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}
