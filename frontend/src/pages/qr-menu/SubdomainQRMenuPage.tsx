import { useState } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import QRMenuContent from '../../components/qr-menu/QRMenuContent';

interface SubdomainQRMenuPageProps {
  subdomain: string;
  searchQuery?: string;
}

const SubdomainQRMenuPage: React.FC<SubdomainQRMenuPageProps> = ({ subdomain, searchQuery = '' }) => {
  const [menuData, setMenuData] = useState<MenuData | null>(null);

  return (
    <QRMenuLayout currentPage="menu" onMenuDataLoaded={setMenuData} subdomain={subdomain}>
      {menuData && (
        <QRMenuContent
          categories={menuData.categories}
          settings={menuData.settings}
          tenant={menuData.tenant}
          enableCustomerOrdering={menuData.enableCustomerOrdering}
          searchQuery={searchQuery}
        />
      )}
    </QRMenuLayout>
  );
};

export default SubdomainQRMenuPage;
