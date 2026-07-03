import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ImageIcon, Sparkles, Trash2 } from "lucide-react";
import {
  useCategories,
  useProduct,
  useCreateProduct,
  useUpdateProduct,
} from "../../features/menu/menuApi";
import { useAssignModifiersToProduct } from "../../features/modifiers/modifiersApi";
import { ProductModifierSelector } from "../../components/modifiers";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import ImageLibraryModal from "../../components/product/ImageLibraryModal";
import Product3dPanel from "../../components/product/Product3dPanel";
import ProductMediaPanel from "../../components/product/ProductMediaPanel";
import {
  createProductSchema,
  type ProductFormData,
} from "./menuManagement/menuSchemas";
import { getImageUrl } from "./menuManagement/imageUrl";
import type { Product, ProductImage } from "../../types";

/** A titled card section. Module-level so it isn't re-created each render
    (which would remount its inputs and drop focus while typing). */
function Section({
  id,
  title,
  icon,
  children,
}: {
  id?: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Full-page product create/edit editor (replaces the old modal). The AI tools
 * (photo, ingredients video, 3D/AR) can be used WITHOUT an explicit save: the
 * first time one is triggered on a new product, `ensureProductId` silently
 * creates a draft from the current form, so the operator never has to "save
 * first". Sectioned layout with a sticky action bar.
 */
export default function ProductEditorPage() {
  const { t } = useTranslation(["menu", "common"]);
  const navigate = useNavigate();
  const { productId: routeProductId } = useParams<{ productId?: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = !!routeProductId;

  const { data: categories } = useCategories();
  const { data: fetchedProduct } = useProduct(routeProductId ?? "");
  const { mutateAsync: createProduct, isPending: isCreating } =
    useCreateProduct();
  const { mutateAsync: updateProduct, isPending: isUpdating } =
    useUpdateProduct();
  const { mutate: assignModifiers } = useAssignModifiersToProduct();

  const [product, setProduct] = useState<Product | null>(null);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<
    string[]
  >([]);
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false);

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(createProductSchema(t)),
    defaultValues: {
      isAvailable: true,
      stockTracked: false,
      taxRate: 10,
      price: 0,
      categoryId: searchParams.get("categoryId") ?? "",
    },
  });

  // Hydrate the form once the product to edit loads.
  useEffect(() => {
    if (!fetchedProduct || product) return;
    setProduct(fetchedProduct);
    const imgs = Array.isArray(fetchedProduct.images)
      ? fetchedProduct.images
      : [];
    setProductImages(imgs);
    setSelectedModifierGroupIds(
      Array.isArray(fetchedProduct.modifierGroups)
        ? fetchedProduct.modifierGroups.map((mg) => mg.id)
        : [],
    );
    productForm.reset({
      name: fetchedProduct.name,
      description: fetchedProduct.description || "",
      ingredients: fetchedProduct.ingredients || "",
      price: fetchedProduct.price,
      categoryId: fetchedProduct.categoryId,
      currentStock: fetchedProduct.currentStock,
      image: fetchedProduct.image || "",
      imageIds: imgs.map((img) => img.id),
      isAvailable: fetchedProduct.isAvailable ?? true,
      stockTracked: fetchedProduct.stockTracked ?? false,
      taxRate: fetchedProduct.taxRate ?? 10,
    });
  }, [fetchedProduct, product, productForm, t]);

  const buildSubmitData = (data: ProductFormData) => ({
    ...data,
    price: Number(data.price),
    currentStock: data.currentStock ? Number(data.currentStock) : 0,
    taxRate: data.taxRate != null ? Number(data.taxRate) : 10,
    imageIds: productImages.map((img) => img.id),
  });

  const persistModifiers = (id: string) =>
    assignModifiers({
      productId: id,
      data: {
        modifierGroups: selectedModifierGroupIds.map((groupId, index) => ({
          groupId,
          displayOrder: index,
        })),
      },
    });

  /**
   * Return a saved productId, creating a draft from the current form if needed.
   * This is what lets the AI tools run "without saving" on a new product.
   */
  const ensureProductId = async (): Promise<string | null> => {
    if (product?.id) return product.id;
    const valid = await productForm.trigger();
    if (!valid) {
      toast.error(
        t("menu.editorNeedsBasics", "Önce ürün adı, fiyat ve kategori girin."),
      );
      return null;
    }
    try {
      const created = (await createProduct(
        buildSubmitData(productForm.getValues()),
      )) as Product;
      if (!created?.id) return null;
      setProduct(created);
      persistModifiers(created.id);
      navigate(`/admin/menu/products/${created.id}/edit`, { replace: true });
      return created.id;
    } catch {
      return null; // toast surfaced by the mutation
    }
  };

  const onSubmit = async (data: ProductFormData) => {
    const submitData = buildSubmitData(data);
    try {
      if (product?.id) {
        await updateProduct({ id: product.id, data: submitData });
        persistModifiers(product.id);
      } else {
        const created = (await createProduct(submitData)) as Product;
        if (created?.id) persistModifiers(created.id);
      }
      toast.success(t("menu.itemSaved", "Ürün kaydedildi"));
      navigate("/admin/menu");
    } catch {
      /* toast surfaced by the mutation */
    }
  };

  const saving = isCreating || isUpdating;
  const liveIngredients = productForm.watch("ingredients") || "";
  const hasImage = productImages.length > 0 || !!product?.image;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/admin/menu")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold text-slate-900">
          {isEdit || product
            ? t("menu.editItem", "Ürünü düzenle")
            : t("menu.addItem", "Yeni ürün")}
        </h1>
      </div>

      <form
        onSubmit={productForm.handleSubmit(onSubmit)}
        className="space-y-4 pb-24"
      >
        {/* Temel bilgiler */}
        <Section title={t("menu.basicInfo", "Temel bilgiler")}>
          <div className="space-y-3">
            <Input
              label={t("menu.itemName")}
              error={productForm.formState.errors.name?.message}
              {...productForm.register("name")}
            />
            <Input
              label={t("menu.description")}
              error={productForm.formState.errors.description?.message}
              {...productForm.register("description")}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t("menu.price")}
                type="number"
                step="0.01"
                error={productForm.formState.errors.price?.message}
                {...productForm.register("price", { valueAsNumber: true })}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("menu.category")}
                </label>
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  {...productForm.register("categoryId")}
                >
                  <option value="">{t("menu.selectCategory")}</option>
                  {categories?.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                {productForm.formState.errors.categoryId?.message && (
                  <p className="mt-1 text-sm text-red-600">
                    {productForm.formState.errors.categoryId.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </Section>

        {/* Müşteriye görünen içerik: içindekiler + görseller */}
        <Section title={t("menu.customerContent", "Müşteriye görünen içerik")}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {t("menu.ingredients", "İçindekiler")}
              </label>
              <textarea
                rows={2}
                placeholder={
                  t(
                    "menu.ingredientsPlaceholder",
                    "Örn: Dana kıyma, soğan, domates, biber, baharatlar",
                  ) as string
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...productForm.register("ingredients")}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t("menu.productImages")}
              </label>
              {productImages.length > 0 ? (
                <div className="mb-3 grid grid-cols-4 gap-2">
                  {productImages.map((image, index) => (
                    <div key={image.id} className="group relative">
                      <div className="aspect-square overflow-hidden rounded-lg border-2 border-slate-200">
                        <img
                          src={getImageUrl(image.url)}
                          alt={image.filename}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      {index === 0 && (
                        <div className="absolute left-1 top-1 rounded bg-yellow-500 px-2 py-0.5 text-xs text-white">
                          {t("menu.primary")}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setProductImages((imgs) =>
                            imgs.filter((img) => img.id !== image.id),
                          )
                        }
                        className="absolute right-1 top-1 rounded-full bg-red-600 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : product?.image ? (
                <div className="mb-3">
                  <div className="relative aspect-square w-32 overflow-hidden rounded-lg border-2 border-slate-200">
                    <img
                      src={getImageUrl(product.image)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute left-1 top-1 rounded bg-yellow-500 px-2 py-0.5 text-xs text-white">
                      {t("menu.primary")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-4 rounded-xl border-2 border-dashed border-slate-300 py-8 text-center">
                  <ImageIcon className="mx-auto h-10 w-10 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-600">
                    {t("menu.noImagesSelected")}
                  </p>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setImageLibraryOpen(true)}
                className="w-full"
              >
                <ImageIcon className="mr-2 h-4 w-4" />
                {t("menu.chooseImagesFromLibrary")}
              </Button>
            </div>
          </div>
        </Section>

        {/* AI Stüdyo */}
        <Section
          id="ai-studio"
          title={t("menu.aiStudio", "AI Stüdyo")}
          icon={<Sparkles className="h-4 w-4 text-primary-600" />}
        >
          <p className="mb-3 -mt-1 text-xs text-slate-500">
            {t(
              "menu.aiStudioHint",
              "Fotoğraf, içindekiler videosu ve 3D/AR modelini otomatik üretin — kaydetmeniz gerekmez.",
            )}
          </p>
          <ProductMediaPanel
            productId={product?.id}
            ensureProductId={ensureProductId}
            hasImage={hasImage}
            hasIngredients={!!liveIngredients.trim()}
            onPhotoGenerated={(url) =>
              setProduct((p) => (p ? { ...p, image: url } : p))
            }
          />
          <Product3dPanel
            productId={product?.id}
            ensureProductId={ensureProductId}
            hasImage={hasImage}
          />
        </Section>

        {/* Seçenekler */}
        <Section title={t("menu.modifierGroups", "Seçenekler")}>
          <ProductModifierSelector
            productId={product?.id}
            selectedGroupIds={selectedModifierGroupIds}
            onSelectionChange={setSelectedModifierGroupIds}
          />
        </Section>

        {/* Operasyon / POS */}
        <Section title={t("menu.operations", "Operasyon / POS")}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t("menu.currentStock")}
                type="number"
                error={productForm.formState.errors.currentStock?.message}
                {...productForm.register("currentStock", {
                  valueAsNumber: true,
                })}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("menu.taxRate")}
                </label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  {...productForm.register("taxRate", { valueAsNumber: true })}
                >
                  <option value={0}>%0</option>
                  <option value={1}>%1</option>
                  <option value={10}>%10</option>
                  <option value={20}>%20</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="rounded"
                {...productForm.register("isAvailable")}
              />
              {t("menu.available")}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="rounded"
                {...productForm.register("stockTracked")}
              />
              {t("menu.stockTracked")}
            </label>
          </div>
        </Section>
      </form>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-3 px-4 py-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/admin/menu")}
            disabled={saving}
          >
            {t("common:app.cancel")}
          </Button>
          <Button
            className="flex-1"
            onClick={productForm.handleSubmit(onSubmit)}
            isLoading={saving}
            disabled={saving}
          >
            {t("common:app.save", "Kaydet")}
          </Button>
        </div>
      </div>

      <ImageLibraryModal
        isOpen={imageLibraryOpen}
        onClose={() => setImageLibraryOpen(false)}
        onSelectImages={(images) => {
          setProductImages(images);
          setImageLibraryOpen(false);
        }}
        selectedImageIds={productImages.map((img) => img.id)}
      />
    </div>
  );
}
