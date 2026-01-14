'use client';

import { motion } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Shield, Lock, Server, Users } from 'lucide-react';

const securityPoints = [
  {
    icon: Lock,
    title: 'End-to-End Encryption',
    description: 'All data is encrypted in transit and at rest using industry-standard AES-256 encryption.',
  },
  {
    icon: Users,
    title: 'Role-Based Access Control',
    description: 'Fine-grained permissions let you control exactly what each team member can see and do.',
  },
  {
    icon: Server,
    title: '99.9% Uptime SLA',
    description: 'Enterprise-grade infrastructure with redundancy across multiple data centers.',
  },
  {
    icon: Shield,
    title: 'GDPR & KVKK Compliant',
    description: 'Full compliance with European and Turkish data protection regulations.',
  },
];

export default function TrustSecurity() {
  return (
    <section id="security" className="section-padding bg-gradient-subtle">
      <Container>
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider">
              Trust & Security
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-6">
              Enterprise-grade security for every restaurant
            </h2>
            <p className="text-lg text-slate-600 mb-8">
              Your data is your business. We take security seriously so you can focus on
              what matters most—serving your customers.
            </p>

            <div className="space-y-6">
              {securityPoints.map((point, index) => (
                <motion.div
                  key={point.title}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="flex gap-4"
                >
                  <div className="flex-shrink-0 w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center">
                    <point.icon className="w-6 h-6 text-slate-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{point.title}</h3>
                    <p className="text-sm text-slate-600">{point.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <div className="relative bg-white rounded-2xl shadow-2xl shadow-slate-200/50 border border-slate-200/50 p-8 lg:p-12">
              {/* Security visual mockup */}
              <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Your Data is Protected</h3>
                <p className="text-slate-600 mb-8">
                  Industry-leading security measures keep your business safe.
                </p>

                {/* Trust indicators */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">256-bit</div>
                    <div className="text-sm text-slate-500">Encryption</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">99.9%</div>
                    <div className="text-sm text-slate-500">Uptime</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">24/7</div>
                    <div className="text-sm text-slate-500">Monitoring</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">GDPR</div>
                    <div className="text-sm text-slate-500">Compliant</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -z-10 -bottom-8 -left-8 w-64 h-64 bg-green-100 rounded-full blur-3xl opacity-50" />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
