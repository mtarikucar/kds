import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Category, Product } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import { UtensilsCrossed, Search } from 'lucide-react';

interface MenuSettings {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  fontFamily: string;
  logoUrl?: string;
  showRestaurantInfo: boolean;
  showPrices: boolean;
  showDescription: boolean;
  showImages: boolean;
  layoutStyle: 'GRID' | 'LIST' | 'COMPACT';
  itemsPerRow: number;
}

interface MenuData {
  tenant: {
    id: string;
    name: string;
  };
  table?: {
    id: string;
    number: string;
  };
  settings: MenuSettings;
  categories: (Category & { products: Product[] })[];
}

const QRMenuPage = () => {
  const { t } = useTranslation('common');
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        setIsLoading(true);
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

        const url = tableId
          ? `${API_URL}/qr-menu/${tenantId}?tableId=${tableId}`
          : `${API_URL}/qr-menu/${tenantId}`;

        const response = await axios.get(url);
        setMenuData(response.data);
        setIsLoading(false);
      } catch (err: any) {
  console.error('Error fetching menu data:', err);
  setError(err.response?.data?.message || t('messages.operationFailed'));
        setIsLoading(false);
      }
    };

    if (tenantId) {
      fetchMenuData();
    }
  }, [tenantId, tableId]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <p className="text-gray-600">{t('messages.contactSupport')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!menuData) return null;

  const { tenant, table, settings, categories } = menuData;

  // Get all products from all categories
  const allProducts = categories.flatMap(cat => cat.products);

  // Filter products based on category and search query
  const filteredProducts = allProducts.filter((product) => {
    const matchesCategory = !selectedCategory || product.categoryId === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: settings.backgroundColor,
        fontFamily: settings.fontFamily,
      }}
    >
      {/* Header */}
      <div
        className="shadow-sm sticky top-0 z-10"
        style={{ backgroundColor: settings.primaryColor }}
      >
        <div className="max-w-4xl mx-auto px-4 py-6">
          {settings.showRestaurantInfo && (
            <div className="flex items-center gap-3 mb-4">
              {settings.logoUrl ? (
                <img
                  src={settings.logoUrl}
                  alt={tenant.name}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div
                  className="h-12 w-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: settings.secondaryColor }}
                >
                  <UtensilsCrossed className="h-6 w-6 text-white" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-white">{tenant.name}</h1>
                {table && (
                  <p className="text-sm text-white/90">{t('qrMenu.tableLabel')} {table.number}</p>
                )}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/70" />
            <input
              type="text"
              placeholder={t('qrMenu.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border-2 border-white/30 bg-white/10 text-white placeholder-white/70 rounded-lg focus:outline-none focus:ring-2 focus:ring-white/50"
            />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Categories */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory('')}
            className={`px-4 py-2 rounded-full whitespace-nowrap border-2 transition-colors`}
            style={{
              backgroundColor: !selectedCategory ? settings.primaryColor : 'white',
              color: !selectedCategory ? 'white' : settings.secondaryColor,
              borderColor: settings.primaryColor,
            }}
          >
            {t('qrMenu.all')}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-full whitespace-nowrap border-2 transition-colors`}
              style={{
                backgroundColor: selectedCategory === category.id ? settings.primaryColor : 'white',
                color: selectedCategory === category.id ? 'white' : settings.secondaryColor,
                borderColor: settings.primaryColor,
              }}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Products */}
        <div>
          {filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-gray-500">{t('qrMenu.noItemsFound')}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* LIST Layout */}
              {settings.layoutStyle === 'LIST' && (
                <div className="space-y-4">
                  {filteredProducts.map((product) => {
                    const imageUrl = product.image || product.images?.[0]?.url;
                    return (
                    <Card key={product.id} className="overflow-hidden bg-white">
                      <CardContent className="p-0">
                        <div className="flex gap-4">
                          {settings.showImages && (
                            imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={product.name}
                                className="w-32 h-32 object-cover"
                              />
                            ) : (
                              <div className="w-32 h-32 bg-gray-200 flex items-center justify-center">
                                <UtensilsCrossed className="h-12 w-12 text-gray-400" />
                              </div>
                            )
                          )}
                          <div className="flex-1 p-4">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <h3
                                  className="text-lg font-semibold"
                                  style={{ color: settings.secondaryColor }}
                                >
                                  {product.name}
                                </h3>
                                {settings.showDescription && product.description && (
                                  <p className="text-sm text-gray-600 mt-1">
                                    {product.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            {settings.showPrices && (
                              <div className="flex items-center justify-between mt-3">
                                <p
                                  className="text-xl font-bold"
                                  style={{ color: settings.primaryColor }}
                                >
                                  {formatCurrency(product.price, 'USD')}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                </div>
              )}

              {/* GRID Layout */}
              {settings.layoutStyle === 'GRID' && (
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: `repeat(${settings.itemsPerRow}, minmax(0, 1fr))`,
                  }}
                >
                  {filteredProducts.map((product) => {
                    const imageUrl = product.image || product.images?.[0]?.url;
                    return (
                    <Card key={product.id} className="overflow-hidden bg-white">
                      <CardContent className="p-0">
                        {settings.showImages && (
                          imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={product.name}
                              className="w-full h-48 object-cover"
                            />
                          ) : (
                            <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                              <UtensilsCrossed className="h-16 w-16 text-gray-400" />
                            </div>
                          )
                        )}
                        <div className="p-4">
                          <h3
                            className="text-lg font-semibold mb-2"
                            style={{ color: settings.secondaryColor }}
                          >
                            {product.name}
                          </h3>
                          {settings.showDescription && product.description && (
                            <p className="text-sm text-gray-600 mb-3">
                              {product.description}
                            </p>
                          )}
                          {settings.showPrices && (
                            <p
                              className="text-xl font-bold"
                              style={{ color: settings.primaryColor }}
                            >
                              {formatCurrency(product.price, 'USD')}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                </div>
              )}

              {/* COMPACT Layout */}
              {settings.layoutStyle === 'COMPACT' && (
                <div className="space-y-2">
                  {filteredProducts.map((product) => (
                    <Card key={product.id} className="bg-white">
                      <CardContent className="p-3">
                        <div className="flex justify-between items-center">
                          <h3
                            className="text-base font-semibold"
                            style={{ color: settings.secondaryColor }}
                          >
                            {product.name}
                          </h3>
                          {settings.showPrices && (
                            <p
                              className="text-lg font-bold"
                              style={{ color: settings.primaryColor }}
                            >
                              {formatCurrency(product.price, 'USD')}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="border-t mt-12"
        style={{
          backgroundColor: settings.primaryColor,
          borderColor: settings.secondaryColor,
        }}
      >
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-white">
          <p>{t('qrMenu.poweredBy')}</p>
        </div>
      </div>
    </div>
  );
};

export default QRMenuPage;
