import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsNumber, Max, Min } from "class-validator";
import { EXPENSE_CATEGORIES } from "./create-expense.dto";

export class SetBudgetDto {
  @ApiProperty({ enum: EXPENSE_CATEGORIES })
  @IsIn(EXPENSE_CATEGORIES as unknown as string[])
  category: string;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 6, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  amount: number;
}
