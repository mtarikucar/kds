'use client';

import { motion } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Clock, CheckCircle, TrendingUp } from 'lucide-react';

const values = [
  {
    icon: Clock,
    title: 'Save Time',
    metric: '40%',
    metricLabel: 'faster order processing',
    description: 'Automate repetitive tasks and streamline your workflow. Spend less time on admin and more time with customers.',
    color: 'bg-blue-500',
  },
  {
    icon: CheckCircle,
    title: 'Reduce Errors',
    metric: '85%',
    metricLabel: 'fewer order mistakes',
    description: 'Digital order flow eliminates miscommunication. Orders go directly from table to kitchen with zero confusion.',
    color: 'bg-green-500',
  },
  {
    icon: TrendingUp,
    title: 'Increase Revenue',
    metric: '25%',
    metricLabel: 'higher table turnover',
    description: 'Faster service means more customers served. Real-time insights help you optimize for maximum profitability.',
    color: 'bg-orange-500',
  },
];

export default function BusinessValue() {
  return (
    <section className="section-padding bg-slate-900">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <span className="inline-block text-sm font-semibold text-orange-400 mb-4 uppercase tracking-wider">
            Results That Matter
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-4">
            Real impact on your bottom line
          </h2>
          <p className="text-lg text-slate-400">
            HummyTummy customers see measurable improvements from day one.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => (
            <motion.div
              key={value.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="relative bg-slate-800/50 rounded-2xl p-8 border border-slate-700/50"
            >
              <div
                className={`w-14 h-14 ${value.color} rounded-xl flex items-center justify-center mb-6`}
              >
                <value.icon className="w-7 h-7 text-white" />
              </div>

              <h3 className="text-xl font-bold text-white mb-2">{value.title}</h3>

              <div className="mb-4">
                <span className="text-5xl font-bold text-white">{value.metric}</span>
                <span className="text-slate-400 ml-2">{value.metricLabel}</span>
              </div>

              <p className="text-slate-400">{value.description}</p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
