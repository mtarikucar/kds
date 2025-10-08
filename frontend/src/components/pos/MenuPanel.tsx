import { useState } from 'react';
import { useCategories } from '../../features/menu/menuApi';
import { useProducts } from '../../features/menu/menuApi';
import { Product } from '../../types';
import { Card } from '../ui/Card';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import { Plus } from 'lucide-react';

interface MenuPanelProps {
  onAddItem: (product: Product) => void;
}

const MenuPanel = ({ onAddItem }: MenuPanelProps) => {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: products, isLoading: productsLoading } = useProducts({
    categoryId: selectedCategoryId || undefined,
    isAvailable: true,
  });

  if (categoriesLoading) {
    return <Spinner />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Category Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <Button
          variant={!selectedCategoryId ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategoryId('')}
        >
          All
        </Button>
        {categories?.map((category) => (
          <Button
            key={category.id}
            variant={selectedCategoryId === category.id ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategoryId(category.id)}
          >
            {category.name}
          </Button>
        ))}
      </div>

      {/* Products Grid */}
      <div className="flex-1 overflow-y-auto">
        {productsLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products?.map((product) => (
              <Card
                key={product.id}
                className="p-4 cursor-pointer hover:shadow-md transition-all"
                onClick={() => onAddItem(product)}
              >
                {product.imageUrl && (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-32 object-cover rounded-md mb-2"
                  />
                )}
                <div className="text-center">
                  <h3 className="font-semibold text-sm mb-1">{product.name}</h3>
                  <p className="text-blue-600 font-bold">
                    {formatCurrency(product.price)}
                  </p>
                  {product.stock <= 5 && (
                    <p className="text-xs text-red-600 mt-1">
                      Low stock: {product.stock}
                    </p>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddItem(product);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MenuPanel;
