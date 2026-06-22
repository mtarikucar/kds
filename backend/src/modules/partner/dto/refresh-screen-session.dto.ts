import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class RefreshScreenSessionDto {
  @ApiProperty({
    description: "The refresh token returned at mint/last refresh",
  })
  @IsString()
  @Length(10, 200)
  refreshToken: string;
}
