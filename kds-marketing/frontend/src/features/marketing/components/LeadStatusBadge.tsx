import { LeadStatus, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '../types';

interface LeadStatusBadgeProps {
  status: LeadStatus | string;
}

export default function LeadStatusBadge({ status }: LeadStatusBadgeProps) {
  const label = LEAD_STATUS_LABELS[status as LeadStatus] || status;
  const colorClass = LEAD_STATUS_COLORS[status as LeadStatus] || 'bg-gray-100 text-gray-800';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}
