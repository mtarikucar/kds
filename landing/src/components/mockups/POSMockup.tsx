'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Plus, Minus, CreditCard, Wallet, ShoppingCart, Check } from 'lucide-react';

interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
}

interface POSMockupProps {
  className?: string;
}

export function POSMockup({ className = '' }: POSMockupProps) {
  const prefersReducedMotion = useReducedMotion();
  const [cart, setCart] = useState<CartItem[]>([
    { id: 1, name: 'Adana Kebab', price: 180, quantity: 2 },
    { id: 2, name: 'Ayran', price: 25, quantity: 2 },
  ]);
  const [paymentStep, setPaymentStep] = useState<'cart' | 'payment' | 'success'>('cart');

  const products = [
    { id: 1, name: 'Adana Kebab', price: 180, category: 'Main' },
    { id: 2, name: 'Lahmacun', price: 85, category: 'Main' },
    { id: 3, name: 'Pide', price: 120, category: 'Main' },
    { id: 4, name: 'Ayran', price: 25, category: 'Drinks' },
    { id: 5, name: 'Cola', price: 35, category: 'Drinks' },
    { id: 6, name: 'Baklava', price: 95, category: 'Dessert' },
  ];

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const addToCart = (product: typeof products[0]) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handlePayment = () => {
    setPaymentStep('payment');
    setTimeout(() => {
      setPaymentStep('success');
      setTimeout(() => {
        setPaymentStep('cart');
        setCart([]);
      }, 2000);
    }, 1500);
  };

  return (
    <div className={`bg-white rounded-2xl shadow-2xl shadow-slate-900/10 border border-slate-200/80 overflow-hidden ${className}`}>
      <div className="flex h-full">
        {/* Product grid */}
        <div className="flex-1 p-4 bg-slate-50/50">
          <div className="mb-3">
            <h3 className="font-semibold text-slate-900">Quick Menu</h3>
            <p className="text-xs text-slate-500">Tap to add items</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {products.map((product) => (
              <motion.button
                key={product.id}
                whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                onClick={() => addToCart(product)}
                className="p-3 bg-white rounded-xl border border-slate-200 hover:border-orange-300 hover:shadow-md transition-all text-left"
              >
                <div className="text-sm font-medium text-slate-900 truncate">{product.name}</div>
                <div className="text-xs text-orange-600 font-semibold">₺{product.price}</div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Cart / Payment */}
        <div className="w-56 border-l border-slate-200 flex flex-col bg-white">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900">Cart</span>
              <span className="ml-auto text-xs text-slate-500">{cart.length} items</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {paymentStep === 'cart' && (
              <motion.div
                key="cart"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 overflow-auto p-3"
              >
                <div className="space-y-2">
                  <AnimatePresence>
                    {cart.map((item) => (
                      <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{item.name}</div>
                          <div className="text-xs text-slate-500">₺{item.price}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <motion.button
                            whileTap={prefersReducedMotion ? {} : { scale: 0.9 }}
                            onClick={() => updateQuantity(item.id, -1)}
                            className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center hover:bg-slate-300"
                          >
                            <Minus className="w-3 h-3" />
                          </motion.button>
                          <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                          <motion.button
                            whileTap={prefersReducedMotion ? {} : { scale: 0.9 }}
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center hover:bg-slate-300"
                          >
                            <Plus className="w-3 h-3" />
                          </motion.button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {paymentStep === 'payment' && (
              <motion.div
                key="payment"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex items-center justify-center"
              >
                <div className="text-center">
                  <motion.div
                    animate={prefersReducedMotion ? {} : { rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-12 h-12 border-3 border-orange-500 border-t-transparent rounded-full mx-auto mb-3"
                  />
                  <div className="text-sm font-medium text-slate-600">Processing...</div>
                </div>
              </motion.div>
            )}

            {paymentStep === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex items-center justify-center"
              >
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200 }}
                    className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"
                  >
                    <Check className="w-8 h-8 text-green-600" />
                  </motion.div>
                  <div className="text-sm font-medium text-green-600">Payment Successful!</div>
                  <div className="text-xs text-slate-500 mt-1">₺{total}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Total & Pay */}
          {paymentStep === 'cart' && (
            <div className="p-4 border-t border-slate-100">
              <div className="flex justify-between mb-3">
                <span className="text-slate-600">Total</span>
                <motion.span
                  key={total}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className="font-bold text-slate-900"
                >
                  ₺{total}
                </motion.span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <motion.button
                  whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                  onClick={handlePayment}
                  disabled={cart.length === 0}
                  className="flex items-center justify-center gap-1 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  <CreditCard className="w-4 h-4" />
                  Card
                </motion.button>
                <motion.button
                  whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                  onClick={handlePayment}
                  disabled={cart.length === 0}
                  className="flex items-center justify-center gap-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  <Wallet className="w-4 h-4" />
                  Cash
                </motion.button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
