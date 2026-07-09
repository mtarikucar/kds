-- Recipe-unit conversion on an ingredient: quantity may be in a recipe unit
-- (G) different from the stock base unit (KG). conversionFactor = base units
-- per recipe unit. Null = base-unit quantity (existing recipes unchanged).
ALTER TABLE "recipe_ingredients" ADD COLUMN "recipeUnit" TEXT;
ALTER TABLE "recipe_ingredients" ADD COLUMN "conversionFactor" DECIMAL(12,6);
