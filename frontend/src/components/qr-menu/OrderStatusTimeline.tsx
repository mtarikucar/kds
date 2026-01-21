import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Clock, CheckCircle2, ChefHat, Utensils, ThumbsUp } from 'lucide-react';
import { cn } from '../../lib/utils';

type OrderStatus = 'PENDING_APPROVAL' | 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';

interface OrderStatusTimelineProps {
  currentStatus: string;
  primaryColor: string;
  compact?: boolean;
}

const OrderStatusTimeline: React.FC<OrderStatusTimelineProps> = ({
  currentStatus,
  primaryColor,
  compact = false,
}) => {
  const { t } = useTranslation('common');

  const statuses: { key: OrderStatus; label: string; icon: React.ElementType }[] = [
    { key: 'PENDING_APPROVAL', label: t('orderStatus.pendingApproval', 'Awaiting'), icon: Clock },
    { key: 'PENDING', label: t('orderStatus.pending', 'Confirmed'), icon: CheckCircle2 },
    { key: 'PREPARING', label: t('orderStatus.preparing', 'Preparing'), icon: ChefHat },
    { key: 'READY', label: t('orderStatus.ready', 'Ready'), icon: ThumbsUp },
    { key: 'SERVED', label: t('orderStatus.served', 'Served'), icon: Utensils },
  ];

  const currentIndex = statuses.findIndex(s => s.key === currentStatus);

  // For compact mode, only show current and adjacent statuses
  const displayStatuses = compact
    ? statuses.filter((_, i) => Math.abs(i - currentIndex) <= 1)
    : statuses;

  const getStatusState = (index: number) => {
    const actualIndex = compact
      ? statuses.findIndex(s => s.key === displayStatuses[index].key)
      : index;

    if (actualIndex < currentIndex) return 'completed';
    if (actualIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <div className={cn('flex items-center justify-between', compact ? 'gap-2' : 'gap-1')}>
      {displayStatuses.map((status, index) => {
        const state = getStatusState(index);
        const Icon = status.icon;
        const isLast = index === displayStatuses.length - 1;

        return (
          <React.Fragment key={status.key}>
            {/* Status Step */}
            <div className="flex flex-col items-center gap-1">
              {/* Circle */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.1, type: 'spring' }}
                className={cn(
                  'relative flex items-center justify-center rounded-full transition-all duration-300',
                  compact ? 'w-8 h-8' : 'w-10 h-10',
                  state === 'completed' && 'bg-green-500',
                  state === 'current' && 'ring-4 ring-opacity-30',
                  state === 'upcoming' && 'bg-slate-200'
                )}
                style={{
                  backgroundColor: state === 'current' ? primaryColor : undefined,
                  '--tw-ring-color': state === 'current' ? primaryColor : undefined,
                } as React.CSSProperties}
              >
                {state === 'current' && (
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: primaryColor }}
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    initial={{ opacity: 0.3 }}
                  />
                )}
                <Icon
                  className={cn(
                    'relative z-10 transition-colors',
                    compact ? 'h-4 w-4' : 'h-5 w-5',
                    state === 'completed' && 'text-white',
                    state === 'current' && 'text-white',
                    state === 'upcoming' && 'text-slate-400'
                  )}
                />
              </motion.div>

              {/* Label */}
              {!compact && (
                <span
                  className={cn(
                    'text-xs font-medium text-center max-w-[60px] leading-tight',
                    state === 'completed' && 'text-green-600',
                    state === 'current' && 'font-bold',
                    state === 'upcoming' && 'text-slate-400'
                  )}
                  style={{ color: state === 'current' ? primaryColor : undefined }}
                >
                  {status.label}
                </span>
              )}
            </div>

            {/* Connector Line */}
            {!isLast && (
              <div className={cn('flex-1 h-0.5 rounded-full relative', compact ? 'mx-1' : 'mx-2')}>
                <div className="absolute inset-0 bg-slate-200 rounded-full" />
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{
                    scaleX: state === 'completed' || getStatusState(index + 1) !== 'upcoming' ? 1 : 0,
                  }}
                  transition={{ delay: index * 0.15, duration: 0.3 }}
                  className="absolute inset-0 rounded-full origin-left"
                  style={{
                    backgroundColor: getStatusState(index + 1) === 'upcoming' ? primaryColor : '#22c55e',
                  }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default OrderStatusTimeline;
