import { IsNumber, Min } from 'class-validator';

export class TerminalResizeDto {
  @IsNumber()
  @Min(1)
  cols: number;

  @IsNumber()
  @Min(1)
  rows: number;
}
