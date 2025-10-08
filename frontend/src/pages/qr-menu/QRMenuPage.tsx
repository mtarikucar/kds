import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Category, Product, Tenant } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import { UtensilsCrossed, Search } from 'lucide-react';

const QRMenuPage = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        setIsLoading(true);
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

        // Fetch tenant info
        const tenantResponse = await axios.get(`${API_URL}/tenants/${tenantId}`);
        setTenant(tenantResponse.data);

        // Fetch categories
        const categoriesResponse = await axios.get(`${API_URL}/categories`, {
          headers: { 'X-Tenant-ID': tenantId },
        });
        setCategories(categoriesResponse.data);

        // Fetch products
        const productsResponse = await axios.get(`${API_URL}/products`, {
          headers: { 'X-Tenant-ID': tenantId },
          params: { isAvailable: true },
        });
        setProducts(productsResponse.data);

        setIsLoading(false);
      } catch (err: any) {
        console.error('Error fetching menu data:', err);
        setError(err.response?.data?.message || 'Failed to load menu');
        setIsLoading(false);
      }
    };

    if (tenantId) {
      fetchMenuData();
    }
  }, [tenantId]);

  const filteredProducts = products.filter((product) => {
    const matchesCategory = !selectedCategory || product.categoryId === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

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
            <p className="text-gray-600">Please contact the restaurant for assistance.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            {tenant?.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt={tenant.name}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
                <UtensilsCrossed className="h-6 w-6 text-white" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{tenant?.name}</h1>
              {tenant?.address && (
                <p className="text-sm text-gray-600">{tenant.address}</p>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search menu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Categories */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory('')}
            className={`px-4 py-2 rounded-full whitespace-nowrap ${
              !selectedCategory
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300'
            }`}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-full whitespace-nowrap ${
                selectedCategory === category.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Products */}
        <div className="space-y-4">
          {filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-gray-500">No items found</p>
              </CardContent>
            </Card>
          ) : (
            filteredProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex gap-4">
                    {product.imageUrl && (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-32 h-32 object-cover"
                      />
                    )}
                    <div className="flex-1 p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {product.name}
                          </h3>
                          {product.description && (
                            <p className="text-sm text-gray-600 mt-1">
                              {product.description}
                            </p>
                          )}
                        </div>
                        {product.isAvailable && (
                          <Badge variant="success">Available</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-xl font-bold text-blue-600">
                          {formatCurrency(product.price, tenant?.currency)}
                        </p>
                        {product.stock <= 5 && product.stock > 0 && (
                          <Badge variant="warning">
                            Only {product.stock} left
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white border-t mt-12">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-gray-600">
          <p>Powered by Restaurant POS System</p>
          {tenant?.phone && (
            <p className="mt-2">
              Contact: <a href={`tel:${tenant.phone}`} className="text-blue-600">{tenant.phone}</a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default QRMenuPage;
