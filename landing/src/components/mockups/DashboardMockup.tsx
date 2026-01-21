'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Bell, TrendingUp, Users, ShoppingBag } from 'lucide-react';

interface DashboardMockupProps {
  className?: string;
  interactive?: boolean;
}

export function DashboardMockup({ className = '', interactive = true }: DashboardMockupProps) {
  const prefersReducedMotion = useReducedMotion();
  const [activeOrders, setActiveOrders] = useState(147);
  const [notifications, setNotifications] = useState<{ id: number; message: string; time: string }[]>([]);
  const notificationId = useRef(0);

  // Simulate live order updates
  useEffect(() => {
    if (prefersReducedMotion || !interactive) return;

    const interval = setInterval(() => {
      setActiveOrders((prev) => prev + Math.floor(Math.random() * 3));

      // Add notification occasionally
      if (Math.random() > 0.8) {
        const newNotification = {
          id: notificationId.current++,
          message: `Order #${Math.floor(Math.random() * 900) + 100} Ready`,
          time: 'Just now',
        };
        setNotifications((prev) => [newNotification, ...prev.slice(0, 2)]);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [prefersReducedMotion, interactive]);

  const tableStatuses = [
    { status: 'active', color: 'bg-green-500' },
    { status: 'active', color: 'bg-green-500' },
    { status: 'active', color: 'bg-green-500' },
    { status: 'pending', color: 'bg-orange-500' },
    { status: 'pending', color: 'bg-orange-500' },
    { status: 'empty', color: 'bg-slate-200' },
    { status: 'empty', color: 'bg-slate-200' },
    { status: 'empty', color: 'bg-slate-200' },
  ];

  return (
    <div className={`relative ${className}`}>
      {/* Main dashboard window */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-white rounded-2xl shadow-2xl shadow-slate-900/10 border border-slate-200/80 overflow-hidden"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-b from-slate-50 to-slate-100/50 border-b border-slate-200/80">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400 hover:bg-red-500 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-yellow-400 hover:bg-yellow-500 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-green-400 hover:bg-green-500 transition-colors" />
          </div>
          <div className="flex-1 mx-8">
            <div className="h-6 bg-white rounded-md border border-slate-200 flex items-center px-3">
              <span className="text-xs text-slate-400">dashboard.hummytummy.com</span>
            </div>
          </div>
          <motion.div
            animate={prefersReducedMotion ? {} : { scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="relative"
          >
            <Bell className="w-4 h-4 text-slate-400" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full" />
          </motion.div>
        </div>

        {/* Dashboard content */}
        <div className="p-6">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <motion.div
              className="relative overflow-hidden p-4 bg-gradient-to-br from-green-50 to-green-100/50 rounded-xl border border-green-200/50"
              whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700">Active Tables</span>
              </div>
              <div className="text-2xl font-bold text-green-900">12/18</div>
              <motion.div
                className="absolute bottom-0 left-0 h-1 bg-green-500"
                initial={{ width: '0%' }}
                animate={{ width: '66%' }}
                transition={{ duration: 1, delay: 0.5 }}
              />
            </motion.div>

            <motion.div
              className="relative overflow-hidden p-4 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl border border-blue-200/50"
              whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShoppingBag className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-700">Orders Today</span>
              </div>
              <motion.div
                className="text-2xl font-bold text-blue-900"
                key={activeOrders}
                initial={prefersReducedMotion ? {} : { scale: 1.1 }}
                animate={{ scale: 1 }}
              >
                {activeOrders}
              </motion.div>
              <motion.div
                className="absolute bottom-0 left-0 h-1 bg-blue-500"
                initial={{ width: '0%' }}
                animate={{ width: '80%' }}
                transition={{ duration: 1, delay: 0.7 }}
              />
            </motion.div>

            <motion.div
              className="relative overflow-hidden p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-xl border border-orange-200/50"
              whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
            >
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-orange-600" />
                <span className="text-xs font-medium text-orange-700">Revenue</span>
              </div>
              <div className="text-2xl font-bold text-orange-900">₺8,240</div>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-green-600 font-medium">+25%</span>
                <span className="text-xs text-slate-400">vs yesterday</span>
              </div>
            </motion.div>
          </div>

          {/* Table grid */}
          <div className="mb-4">
            <div className="text-sm font-medium text-slate-700 mb-3">Table Overview</div>
            <div className="grid grid-cols-4 gap-3">
              {tableStatuses.map((table, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 + 0.3 }}
                  whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
                  className={`
                    aspect-square rounded-xl flex flex-col items-center justify-center
                    cursor-pointer transition-all border
                    ${table.status === 'active' ? 'bg-green-50 border-green-200 text-green-700' :
                      table.status === 'pending' ? 'bg-orange-50 border-orange-200 text-orange-700' :
                      'bg-slate-50 border-slate-200 text-slate-400'}
                  `}
                >
                  <span className="text-lg font-bold">T{i + 1}</span>
                  {table.status !== 'empty' && (
                    <motion.span
                      className={`w-2 h-2 rounded-full mt-1 ${table.color}`}
                      animate={prefersReducedMotion ? {} : { scale: [1, 1.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                    />
                  )}
                </motion.div>
              ))}
            </div>
          </div>

          {/* Live activity */}
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-orange-500 to-orange-400"
              initial={{ width: '0%' }}
              animate={{ width: '75%' }}
              transition={{ duration: 1.5, delay: 0.8 }}
            />
          </div>
        </div>
      </motion.div>

      {/* Floating notification cards */}
      <AnimatePresence>
        {notifications.slice(0, 1).map((notification, index) => (
          <motion.div
            key={notification.id}
            initial={{ opacity: 0, x: -20, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4 }}
            className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-56"
            style={{ zIndex: 10 - index }}
          >
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"
              >
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
              <div>
                <div className="text-sm font-medium text-slate-900">{notification.message}</div>
                <div className="text-xs text-slate-500">{notification.time}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Floating stats badge */}
      <motion.div
        initial={{ opacity: 0, y: -20, x: 20 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ duration: 0.5, delay: 0.8 }}
        className="absolute -top-4 -right-4 bg-white rounded-xl shadow-xl border border-slate-200 p-3"
      >
        <div className="flex items-center gap-2">
          <motion.div
            animate={prefersReducedMotion ? {} : { rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-8 h-8 bg-gradient-to-br from-orange-100 to-orange-200 rounded-lg flex items-center justify-center"
          >
            <TrendingUp className="w-4 h-4 text-orange-600" />
          </motion.div>
          <div>
            <div className="text-lg font-bold text-green-600">+25%</div>
            <div className="text-xs text-slate-500">This week</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
