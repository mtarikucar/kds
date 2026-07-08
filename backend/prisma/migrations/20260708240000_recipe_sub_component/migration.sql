-- Nested BOM: a recipe uses a quantity of another recipe (a prep/sub-recipe).
CREATE TABLE "recipe_sub_components" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "subRecipeId" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "recipeUnit" TEXT,
    "conversionFactor" DECIMAL(12,6),
    CONSTRAINT "recipe_sub_components_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recipe_sub_components_recipeId_subRecipeId_key" ON "recipe_sub_components"("recipeId", "subRecipeId");
CREATE INDEX "recipe_sub_components_recipeId_idx" ON "recipe_sub_components"("recipeId");
CREATE INDEX "recipe_sub_components_subRecipeId_idx" ON "recipe_sub_components"("subRecipeId");
ALTER TABLE "recipe_sub_components" ADD CONSTRAINT "recipe_sub_components_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_sub_components" ADD CONSTRAINT "recipe_sub_components_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
