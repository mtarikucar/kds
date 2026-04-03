import { useMarketingAuthStore } from '../../../store/marketingAuthStore';

export default function MarketingHeader() {
  const { user } = useMarketingAuthStore();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-gray-900 lg:hidden">
          Marketing Panel
        </h1>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">
          Welcome, <span className="font-medium text-gray-900">{user?.firstName}</span>
        </span>
      </div>
    </header>
  );
}
