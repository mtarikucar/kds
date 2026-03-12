import { PartialType } from '@nestjs/swagger';
import { CreateStockItemCategoryDto } from './create-stock-item-category.dto';

export class UpdateStockItemCategoryDto extends PartialType(CreateStockItemCategoryDto) {}
