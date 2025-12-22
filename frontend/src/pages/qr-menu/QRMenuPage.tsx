import { useState } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import QRMenuContent from '../../components/qr-menu/QRMenuContent';

interface QRMenuPageProps {
  searchQuery?: string;
}

const QRMenuPage: React.FC<QRMenuPageProps> = ({ searchQuery = '' }) => {
  const [menuData, setMenuData] = useState<MenuData | null>(null);

  return (
    <QRMenuLayout currentPage="menu" onMenuDataLoaded={setMenuData}>
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

export default QRMenuPage;
