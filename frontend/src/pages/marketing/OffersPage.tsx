import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import marketingApi from '../../features/marketing/api/marketingApi';
import type { LeadOffer } from '../../features/marketing/types';

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
};

export default function OffersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['marketing', 'offers'],
    queryFn: () => marketingApi.get('/offers').then((r) => r.data),
  });

  const offers: LeadOffer[] = data?.data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Offers</h1>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Price</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Discount</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Trial Days</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Valid Until</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Created By</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : offers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No offers found</td>
                </tr>
              ) : (
                offers.map((offer) => (
                  <tr key={offer.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {offer.lead ? (
                        <Link
                          to={`/marketing/leads/${offer.lead.id}`}
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {offer.lead.businessName}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[offer.status] || 'bg-gray-100'}`}>
                        {offer.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {offer.customPrice ? `$${offer.customPrice}` : '-'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {offer.discount ? `${offer.discount}%` : '-'}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {offer.trialDays || '-'}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">
                      {offer.validUntil ? new Date(offer.validUntil).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                      {offer.createdBy ? `${offer.createdBy.firstName} ${offer.createdBy.lastName}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(offer.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
