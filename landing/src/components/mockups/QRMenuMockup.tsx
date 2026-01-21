'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { QrCode, ChevronRight, Star, Wifi, Instagram, Facebook } from 'lucide-react';

interface QRMenuMockupProps {
  className?: string;
}

export function QRMenuMockup({ className = '' }: QRMenuMockupProps) {
  const prefersReducedMotion = useReducedMotion();
  const [activeCategory, setActiveCategory] = useState('Kebabs');

  const categories = ['Kebabs', 'Pide', 'Drinks', 'Desserts'];

  const menuItems = {
    Kebabs: [
      { name: 'Adana Kebab', price: 180, rating: 4.9, image: '🍖' },
      { name: 'Urfa Kebab', price: 175, rating: 4.8, image: '🥩' },
      { name: 'Chicken Shish', price: 160, rating: 4.7, image: '🍗' },
    ],
    Pide: [
      { name: 'Cheese Pide', price: 120, rating: 4.8, image: '🫓' },
      { name: 'Meat Pide', price: 145, rating: 4.9, image: '🥧' },
    ],
    Drinks: [
      { name: 'Ayran', price: 25, rating: 4.9, image: '🥛' },
      { name: 'Turkish Tea', price: 15, rating: 5.0, image: '🍵' },
    ],
    Desserts: [
      { name: 'Baklava', price: 95, rating: 5.0, image: '🍯' },
      { name: 'Kunefe', price: 110, rating: 4.9, image: '🍮' },
    ],
  };

  return (
    <div className={`relative ${className}`}>
      {/* Phone frame */}
      <div className="relative mx-auto w-[280px]">
        {/* Phone bezel */}
        <div className="absolute inset-0 bg-slate-900 rounded-[3rem] shadow-2xl" />

        {/* Screen */}
        <div className="relative m-3 bg-white rounded-[2.5rem] overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center justify-between px-6 py-2 bg-slate-900 text-white text-xs">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              <div className="w-6 h-3 border border-white rounded-sm">
                <div className="w-4 h-full bg-white rounded-sm" />
              </div>
            </div>
          </div>

          {/* Restaurant header */}
          <div className="px-5 py-4 bg-gradient-to-b from-orange-500 to-orange-600 text-white">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-bold text-lg">Sultan Kebab</h3>
                <p className="text-xs text-orange-100">Traditional Turkish Cuisine</p>
              </div>
              <motion.div
                animate={prefersReducedMotion ? {} : { rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <QrCode className="w-8 h-8 text-white/80" />
              </motion.div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-yellow-300 text-yellow-300" />
                <span>4.9</span>
              </div>
              <span className="text-orange-200">•</span>
              <span className="text-orange-100">Table 7</span>
            </div>
          </div>

          {/* Categories */}
          <div className="px-4 py-3 flex gap-2 overflow-x-auto border-b border-slate-100">
            {categories.map((cat) => (
              <motion.button
                key={cat}
                whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                onClick={() => setActiveCategory(cat)}
                className={`
                  px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors
                  ${activeCategory === cat
                    ? 'bg-orange-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                `}
              >
                {cat}
              </motion.button>
            ))}
          </div>

          {/* Menu items */}
          <div className="p-4 space-y-3 h-[260px] overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-3"
              >
                {menuItems[activeCategory as keyof typeof menuItems]?.map((item, i) => (
                  <motion.div
                    key={item.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl"
                  >
                    <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center text-2xl shadow-sm">
                      {item.image}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-slate-900 text-sm">{item.name}</div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-orange-600 font-semibold">₺{item.price}</span>
                        <span className="flex items-center gap-0.5 text-slate-400">
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          {item.rating}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Social footer */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
            <div className="flex items-center justify-center gap-4">
              <motion.div
                whileHover={prefersReducedMotion ? {} : { scale: 1.1 }}
                className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center"
              >
                <Instagram className="w-4 h-4 text-white" />
              </motion.div>
              <motion.div
                whileHover={prefersReducedMotion ? {} : { scale: 1.1 }}
                className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"
              >
                <Facebook className="w-4 h-4 text-white" />
              </motion.div>
              <div className="flex items-center gap-1 px-3 py-1 bg-white rounded-full border border-slate-200">
                <Wifi className="w-3 h-3 text-slate-400" />
                <span className="text-xs text-slate-500">Free WiFi</span>
              </div>
            </div>
          </div>

          {/* Home indicator */}
          <div className="py-2 flex justify-center">
            <div className="w-32 h-1 bg-slate-900 rounded-full" />
          </div>
        </div>
      </div>

      {/* Floating QR code */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="absolute -bottom-4 -right-4 bg-white p-3 rounded-xl shadow-xl border border-slate-200"
      >
        <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center">
          <QrCode className="w-10 h-10 text-slate-400" />
        </div>
        <div className="text-xs text-center mt-1 text-slate-500">Scan me</div>
      </motion.div>
    </div>
  );
}
