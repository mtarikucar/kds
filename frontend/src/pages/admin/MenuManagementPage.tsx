import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ListPlus,
  Package,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useDeleteProduct,
} from "../../features/menu/menuApi";
import {
  Category,
  Product,
  ModifierGroup,
  Modifier,
  CreateModifierGroupDto,
  CreateModifierDto,
} from "../../types";
import {
  useModifierGroups,
  useCreateModifierGroup,
  useUpdateModifierGroup,
  useDeleteModifierGroup,
  useCreateModifier,
  useUpdateModifier,
  useDeleteModifier,
} from "../../features/modifiers/modifiersApi";
import {
  ModifierGroupModal,
  ModifierItemModal,
} from "../../components/modifiers";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import Input from "../../components/ui/Input";
import BulkAddModal from "../../components/product/BulkAddModal";
import { useSubscription } from "../../contexts/SubscriptionContext";
import {
  createCategorySchema,
  type CategoryFormData,
} from "./menuManagement/menuSchemas";
import MenuTree from "./menuManagement/MenuTree";
import ProductEditorPage from "./ProductEditorPage";
import MenuImportTab from "./menuManagement/MenuImportTab";
import Spinner from "../../components/ui/Spinner";
import { ErrorState } from "../../components/ui/ErrorState";
import UpgradePrompt from "../../components/subscriptions/UpgradePrompt";
import { cn } from "../../lib/utils";
import { useMenuImportStatus } from "../../features/menu/menuApi";

const MenuManagementPage = () => {
  const { t } = useTranslation(["menu", "common", "subscriptions"]);
  const navigate = useNavigate();
  const { checkLimit } = useSubscription();

  // Create translated schema
  const categorySchema = createCategorySchema(t);

  /** What the right-hand panel is showing. */
  type Selection =
    | { type: "product"; id: string }
    | { type: "new"; categoryId?: string };
  const [selection, setSelection] = useState<Selection | null>(null);
  // AI photo-import: promoted from a conditional tab to a persistent header
  // action + full-screen modal so it's always discoverable.
  const [importModalOpen, setImportModalOpen] = useState(false);
  // True while MenuImportTab holds an unsaved draft (or a parse is running) —
  // the Modal closes on Escape/backdrop unconditionally, which would unmount
  // the tab and destroy a quota-consuming parse + manual price edits.
  const [importDirty, setImportDirty] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const { data: menuImportStatus } = useMenuImportStatus();
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [allCategoriesExpanded, setAllCategoriesExpanded] = useState(true);

  // Modifier states
  const [modifierGroupModalOpen, setModifierGroupModalOpen] = useState(false);
  const [modifierItemModalOpen, setModifierItemModalOpen] = useState(false);
  const [editingModifierGroup, setEditingModifierGroup] =
    useState<ModifierGroup | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);
  const [selectedGroupIdForModifier, setSelectedGroupIdForModifier] =
    useState<string>("");

  const {
    data: categories,
    isLoading: categoriesLoading,
    isError: categoriesError,
    error: categoriesErrorObj,
    refetch: refetchCategories,
  } = useCategories();
  const {
    data: products,
    isLoading: productsLoading,
    isError: productsError,
    error: productsErrorObj,
    refetch: refetchProducts,
  } = useProducts();

  // Check limits for categories and products
  const categoryLimit = checkLimit("maxCategories", categories?.length ?? 0);
  const productLimit = checkLimit("maxProducts", products?.length ?? 0);
  const canAddCategory = categoryLimit.allowed;
  const canAddProduct = productLimit.allowed;
  const { mutate: createCategory, isPending: isCreatingCategory } =
    useCreateCategory();
  const { mutate: updateCategory, isPending: isUpdatingCategory } =
    useUpdateCategory();
  const isSavingCategory = isCreatingCategory || isUpdatingCategory;
  const { mutate: deleteCategory } = useDeleteCategory();
  const { mutate: deleteProduct } = useDeleteProduct();

  // Modifier hooks
  const { data: modifierGroups, isLoading: modifierGroupsLoading } =
    useModifierGroups(true);
  const { mutate: createModifierGroup, isPending: isCreatingModifierGroup } =
    useCreateModifierGroup();
  const { mutate: updateModifierGroup, isPending: isUpdatingModifierGroup } =
    useUpdateModifierGroup();
  const { mutate: deleteModifierGroup } = useDeleteModifierGroup();
  const { mutate: createModifier, isPending: isCreatingModifier } =
    useCreateModifier();
  const { mutate: updateModifier, isPending: isUpdatingModifier } =
    useUpdateModifier();
  const { mutate: deleteModifier } = useDeleteModifier();

  const categoryForm = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
  });

  const handleOpenCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      categoryForm.reset({
        name: category.name,
        description: category.description || "",
        displayOrder: category.displayOrder,
      });
    } else {
      setEditingCategory(null);
      categoryForm.reset({});
    }
    setCategoryModalOpen(true);
  };

  // The product add/edit experience is now a dedicated page, not a modal.
  const handleOpenProductModal = (product?: Product, categoryId?: string) => {
    if (product) {
      navigate(`/admin/menu/products/${product.id}/edit`);
    } else {
      navigate(
        `/admin/menu/products/new${categoryId ? `?categoryId=${categoryId}` : ""}`,
      );
    }
  };

  const handleCloseImportModal = () => {
    if (
      importDirty &&
      !window.confirm(
        t(
          "menu.importCloseConfirm",
          "İçe aktarma taslağı kaydedilmedi — kapatırsanız taslak ve düzenlemeleriniz silinecek. Yine de kapatılsın mı?",
        ),
      )
    ) {
      return;
    }
    setImportModalOpen(false);
    setImportDirty(false);
  };

  const handleCategorySubmit = (data: CategoryFormData) => {
    // Double-submit guard: Enter + click (or two quick clicks) while the
    // first mutation is in flight would create the category twice.
    if (isSavingCategory) return;
    if (editingCategory) {
      updateCategory(
        { id: editingCategory.id, data },
        {
          onSuccess: () => {
            setCategoryModalOpen(false);
            categoryForm.reset();
          },
        },
      );
    } else {
      createCategory(data, {
        onSuccess: () => {
          setCategoryModalOpen(false);
          categoryForm.reset();
        },
      });
    }
  };

  const handleDeleteCategoryConfirm = (category: Category) => {
    if (confirm(t("menu.confirmDeleteCategory"))) {
      deleteCategory(category.id);
    }
  };

  const handleDeleteProductConfirm = (product: Product) => {
    if (confirm(t("menu.confirmDeleteItem"))) {
      deleteProduct(product.id);
    }
  };

  // Modifier Handlers
  const handleOpenModifierGroupModal = (group?: ModifierGroup) => {
    if (group) {
      setEditingModifierGroup(group);
    } else {
      setEditingModifierGroup(null);
    }
    setModifierGroupModalOpen(true);
  };

  const handleModifierGroupSubmit = (data: CreateModifierGroupDto) => {
    if (editingModifierGroup) {
      updateModifierGroup(
        { id: editingModifierGroup.id, data },
        {
          onSuccess: () => {
            setModifierGroupModalOpen(false);
            setEditingModifierGroup(null);
          },
        },
      );
    } else {
      createModifierGroup(data, {
        onSuccess: () => {
          setModifierGroupModalOpen(false);
        },
      });
    }
  };

  const handleDeleteModifierGroup = (group: ModifierGroup) => {
    if (confirm(t("menu.confirmDeleteModifierGroup"))) {
      deleteModifierGroup(group.id);
    }
  };

  const handleOpenModifierItemModal = (
    groupId: string,
    modifier?: Modifier,
  ) => {
    setSelectedGroupIdForModifier(groupId);
    if (modifier) {
      setEditingModifier(modifier);
    } else {
      setEditingModifier(null);
    }
    setModifierItemModalOpen(true);
  };

  const handleModifierItemSubmit = (data: CreateModifierDto) => {
    if (editingModifier) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { groupId, ...updateData } = data;
      updateModifier(
        { id: editingModifier.id, data: updateData },
        {
          onSuccess: () => {
            setModifierItemModalOpen(false);
            setEditingModifier(null);
          },
        },
      );
    } else {
      createModifier(data, {
        onSuccess: () => {
          setModifierItemModalOpen(false);
        },
      });
    }
  };

  const handleDeleteModifier = (modifier: Modifier) => {
    if (confirm(t("menu.confirmDeleteModifier"))) {
      deleteModifier(modifier.id);
    }
  };

  const isLoading = categoriesLoading || productsLoading;

  // Selection drives the right-hand panel. `new` carries the category the
  // operator was standing in, so "+" inside a category lands pre-filled.
  const selectedProduct = useMemo(
    () =>
      selection?.type === "product"
        ? (products ?? []).find((p) => p.id === selection.id) ?? null
        : null,
    [selection, products],
  );

  const closePanel = () => setSelection(null);

  return (
    // From lg up this page is a two-pane workspace that fills the shell's
    // content area exactly and lets each pane scroll on its own — h-full
    // resolves against <main>, so it stays right whatever the header and
    // banners are doing (see the page-height contract in Layout.tsx).
    // Below lg it is a plain stacked page that scrolls in <main>.
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="flex flex-wrap items-end justify-between gap-3 lg:shrink-0">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-900">
            {t("menu.title")}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("menu.manageCategoriesAndProducts")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setBulkAddOpen(true)}
            disabled={!canAddProduct}
          >
            <ListPlus className="mr-1.5 h-4 w-4" />
            {t("menu.bulkAdd", "Toplu ekle")}
          </Button>
          {menuImportStatus?.configured !== false && (
            <Button variant="outline" onClick={() => setImportModalOpen(true)}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {t("menu.importAction", "Fotoğraftan menü")}
            </Button>
          )}
          <Button
            onClick={() => setSelection({ type: "new" })}
            disabled={!canAddProduct}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("menu.addItem", "Yeni ürün")}
          </Button>
        </div>
      </div>

      {!canAddProduct && (
        <div className="lg:shrink-0">
          <UpgradePrompt
            limitKey="maxProducts"
            currentCount={products?.length ?? 0}
            limit={productLimit.limit}
            compact
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16 lg:shrink-0">
          <Spinner />
        </div>
      ) : categoriesError || productsError ? (
        <ErrorState
          error={categoriesError ? categoriesErrorObj : productsErrorObj}
          onRetry={() => {
            refetchCategories();
            refetchProducts();
          }}
        />
      ) : (
        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[22rem_minmax(0,1fr)]">
          {/* The spine. Hidden on a phone once something is open: two panes
              side by side at 390px is neither.
              lg:h-full — not max-h plus a 100vh guess — is what makes
              MenuTree's own `flex-1 overflow-y-auto` bound and scroll. A
              max-height alone leaves this box's height indefinite, so the
              tree's h-full collapsed to auto and overflow-hidden ate the
              bottom of the list: 263px of categories unreachable at
              1280x720, with no scrollbar anywhere to reveal them. */}
          <aside
            className={cn(
              "overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-full lg:min-h-0",
              selection ? "hidden lg:block" : "block",
            )}
          >
            <MenuTree
              categories={categories ?? []}
              products={products ?? []}
              selectedProductId={
                selection?.type === "product" ? selection.id : null
              }
              onSelectProduct={(product) =>
                setSelection({ type: "product", id: product.id })
              }
              onAddProduct={(categoryId) =>
                setSelection({ type: "new", categoryId })
              }
              onAddCategory={() => handleOpenCategoryModal()}
              onEditCategory={handleOpenCategoryModal}
              canAddProduct={canAddProduct}
              canAddCategory={canAddCategory}
            />
          </aside>

          <section
            className={cn(
              "rounded-xl border border-slate-200 bg-white",
              "lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden",
              selection ? "block" : "hidden lg:flex",
            )}
          >
            {selection ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 lg:shrink-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={closePanel}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
                      aria-label={t("common:app.back", "Geri")}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <h2 className="truncate text-sm font-semibold text-slate-900">
                      {selection.type === "new"
                        ? t("menu.addItem", "Yeni ürün")
                        : selectedProduct?.name ?? ""}
                    </h2>
                  </div>
                  {selection.type === "product" && selectedProduct && (
                    <button
                      type="button"
                      onClick={() => {
                        handleDeleteProductConfirm(selectedProduct);
                        closePanel();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("common:app.delete", "Sil")}
                    </button>
                  )}
                </div>

                <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {/* key: remount on selection change so the editor's form
                      state and draft ref never leak between products. */}
                  <ProductEditorPage
                    key={
                      selection.type === "product"
                        ? selection.id
                        : `new-${selection.categoryId ?? "none"}`
                    }
                    embedded
                    productId={
                      selection.type === "product" ? selection.id : undefined
                    }
                    defaultCategoryId={
                      selection.type === "new" ? selection.categoryId : undefined
                    }
                    onSaved={closePanel}
                    onCancel={closePanel}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-20 text-center lg:min-h-0 lg:flex-1">
                <Package className="h-10 w-10 text-slate-300" />
                <h2 className="mt-3 text-sm font-semibold text-slate-900">
                  {t("menu.pickProduct", "Soldan bir ürün seçin")}
                </h2>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  {t(
                    "menu.pickProductHint",
                    "Fotoğraf, seçenekler, koleksiyonlar ve fiyat — hepsi bu panelde, aynı yerde düzenlenir.",
                  )}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* AI menu import (photo → digitized menu) — full-screen modal */}
      <Modal
        isOpen={importModalOpen}
        onClose={handleCloseImportModal}
        title={t("menu.importAction", "Fotoğraftan menü")}
        size="full"
      >
        <MenuImportTab onDirtyChange={setImportDirty} />
      </Modal>

      {/* Bulk product add */}
      <BulkAddModal isOpen={bulkAddOpen} onClose={() => setBulkAddOpen(false)} />


      {/* Category Modal */}
      <Modal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategory ? t("menu.editCategory") : t("menu.addCategory")}
        size="sm"
      >
        <form
          onSubmit={categoryForm.handleSubmit(handleCategorySubmit)}
          className="space-y-3"
        >
          <Input
            label={t("menu.categoryName")}
            error={categoryForm.formState.errors.name?.message}
            {...categoryForm.register("name")}
          />
          <Input
            label={t("menu.description")}
            error={categoryForm.formState.errors.description?.message}
            {...categoryForm.register("description")}
          />
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setCategoryModalOpen(false)}
            >
              {t("common:app.cancel")}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              isLoading={isSavingCategory}
              disabled={isSavingCategory}
            >
              {editingCategory
                ? t("common:app.update")
                : t("common:app.create")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modifier Group Modal */}
      <ModifierGroupModal
        isOpen={modifierGroupModalOpen}
        onClose={() => {
          setModifierGroupModalOpen(false);
          setEditingModifierGroup(null);
        }}
        onSubmit={handleModifierGroupSubmit}
        editingGroup={editingModifierGroup}
        isLoading={isCreatingModifierGroup || isUpdatingModifierGroup}
      />

      {/* Modifier Item Modal */}
      <ModifierItemModal
        isOpen={modifierItemModalOpen}
        onClose={() => {
          setModifierItemModalOpen(false);
          setEditingModifier(null);
        }}
        onSubmit={handleModifierItemSubmit}
        editingModifier={editingModifier}
        groupId={selectedGroupIdForModifier}
        isLoading={isCreatingModifier || isUpdatingModifier}
      />
    </div>
  );
};

export default MenuManagementPage;
