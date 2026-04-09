'use client';

import { useRef, useEffect, useState } from 'react';
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      <div
        className={`bg-white rounded-2xl shadow-2xl shadow-slate-900/10 border border-slate-200/80 overflow-hidden transition-all duration-[600ms] ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}
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
          <div className={`relative ${!prefersReducedMotion ? 'animate-pulse' : ''}`}>
            <Bell className="w-4 h-4 text-slate-400" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full" />
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-6">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div
              className={`relative overflow-hidden p-4 bg-gradient-to-br from-green-50 to-green-100/50 rounded-xl border border-green-200/50 ${!prefersReducedMotion ? 'hover:scale-[1.02] transition-transform' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700">Active Tables</span>
              </div>
              <div className="text-2xl font-bold text-green-900">12/18</div>
              <div
                className="absolute bottom-0 left-0 h-1 bg-green-500 transition-all duration-1000 delay-500"
                style={{ width: mounted ? '66%' : '0%' }}
              />
            </div>

            <div
              className={`relative overflow-hidden p-4 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl border border-blue-200/50 ${!prefersReducedMotion ? 'hover:scale-[1.02] transition-transform' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShoppingBag className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-700">Orders Today</span>
              </div>
              <div className="text-2xl font-bold text-blue-900">
                {activeOrders}
              </div>
              <div
                className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all duration-1000 delay-700"
                style={{ width: mounted ? '80%' : '0%' }}
              />
            </div>

            <div
              className={`relative overflow-hidden p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-xl border border-orange-200/50 ${!prefersReducedMotion ? 'hover:scale-[1.02] transition-transform' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-orange-600" />
                <span className="text-xs font-medium text-orange-700">Revenue</span>
              </div>
              <div className="text-2xl font-bold text-orange-900">&#8378;8,240</div>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-green-600 font-medium">+25%</span>
                <span className="text-xs text-slate-400">vs yesterday</span>
              </div>
            </div>
          </div>

          {/* Table grid */}
          <div className="mb-4">
            <div className="text-sm font-medium text-slate-700 mb-3">Table Overview</div>
            <div className="grid grid-cols-4 gap-3">
              {tableStatuses.map((table, i) => (
                <div
                  key={i}
                  className={`
                    aspect-square rounded-xl flex flex-col items-center justify-center
                    cursor-pointer transition-all border animate-hero-fade-in
                    ${!prefersReducedMotion ? 'hover:scale-105' : ''}
                    ${table.status === 'active' ? 'bg-green-50 border-green-200 text-green-700' :
                      table.status === 'pending' ? 'bg-orange-50 border-orange-200 text-orange-700' :
                      'bg-slate-50 border-slate-200 text-slate-400'}
                  `}
                  style={{ animationDelay: `${i * 0.05 + 0.3}s` }}
                >
                  <span className="text-lg font-bold">T{i + 1}</span>
                  {table.status !== 'empty' && (
                    <span
                      className={`w-2 h-2 rounded-full mt-1 ${table.color} ${!prefersReducedMotion ? 'animate-pulse' : ''}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Live activity */}
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-[1500ms] delay-800"
              style={{ width: mounted ? '75%' : '0%' }}
            />
          </div>
        </div>
      </div>

      {/* Floating notification cards */}
      {notifications.slice(0, 1).map((notification, index) => (
        <div
          key={notification.id}
          className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-56 transition-all duration-[400ms] opacity-100 translate-x-0 translate-y-0"
          style={{ zIndex: 10 - index }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-slate-900">{notification.message}</div>
              <div className="text-xs text-slate-500">{notification.time}</div>
            </div>
          </div>
        </div>
      ))}

      {/* Floating stats badge */}
      <div
        className={`absolute -top-4 -right-4 bg-white rounded-xl shadow-xl border border-slate-200 p-3 transition-all duration-500 delay-800 ${mounted ? 'opacity-100 translate-y-0 translate-x-0' : 'opacity-0 -translate-y-5 translate-x-5'}`}
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 bg-gradient-to-br from-orange-100 to-orange-200 rounded-lg flex items-center justify-center ${!prefersReducedMotion ? 'animate-pulse' : ''}`}
          >
            <TrendingUp className="w-4 h-4 text-orange-600" />
          </div>
          <div>
            <div className="text-lg font-bold text-green-600">+25%</div>
            <div className="text-xs text-slate-500">This week</div>
          </div>
        </div>
      </div>
    </div>
  );
}
