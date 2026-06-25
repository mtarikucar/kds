import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString } from "class-validator";

export const TERMINAL_ACTIVATION_STATES = [
  "CONFIGURED_NOT_ACTIVE", // real adapter, no hardware/creds wired → refuses to charge
  "ACTIVE", // real adapter wired + certified → charges real money
  "SIMULATOR", // drives the rail end-to-end with fake (SIM-) approvals
  "DISABLED", // operator-silenced
] as const;

export class SetTerminalActivationDto {
  @ApiProperty({ enum: TERMINAL_ACTIVATION_STATES })
  @IsString()
  @IsIn(TERMINAL_ACTIVATION_STATES as unknown as string[])
  activationState: string;
}
