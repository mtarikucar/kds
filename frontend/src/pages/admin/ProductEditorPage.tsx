import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ImageIcon,
  Layers,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import {
  useCategories,
  useProduct,
  useProducts,
  useCreateProduct,
  useUpdateProduct,
} from "../../features/menu/menuApi";
import { useAssignModifiersToProduct } from "../../features/modifiers/modifiersApi";
import { ProductModifierSelector } from "../../components/modifiers";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import ProductImageField from "../../components/product/ProductImageField";
import Product3dPanel from "../../components/product/Product3dPanel";
import ProductMediaPanel from "../../components/product/ProductMediaPanel";
import ComboBuilder from "./menuManagement/ComboBuilder";
import {
  validateComboGroups,
  type ComboSlotErrors,
} from "./menuManagement/comboValidation";
import CollectionMultiSelect from "./menuManagement/CollectionMultiSelect";
import {
  createProductSchema,
  type ProductFormData,
} from "./menuManagement/menuSchemas";
import { getImageUrl } from "./menuManagement/imageUrl";
import type { Product, ProductImage, ComboGroupInput } from "../../types";

// ISO <-> <input type="datetime-local"> (local-time) conversion for campaign
// windows. datetime-local has no timezone; interpreting it in local time on
// both directions round-trips correctly.
const isoToLocalInput = (iso?: string | null): string => {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};
const localInputToIso = (local?: string | null): string | null =>
  local ? new Date(local).toISOString() : null;

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
export interface ProductEditorProps {
  /** Overrides the route param — set when the editor runs inside the menu
      workspace panel instead of on its own page. */
  productId?: string;
  /** Pre-selects a category for a new product (the workspace passes the one
      the operator was looking at). */
  defaultCategoryId?: string;
  /** Panel mode: no page header, no navigation on save. */
  embedded?: boolean;
  onSaved?: (product: Product) => void;
  onCancel?: () => void;
}

export default function ProductEditorPage({
  productId: propProductId,
  defaultCategoryId,
  embedded = false,
  onSaved,
  onCancel,
}: ProductEditorProps = {}) {
  const { t } = useTranslation(["menu", "common"]);
  const navigate = useNavigate();
  const { productId: routeParamId } = useParams<{ productId?: string }>();
  const routeProductId = propProductId ?? routeParamId;
  const [searchParams] = useSearchParams();
  const isEdit = !!routeProductId;

  const { data: categories } = useCategories();
  const { data: fetchedProduct } = useProduct(routeProductId ?? "");
  const { data: allProducts } = useProducts();
  const { mutateAsync: createProduct, isPending: isCreating } =
    useCreateProduct();
  const { mutateAsync: updateProduct, isPending: isUpdating } =
    useUpdateProduct();
  const { mutateAsync: assignModifiers } = useAssignModifiersToProduct();
  const draftRef = useRef<Promise<string | null> | null>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<
    string[]
  >([]);
  const [comboGroups, setComboGroups] = useState<ComboGroupInput[]>([]);
  const [comboErrors, setComboErrors] = useState<ComboSlotErrors>({});
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>(
    [],
  );

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(createProductSchema(t)),
    defaultValues: {
      isAvailable: true,
      stockTracked: false,
      taxRate: 10,
      price: 0,
      categoryId: defaultCategoryId ?? searchParams.get("categoryId") ?? "",
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
    // Hydrate combo slots + collection memberships from the GET response.
    setComboGroups(
      Array.isArray(fetchedProduct.comboGroups)
        ? fetchedProduct.comboGroups.map((g) => ({
            name: g.name,
            displayName: g.displayName ?? undefined,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            items: (g.items ?? []).map((it) => ({
              componentProductId: it.componentProductId,
              quantity: it.quantity,
              priceDelta: Number(it.priceDelta ?? 0),
              isDefault: it.isDefault,
            })),
          }))
        : [],
    );
    setSelectedCollectionIds(
      Array.isArray(fetchedProduct.collections)
        ? fetchedProduct.collections.map((c) => c.id)
        : [],
    );
    productForm.reset({
      name: fetchedProduct.name,
      description: fetchedProduct.description || "",
      ingredients: fetchedProduct.ingredients || "",
      // The detail endpoint serializes Prisma Decimal columns as STRINGS
      // ("45.5"); register()'s valueAsNumber/setValueAs do not run on reset
      // values, so without coercion the z.number() schema rejects every
      // existing product at save time ("Expected number, received string").
      price: Number(fetchedProduct.price),
      categoryId: fetchedProduct.categoryId,
      currentStock:
        fetchedProduct.currentStock != null
          ? Number(fetchedProduct.currentStock)
          : undefined,
      image: fetchedProduct.image || "",
      imageIds: imgs.map((img) => img.id),
      isAvailable: fetchedProduct.isAvailable ?? true,
      stockTracked: fetchedProduct.stockTracked ?? false,
      taxRate: fetchedProduct.taxRate != null ? Number(fetchedProduct.taxRate) : 10,
      productType: fetchedProduct.productType ?? "STANDARD",
      campaignPrice:
        fetchedProduct.campaignPrice != null
          ? Number(fetchedProduct.campaignPrice)
          : null,
      campaignLabel: fetchedProduct.campaignLabel ?? null,
      campaignStartAt: isoToLocalInput(fetchedProduct.campaignStartAt),
      campaignEndAt: isoToLocalInput(fetchedProduct.campaignEndAt),
    });
  }, [fetchedProduct, product, productForm, t]);

  const buildSubmitData = (data: ProductFormData, opts?: { forUpdate?: boolean }) => {
    const { image, campaignStartAt, campaignEndAt, ...rest } = data;
    const productType = data.productType ?? "STANDARD";
    const cp =
      data.campaignPrice != null && Number(data.campaignPrice) > 0
        ? Number(data.campaignPrice)
        : null;
    // Live stock is decremented by POS sales while the editor is open, so an
    // update must not round-trip the page-load snapshot: send currentStock /
    // isAvailable only when the operator actually edited them, and treat a
    // cleared stock field as "don't change", never as 0.
    const dirty = productForm.formState.dirtyFields;
    const stockPatch = opts?.forUpdate
      ? {
          ...(dirty.currentStock && data.currentStock != null
            ? { currentStock: Number(data.currentStock) }
            : {}),
          ...(dirty.isAvailable ? { isAvailable: data.isAvailable } : {}),
        }
      : { currentStock: data.currentStock != null ? Number(data.currentStock) : 0 };
    if (opts?.forUpdate) {
      delete (rest as Partial<ProductFormData>).currentStock;
      delete (rest as Partial<ProductFormData>).isAvailable;
    }
    return {
      ...rest,
      ...stockPatch,
      price: Number(data.price),
      taxRate: data.taxRate != null ? Number(data.taxRate) : 10,
      imageIds: productImages.map((img) => img.id),
      productType,
      // Combo slots (replace-all). Empty for STANDARD so switching a combo
      // back to standard clears its slots.
      comboGroups: productType === "COMBO" ? comboGroups : [],
      collectionIds: selectedCollectionIds,
      // Campaign: null clears; a positive price + window sets it.
      campaignPrice: cp,
      campaignLabel: data.campaignLabel?.trim() ? data.campaignLabel.trim() : null,
      campaignStartAt: localInputToIso(campaignStartAt),
      campaignEndAt: localInputToIso(campaignEndAt),
      // Only send a legacy image when it's a real value — "" 400s the DTO.
      ...(image && image.trim() ? { image: image.trim() } : {}),
    };
  };

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
   * Return a saved productId with the CURRENT form persisted — so the AI tools
   * (which read the product from the DB) see fresh name/ingredients/images and
   * run "without an explicit save". Creates a draft for a new product (guarded
   * against double-click) or updates the existing one.
   */
  const ensureProductId = async (): Promise<string | null> => {
    const valid = await productForm.trigger();
    if (!valid) {
      toast.error(
        t("menu.editorNeedsBasics", "Önce ürün adı, fiyat ve kategori girin."),
      );
      return null;
    }
    if (product?.id) {
      try {
        await updateProduct({
          id: product.id,
          data: buildSubmitData(productForm.getValues(), { forUpdate: true }),
        });
        await persistModifiers(product.id);
        return product.id;
      } catch {
        return null;
      }
    }
    // New product: create the draft ONCE (concurrent AI clicks share the promise).
    if (draftRef.current) return draftRef.current;
    const pending = (async (): Promise<string | null> => {
      try {
        const created = (await createProduct(
          buildSubmitData(productForm.getValues()),
        )) as Product;
        if (!created?.id) return null;
        setProduct(created);
        await persistModifiers(created.id);
        // On its own page the URL has to adopt the new id so a refresh lands
        // on the draft. In the panel there is no URL to adopt — the workspace
        // owns selection — and navigating would tear the panel down mid-edit.
        if (!embedded) {
          navigate(`/admin/menu/products/${created.id}/edit`, { replace: true });
        }
        return created.id;
      } catch {
        return null;
      }
    })();
    draftRef.current = pending;
    const id = await pending;
    if (!id) draftRef.current = null; // allow a retry after a failed create
    return id;
  };

  // After a failed submit, revalidate live so the inline slot errors clear as
  // the operator fixes them.
  const handleComboGroupsChange = (next: ComboGroupInput[]) => {
    setComboGroups(next);
    if (Object.keys(comboErrors).length > 0) {
      setComboErrors(validateComboGroups(next));
    }
  };

  const onSubmit = async (data: ProductFormData) => {
    // Combos: block unsellable configurations (empty slot, unselected product,
    // qty/maxSelect 0, minSelect > options) BEFORE the backend — it persists
    // some of these silently and the POS only fails at sale time.
    if ((data.productType ?? "STANDARD") === "COMBO") {
      const errs = validateComboGroups(comboGroups);
      setComboErrors(errs);
      if (Object.keys(errs).length > 0) {
        toast.error(
          t(
            "menu.comboValidation.summary",
            "Kombo içeriğinde hatalar var — işaretli slotları düzeltin",
          ),
        );
        return;
      }
    }
    try {
      if (product?.id) {
        await updateProduct({
          id: product.id,
          data: buildSubmitData(data, { forUpdate: true }),
        });
        await persistModifiers(product.id);
      } else {
        const created = (await createProduct(buildSubmitData(data))) as Product;
        if (created?.id) {
          // Adopt the created row IMMEDIATELY: if persistModifiers fails below,
          // the next Save must run the update path — re-running create would
          // silently duplicate the product.
          setProduct(created);
          if (!embedded) {
            navigate(`/admin/menu/products/${created.id}/edit`, {
              replace: true,
            });
          }
          await persistModifiers(created.id);
        }
      }
      toast.success(t("menu.itemSaved", "Ürün kaydedildi"));
      if (embedded) {
        onSaved?.((product ?? productForm.getValues()) as unknown as Product);
      } else {
        navigate("/admin/menu");
      }
    } catch {
      /* toast surfaced by the mutation */
    }
  };

  const saving = isCreating || isUpdating;
  const liveIngredients = productForm.watch("ingredients") || "";
  const productType = productForm.watch("productType") ?? "STANDARD";
  const hasImage = productImages.length > 0 || !!product?.image;

  // Combo component candidates: this tenant's STANDARD products, excluding the
  // combo itself (no self-reference, no nested combos).
  const componentOptions = (allProducts ?? [])
    .filter((p) => p.productType !== "COMBO" && p.id !== product?.id)
    .map((p) => ({ id: p.id, name: p.name, price: Number(p.price) }));

  return (
    <div className={embedded ? "" : "mx-auto max-w-3xl px-4 py-6"}>
      {!embedded && (
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
      )}

      <form onSubmit={productForm.handleSubmit(onSubmit)} className="pb-4">
        {/* Two columns on desktop so the editor isn't one very tall scroll. */}
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4">
            {/* Temel bilgiler */}
            <Section title={t("menu.basicInfo", "Temel bilgiler")}>
              <div className="space-y-3">
                {/* Ürün tipi: normal vs kombo */}
                <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
                  {(["STANDARD", "COMBO"] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() =>
                        productForm.setValue("productType", pt, {
                          shouldDirty: true,
                        })
                      }
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        productType === pt
                          ? "bg-primary-600 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {pt === "STANDARD"
                        ? t("menu.productTypeStandard", "Normal ürün")
                        : t("menu.productTypeCombo", "Kombo / Menü")}
                    </button>
                  ))}
                </div>
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
            <Section
              title={t("menu.customerContent", "Müşteriye görünen içerik")}
            >
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
                  <ProductImageField
                    images={productImages}
                    onChange={setProductImages}
                    legacyImageUrl={product?.image}
                  />
                </div>
              </div>
            </Section>
          </div>

          <div className="space-y-4">
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
                hasIngredients={!!liveIngredients.trim()}
                onPrimaryChanged={(url) => {
                  setProduct((p) => (p ? { ...p, image: url } : p));
                  productForm.setValue("image", url);
                }}
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
                      // Empty → undefined (not NaN). `valueAsNumber` on a blank
                      // field yields NaN, which the optional z.number() rejects
                      // ("Expected number, received nan") and silently blocks
                      // Save — hit hardest by combos, which carry no stock.
                      setValueAs: (v) =>
                        v === "" || v === null || v === undefined
                          ? undefined
                          : Number(v),
                    })}
                  />
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      {t("menu.taxRate")}
                    </label>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      {...productForm.register("taxRate", {
                        valueAsNumber: true,
                      })}
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
          </div>
        </div>

        {/* Full-width sections: combo builder, campaign, collections */}
        <div className="mt-4 space-y-4">
          {productType === "COMBO" && (
            <Section
              title={t("menu.comboSlots", "Kombo içeriği")}
              icon={<Layers className="h-4 w-4 text-primary-600" />}
            >
              <ComboBuilder
                groups={comboGroups}
                onChange={handleComboGroupsChange}
                components={componentOptions}
                errors={comboErrors}
              />
            </Section>
          )}

          <Section
            title={t("menu.campaign", "Kampanya")}
            icon={<Tag className="h-4 w-4 text-primary-600" />}
          >
            <div className="space-y-3">
              <p className="-mt-1 text-xs text-slate-500">
                {t(
                  "menu.campaignHint",
                  "İndirimli fiyat girin — menüde üstü çizili liste fiyatı + rozet gösterilir. Tarih boş bırakılırsa hemen/süresiz geçerli olur. Boş bırakırsanız kampanya yoktur.",
                )}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={t("menu.campaignPrice", "Kampanya fiyatı (₺)")}
                  type="number"
                  step="0.01"
                  error={productForm.formState.errors.campaignPrice?.message}
                  {...productForm.register("campaignPrice", {
                    setValueAs: (v) =>
                      v === "" || v === null ? null : Number(v),
                  })}
                />
                <Input
                  label={t("menu.campaignLabel", "Rozet metni")}
                  placeholder="%20 İndirim"
                  {...productForm.register("campaignLabel")}
                />
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {t("menu.campaignStart", "Başlangıç")}
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    {...productForm.register("campaignStartAt")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {t("menu.campaignEnd", "Bitiş")}
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    {...productForm.register("campaignEndAt")}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title={t("menu.collections", "Koleksiyonlar")}
            icon={<Layers className="h-4 w-4 text-primary-600" />}
          >
            <CollectionMultiSelect
              selected={selectedCollectionIds}
              onChange={setSelectedCollectionIds}
            />
          </Section>
        </div>
      </form>

      {/* Action bar — sticky to the editor's own scroll box, not fixed to the
          viewport. Fixed put it across the whole screen: below lg it ran under
          the docked 256px sidebar (at 768px the Cancel button sat entirely
          behind it and every click landed on the sidebar), and from lg up,
          now that the menu workspace's panes fill <main> exactly, it floated
          over the bottom row of the category tree. The negative margins undo
          the padding of whichever box wraps this — p-4 in the embedded pane,
          px-4 py-6 standalone — so the bar still spans edge to edge, and the
          safe-area padding keeps it clear of the iPhone home indicator. */}
      <div
        className={`sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${
          embedded ? "-mb-4" : "-mb-6"
        }`}
      >
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

    </div>
  );
}
