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
    pending: 'bg-warning-light text-warning-dark',
    preparing: 'bg-primary-100 text-primary-800',
    ready: 'bg-accent-100 text-accent-800',
    served: 'bg-neutral-100 text-neutral-800',
    cancelled: 'bg-error-light text-error-dark',

    // Table statuses
    available: 'bg-accent-100 text-accent-800',
    occupied: 'bg-primary-100 text-primary-800',
    reserved: 'bg-warning-light text-warning-dark',

    // Payment statuses
    paid: 'bg-accent-100 text-accent-800',
    unpaid: 'bg-warning-light text-warning-dark',
    refunded: 'bg-error-light text-error-dark',
  };

  return colors[status.toLowerCase()] || 'bg-neutral-100 text-neutral-800';
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
