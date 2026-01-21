'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Flame, Timer, CheckCircle2, Bell } from 'lucide-react';

interface KitchenTicket {
  id: number;
  table: number;
  items: { name: string; quantity: number; done: boolean }[];
  priority: 'normal' | 'rush';
  startTime: number;
  elapsed: number;
}

interface KitchenMockupProps {
  className?: string;
}

export function KitchenMockup({ className = '' }: KitchenMockupProps) {
  const prefersReducedMotion = useReducedMotion();
  const [tickets, setTickets] = useState<KitchenTicket[]>([
    {
      id: 1,
      table: 5,
      items: [
        { name: 'Adana Kebab', quantity: 2, done: true },
        { name: 'Chicken Shish', quantity: 1, done: false },
        { name: 'Rice Pilaf', quantity: 3, done: true },
      ],
      priority: 'normal',
      startTime: Date.now() - 480000,
      elapsed: 480,
    },
    {
      id: 2,
      table: 3,
      items: [
        { name: 'Lahmacun', quantity: 4, done: false },
        { name: 'Pide', quantity: 2, done: false },
      ],
      priority: 'rush',
      startTime: Date.now() - 180000,
      elapsed: 180,
    },
  ]);

  // Update elapsed time
  useEffect(() => {
    if (prefersReducedMotion) return;

    const interval = setInterval(() => {
      setTickets((prev) =>
        prev.map((ticket) => ({
          ...ticket,
          elapsed: ticket.elapsed + 1,
          items: ticket.items.map((item) =>
            !item.done && Math.random() > 0.95
              ? { ...item, done: true }
              : item
          ),
        }))
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`bg-slate-900 rounded-2xl shadow-2xl overflow-hidden ${className}`}>
      {/* Kitchen header */}
      <div className="px-5 py-4 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500/20 rounded-xl flex items-center justify-center">
              <Flame className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Kitchen Display</h3>
              <p className="text-xs text-slate-400">Active tickets</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 bg-green-500/20 rounded-lg">
              <span className="text-xs font-medium text-green-400">85% Error Reduction</span>
            </div>
            <motion.div
              animate={prefersReducedMotion ? {} : { scale: [1, 1.1, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              <Bell className="w-5 h-5 text-slate-400" />
            </motion.div>
          </div>
        </div>
      </div>

      {/* Tickets grid */}
      <div className="p-4 grid grid-cols-2 gap-4">
        <AnimatePresence>
          {tickets.map((ticket) => {
            const completedItems = ticket.items.filter((i) => i.done).length;
            const totalItems = ticket.items.length;
            const progress = (completedItems / totalItems) * 100;

            return (
              <motion.div
                key={ticket.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`
                  p-4 rounded-xl border-2
                  ${ticket.priority === 'rush'
                    ? 'bg-red-950/50 border-red-500/50'
                    : 'bg-slate-800/50 border-slate-700'}
                `}
              >
                {/* Ticket header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">T{ticket.table}</span>
                    {ticket.priority === 'rush' && (
                      <motion.span
                        animate={prefersReducedMotion ? {} : { opacity: [1, 0.5, 1] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                        className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded"
                      >
                        RUSH
                      </motion.span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Timer className="w-4 h-4" />
                    <motion.span
                      key={ticket.elapsed}
                      initial={{ scale: 1.1 }}
                      animate={{ scale: 1 }}
                      className={`text-sm font-mono ${ticket.elapsed > 600 ? 'text-red-400' : ''}`}
                    >
                      {formatTime(ticket.elapsed)}
                    </motion.span>
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-2 mb-3">
                  {ticket.items.map((item, i) => (
                    <motion.div
                      key={i}
                      initial={false}
                      animate={{ opacity: item.done ? 0.5 : 1 }}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <motion.div
                          initial={false}
                          animate={{
                            backgroundColor: item.done ? '#22c55e' : '#475569',
                            scale: item.done ? [1, 1.2, 1] : 1,
                          }}
                          className="w-5 h-5 rounded flex items-center justify-center"
                        >
                          {item.done && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </motion.div>
                        <span className={`text-sm ${item.done ? 'text-slate-500 line-through' : 'text-white'}`}>
                          {item.name}
                        </span>
                      </div>
                      <span className="text-sm text-slate-400">x{item.quantity}</span>
                    </motion.div>
                  ))}
                </div>

                {/* Progress bar */}
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-green-500 to-green-400"
                    initial={{ width: '0%' }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <div className="mt-1 text-xs text-slate-500 text-right">
                  {completedItems}/{totalItems} items
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Stats footer */}
      <div className="px-5 py-3 bg-slate-800/50 border-t border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-lg font-bold text-white">12</div>
            <div className="text-xs text-slate-400">Avg Min</div>
          </div>
          <div className="w-px h-8 bg-slate-700" />
          <div className="text-center">
            <div className="text-lg font-bold text-green-400">98%</div>
            <div className="text-xs text-slate-400">On Time</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs text-slate-400">System Active</span>
        </div>
      </div>
    </div>
  );
}
