import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistance } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatDate(date: string | Date, formatStr: string = 'PPP'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, formatStr);
}

export function formatDateTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, 'PPP p');
}

export function formatTimeAgo(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return formatDistance(dateObj, new Date(), { addSuffix: true });
}

export function formatTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, 'p');
}

export function calculateOrderTotal(
  items: Array<{ quantity: number; price: number }>,
  discount: number = 0
): number {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return subtotal - discount;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Order statuses
    pending: 'bg-yellow-100 text-yellow-800',
    preparing: 'bg-blue-100 text-blue-800',
    ready: 'bg-green-100 text-green-800',
    served: 'bg-slate-100 text-slate-800',
    cancelled: 'bg-red-100 text-red-800',

    // Table statuses
    available: 'bg-green-100 text-green-800',
    occupied: 'bg-blue-100 text-blue-800',
    reserved: 'bg-yellow-100 text-yellow-800',

    // Payment statuses
    paid: 'bg-green-100 text-green-800',
    unpaid: 'bg-yellow-100 text-yellow-800',
    refunded: 'bg-red-100 text-red-800',
  };

  return colors[status.toLowerCase()] || 'bg-slate-100 text-slate-800';
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

// KDS Urgency System
export type UrgencyLevel = 'fresh' | 'attention' | 'urgent' | 'critical';

export interface UrgencyStyles {
  border: string;
  badge: string;
  text: string;
  bg: string;
}

/**
 * Calculate urgency level based on order age
 * - < 5 min: fresh (green)
 * - 5-10 min: attention (amber)
 * - 10-15 min: urgent (orange)
 * - > 15 min: critical (red)
 */
export function getOrderUrgency(createdAt: string): UrgencyLevel {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffMinutes = (now - created) / 60000;

  if (diffMinutes < 5) return 'fresh';
  if (diffMinutes < 10) return 'attention';
  if (diffMinutes < 15) return 'urgent';
  return 'critical';
}

/**
 * Get Tailwind classes for urgency level styling
 */
export function getUrgencyStyles(urgency: UrgencyLevel): UrgencyStyles {
  switch (urgency) {
    case 'fresh':
      return {
        border: 'border-l-emerald-400',
        badge: 'bg-emerald-100 text-emerald-700',
        text: 'text-emerald-600',
        bg: 'bg-emerald-50',
      };
    case 'attention':
      return {
        border: 'border-l-amber-400',
        badge: 'bg-amber-100 text-amber-700',
        text: 'text-amber-600',
        bg: 'bg-amber-50',
      };
    case 'urgent':
      return {
        border: 'border-l-orange-500',
        badge: 'bg-orange-100 text-orange-700',
        text: 'text-orange-600',
        bg: 'bg-orange-50',
      };
    case 'critical':
      return {
        border: 'border-l-red-500',
        badge: 'bg-red-100 text-red-700',
        text: 'text-red-600',
        bg: 'bg-red-50',
      };
  }
}

/**
 * Sort orders by creation time (oldest first)
 */
export function sortOrdersByAge<T extends { createdAt: string }>(orders: T[]): T[] {
  return [...orders].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Calculate elapsed time as formatted string (e.g., "5m 23s")
 */
export function getElapsedTime(createdAt: string): string {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffMs = now - created;
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  if (diffMins > 0) {
    return `${diffMins}m ${diffSecs}s`;
  }
  return `${diffSecs}s`;
}

/**
 * Calculate average wait time from orders in milliseconds
 */
export function calculateAverageWaitTime(orders: Array<{ createdAt: string }>): number {
  if (orders.length === 0) return 0;

  const now = Date.now();
  const totalWait = orders.reduce((sum, order) => {
    return sum + (now - new Date(order.createdAt).getTime());
  }, 0);

  return totalWait / orders.length;
}

/**
 * Format milliseconds to display string (e.g., "5m 23s")
 */
export function formatWaitTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

/**
 * Count urgent orders (orders older than 10 minutes)
 */
export function countUrgentOrders(orders: Array<{ createdAt: string }>): number {
  return orders.filter(order => {
    const urgency = getOrderUrgency(order.createdAt);
    return urgency === 'urgent' || urgency === 'critical';
  }).length;
}
