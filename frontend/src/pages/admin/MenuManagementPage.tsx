import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Edit, Trash2 } from 'lucide-react';
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from '../../features/menu/menuApi';
import { Category, Product } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { formatCurrency } from '../../lib/utils';

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  displayOrder: z.number().optional(),
});

const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  price: z.number().min(0, 'Price must be positive'),
  categoryId: z.string().min(1, 'Category is required'),
  currentStock: z.number().min(0, 'Stock must be positive').optional(),
  image: z.string().url('Invalid URL').optional().or(z.literal('')),
  isAvailable: z.boolean().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;
type ProductFormData = z.infer<typeof productSchema>;

const MenuManagementPage = () => {
  const [activeTab, setActiveTab] = useState<'categories' | 'products'>('categories');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { mutate: createCategory } = useCreateCategory();
  const { mutate: updateCategory } = useUpdateCategory();
  const { mutate: deleteCategory } = useDeleteCategory();
  const { mutate: createProduct } = useCreateProduct();
  const { mutate: updateProduct } = useUpdateProduct();
  const { mutate: deleteProduct } = useDeleteProduct();

  const categoryForm = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
  });

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
  });

  const handleOpenCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      categoryForm.reset({
        name: category.name,
        description: category.description || '',
        displayOrder: category.displayOrder,
      });
    } else {
      setEditingCategory(null);
      categoryForm.reset({});
    }
    setCategoryModalOpen(true);
  };

  const handleOpenProductModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      productForm.reset({
        name: product.name,
        description: product.description || '',
        price: product.price,
        categoryId: product.categoryId,
        currentStock: product.currentStock,
        image: product.image || '',
        isAvailable: product.isAvailable,
      });
    } else {
      setEditingProduct(null);
      productForm.reset({});
    }
    setProductModalOpen(true);
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
        }
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

  const handleProductSubmit = (data: ProductFormData) => {
    const submitData = {
      ...data,
      price: Number(data.price),
      currentStock: data.currentStock ? Number(data.currentStock) : 0,
    };

    if (editingProduct) {
      updateProduct(
        { id: editingProduct.id, data: submitData },
        {
          onSuccess: () => {
            setProductModalOpen(false);
            productForm.reset();
          },
        }
      );
    } else {
      createProduct(submitData, {
        onSuccess: () => {
          setProductModalOpen(false);
          productForm.reset();
        },
      });
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Menu Management</h1>
          <p className="text-gray-600">Manage categories and products</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-4">
        <Button
          variant={activeTab === 'categories' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('categories')}
        >
          Categories
        </Button>
        <Button
          variant={activeTab === 'products' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('products')}
        >
          Products
        </Button>
      </div>

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Categories</CardTitle>
            <Button onClick={() => handleOpenCategoryModal()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Category
            </Button>
          </CardHeader>
          <CardContent>
            {categoriesLoading ? (
              <Spinner />
            ) : (
              <div className="space-y-2">
                {categories?.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <h3 className="font-semibold">{category.name}</h3>
                      {category.description && (
                        <p className="text-sm text-gray-600">
                          {category.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenCategoryModal(category)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this category?')) {
                            deleteCategory(category.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Products Tab */}
      {activeTab === 'products' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Products</CardTitle>
            <Button onClick={() => handleOpenProductModal()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </CardHeader>
          <CardContent>
            {productsLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {products?.map((product) => (
                  <div key={product.id} className="border rounded-lg p-4">
                    {product.image && (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-32 object-cover rounded-md mb-3"
                      />
                    )}
                    <div className="mb-3">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold">{product.name}</h3>
                        <Badge variant={product.isAvailable ? 'success' : 'danger'}>
                          {product.isAvailable ? 'Available' : 'Unavailable'}
                        </Badge>
                      </div>
                      {product.description && (
                        <p className="text-sm text-gray-600 mb-2">
                          {product.description}
                        </p>
                      )}
                      <p className="text-lg font-bold text-blue-600">
                        {formatCurrency(product.price)}
                      </p>
                      <p className="text-sm text-gray-600">
                        Stock: {product.currentStock}
                      </p>
                      <p className="text-sm text-gray-600">
                        Category: {product.category?.name}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleOpenProductModal(product)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this product?')) {
                            deleteProduct(product.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Category Modal */}
      <Modal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategory ? 'Edit Category' : 'Add Category'}
      >
        <form
          onSubmit={categoryForm.handleSubmit(handleCategorySubmit)}
          className="space-y-4"
        >
          <Input
            label="Name"
            error={categoryForm.formState.errors.name?.message}
            {...categoryForm.register('name')}
          />
          <Input
            label="Description"
            error={categoryForm.formState.errors.description?.message}
            {...categoryForm.register('description')}
          />
          <Input
            label="Display Order"
            type="number"
            error={categoryForm.formState.errors.displayOrder?.message}
            {...categoryForm.register('displayOrder', { valueAsNumber: true })}
          />
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setCategoryModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Product Modal */}
      <Modal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProduct ? 'Edit Product' : 'Add Product'}
        size="lg"
      >
        <form
          onSubmit={productForm.handleSubmit(handleProductSubmit)}
          className="space-y-4"
        >
          <Input
            label="Name"
            error={productForm.formState.errors.name?.message}
            {...productForm.register('name')}
          />
          <Input
            label="Description"
            error={productForm.formState.errors.description?.message}
            {...productForm.register('description')}
          />
          <Input
            label="Price"
            type="number"
            step="0.01"
            error={productForm.formState.errors.price?.message}
            {...productForm.register('price', { valueAsNumber: true })}
          />
          <Select
            label="Category"
            options={
              categories?.map((cat) => ({
                value: cat.id,
                label: cat.name,
              })) || []
            }
            error={productForm.formState.errors.categoryId?.message}
            {...productForm.register('categoryId')}
          />
          <Input
            label="Current Stock"
            type="number"
            error={productForm.formState.errors.currentStock?.message}
            {...productForm.register('currentStock', { valueAsNumber: true })}
          />
          <Input
            label="Image URL"
            error={productForm.formState.errors.image?.message}
            {...productForm.register('image')}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isAvailable"
              {...productForm.register('isAvailable')}
              className="rounded"
            />
            <label htmlFor="isAvailable" className="text-sm font-medium">
              Available
            </label>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setProductModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              {editingProduct ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default MenuManagementPage;
