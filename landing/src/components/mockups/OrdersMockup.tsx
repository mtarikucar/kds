'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Clock, ChefHat, CheckCircle, AlertCircle } from 'lucide-react';

interface Order {
  id: number;
  table: number;
  items: string[];
  status: 'pending' | 'preparing' | 'ready';
  time: number;
}

interface OrdersMockupProps {
  className?: string;
}

export function OrdersMockup({ className = '' }: OrdersMockupProps) {
  const prefersReducedMotion = useReducedMotion();
  const orderId = useRef(200);
  const [orders, setOrders] = useState<Order[]>([
    { id: 101, table: 3, items: ['Adana Kebab', 'Ayran'], status: 'ready', time: 0 },
    { id: 102, table: 7, items: ['Lahmacun x2', 'Cola'], status: 'preparing', time: 180 },
    { id: 103, table: 1, items: ['Pide', 'Salad'], status: 'pending', time: 300 },
  ]);

  // Simulate order flow
  useEffect(() => {
    if (prefersReducedMotion) return;

    const interval = setInterval(() => {
      setOrders((prev) => {
        const updated = prev.map((order) => {
          if (order.status === 'pending' && order.time <= 60) {
            return { ...order, status: 'preparing' as const, time: 180 };
          }
          if (order.status === 'preparing' && order.time <= 0) {
            return { ...order, status: 'ready' as const };
          }
          return { ...order, time: Math.max(0, order.time - 30) };
        });

        // Occasionally add new order
        if (Math.random() > 0.7 && updated.length < 5) {
          const items = [
            ['Kebab Plate', 'Salad'],
            ['Lahmacun x3'],
            ['Mixed Grill', 'Rice', 'Ayran'],
            ['Pide', 'Soup'],
          ];
          const newOrder: Order = {
            id: ++orderId.current,
            table: Math.floor(Math.random() * 12) + 1,
            items: items[Math.floor(Math.random() * items.length)],
            status: 'pending',
            time: 300 + Math.floor(Math.random() * 120),
          };
          return [newOrder, ...updated.slice(0, 4)];
        }

        // Remove completed orders occasionally
        if (Math.random() > 0.8) {
          const readyIndex = updated.findIndex((o) => o.status === 'ready');
          if (readyIndex !== -1) {
            return updated.filter((_, i) => i !== readyIndex);
          }
        }

        return updated;
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusConfig = (status: Order['status']) => {
    switch (status) {
      case 'pending':
        return {
          icon: Clock,
          color: 'text-orange-600',
          bg: 'bg-orange-100',
          label: 'Pending',
          border: 'border-orange-200',
        };
      case 'preparing':
        return {
          icon: ChefHat,
          color: 'text-blue-600',
          bg: 'bg-blue-100',
          label: 'Preparing',
          border: 'border-blue-200',
        };
      case 'ready':
        return {
          icon: CheckCircle,
          color: 'text-green-600',
          bg: 'bg-green-100',
          label: 'Ready',
          border: 'border-green-200',
        };
    }
  };

  return (
    <div className={`bg-white rounded-2xl shadow-2xl shadow-slate-900/10 border border-slate-200/80 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-b from-slate-50 to-white border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Live Orders</h3>
            <p className="text-xs text-slate-500">Real-time kitchen display</p>
          </div>
          <div className="flex items-center gap-2">
            <motion.div
              animate={prefersReducedMotion ? {} : { scale: [1, 1.2, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-2 h-2 bg-green-500 rounded-full"
            />
            <span className="text-xs text-slate-500">Live</span>
          </div>
        </div>
      </div>

      {/* Orders list */}
      <div className="p-4 space-y-3 max-h-[360px] overflow-hidden">
        <AnimatePresence mode="popLayout">
          {orders.map((order) => {
            const config = getStatusConfig(order.status);
            const Icon = config.icon;

            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, x: -20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className={`p-4 rounded-xl border ${config.border} bg-gradient-to-r from-white to-slate-50/50`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 ${config.bg} rounded-lg flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">Order #{order.id}</div>
                      <div className="text-xs text-slate-500">Table {order.table}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${config.bg} ${config.color}`}>
                      {config.label}
                    </span>
                    {order.status !== 'ready' && (
                      <motion.div
                        key={order.time}
                        initial={{ scale: 1.1 }}
                        animate={{ scale: 1 }}
                        className="text-xs text-slate-500 mt-1"
                      >
                        {formatTime(order.time)}
                      </motion.div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {order.items.map((item, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-md"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                {/* Progress bar for preparing orders */}
                {order.status === 'preparing' && (
                  <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-500 rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${Math.max(10, 100 - (order.time / 180) * 100)}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
