import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Plus, Settings2, Lock, Sparkles } from "lucide-react";
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
import { useSubscription } from "../../contexts/SubscriptionContext";
import {
  createCategorySchema,
  type CategoryFormData,
} from "./menuManagement/menuSchemas";
import ModifiersTab from "./menuManagement/ModifiersTab";
import ImagesTab from "./menuManagement/ImagesTab";
import MenuTab from "./menuManagement/MenuTab";
import MenuImportTab from "./menuManagement/MenuImportTab";
import { useMenuImportStatus } from "../../features/menu/menuApi";

const MenuManagementPage = () => {
  const { t } = useTranslation(["menu", "common", "subscriptions"]);
  const navigate = useNavigate();
  const { checkLimit } = useSubscription();

  // Create translated schema
  const categorySchema = createCategorySchema(t);

  const [activeTab, setActiveTab] = useState<"menu" | "images" | "modifiers">(
    "menu",
  );
  // AI photo-import: promoted from a conditional tab to a persistent header
  // action + full-screen modal so it's always discoverable.
  const [importModalOpen, setImportModalOpen] = useState(false);
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
  const { mutate: createCategory } = useCreateCategory();
  const { mutate: updateCategory } = useUpdateCategory();
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

  const handleCategorySubmit = (data: CategoryFormData) => {
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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-heading font-bold text-slate-900">
          {t("menu.title")}
        </h1>
        <p className="text-slate-500 mt-1">
          {t("menu.manageCategoriesAndProducts")}
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 md:gap-4">
          <Button
            variant={activeTab === "menu" ? "primary" : "outline"}
            onClick={() => setActiveTab("menu")}
            size="sm"
            className="md:text-base"
          >
            {t("menu.menuTab")}
          </Button>
          <Button
            variant={activeTab === "images" ? "primary" : "outline"}
            onClick={() => setActiveTab("images")}
            size="sm"
            className="md:text-base"
          >
            {t("menu.imageLibrary")}
          </Button>
          <Button
            variant={activeTab === "modifiers" ? "primary" : "outline"}
            onClick={() => setActiveTab("modifiers")}
            size="sm"
            className="md:text-base"
          >
            <Settings2 className="h-4 w-4 mr-1 md:mr-2" />
            {t("menu.modifiers")}
          </Button>
        </div>

        {/* Header actions (menu tab): AI photo-import (always visible so it's
            discoverable — disabled with a tooltip until configured) + add category */}
        {activeTab === "menu" && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportModalOpen(true)}
              disabled={!menuImportStatus?.configured}
              title={
                menuImportStatus?.configured
                  ? undefined
                  : (t(
                      "menu.importDisabled",
                      "Yapay zeka menü içe aktarma yapılandırılmamış",
                    ) as string)
              }
            >
              <Sparkles className="h-4 w-4 mr-1 md:mr-2" />
              {t("menu.importAction", "Fotoğraftan menü")}
            </Button>
            <Button
              onClick={() => handleOpenCategoryModal()}
              disabled={!canAddCategory}
              data-tour="add-category"
            >
              {canAddCategory ? (
                <Plus className="h-4 w-4 mr-2" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              {t("menu.addCategory")}
            </Button>
          </div>
        )}
      </div>

      {/* Menu Tab - Unified Categories & Products */}
      {activeTab === "menu" && (
        <MenuTab
          categories={categories}
          products={products}
          isLoading={isLoading}
          categoriesError={categoriesError}
          productsError={productsError}
          categoriesErrorObj={categoriesErrorObj}
          productsErrorObj={productsErrorObj}
          refetchCategories={refetchCategories}
          refetchProducts={refetchProducts}
          categoryLimit={categoryLimit}
          productLimit={productLimit}
          canAddCategory={canAddCategory}
          canAddProduct={canAddProduct}
          allCategoriesExpanded={allCategoriesExpanded}
          onToggleExpandAll={() =>
            setAllCategoriesExpanded(!allCategoriesExpanded)
          }
          onAddCategory={() => handleOpenCategoryModal()}
          onEditCategory={handleOpenCategoryModal}
          onDeleteCategory={handleDeleteCategoryConfirm}
          onAddProduct={(categoryId) =>
            handleOpenProductModal(undefined, categoryId)
          }
          onEditProduct={(product) => handleOpenProductModal(product)}
          onDeleteProduct={handleDeleteProductConfirm}
        />
      )}

      {/* Image Library Tab - Minimal Design */}
      {activeTab === "images" && <ImagesTab />}

      {/* AI menu import (photo → digitized menu) — full-screen modal */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title={t("menu.importAction", "Fotoğraftan menü")}
        size="full"
      >
        <MenuImportTab />
      </Modal>

      {/* Modifiers Tab */}
      {activeTab === "modifiers" && (
        <ModifiersTab
          modifierGroups={modifierGroups}
          modifierGroupsLoading={modifierGroupsLoading}
          onAddGroup={() => handleOpenModifierGroupModal()}
          onEditGroup={handleOpenModifierGroupModal}
          onDeleteGroup={handleDeleteModifierGroup}
          onAddModifier={(groupId) => handleOpenModifierItemModal(groupId)}
          onEditModifier={(modifier) =>
            handleOpenModifierItemModal(modifier.groupId, modifier)
          }
          onDeleteModifier={handleDeleteModifier}
        />
      )}

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
            <Button type="submit" className="flex-1">
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
