'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { features } from '@/data/features';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export default function FeatureScroller() {
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sectionRefs.current.forEach((ref, index) => {
      if (!ref) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveIndex(index);
            }
          });
        },
        {
          rootMargin: '-40% 0px -40% 0px',
          threshold: 0,
        }
      );

      observer.observe(ref);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  const activeFeature = features[activeIndex];

  return (
    <section id="features" className="section-padding">
      <Container>
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <span className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider">
            Features
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            Built for how restaurants actually work
          </h2>
          <p className="text-lg text-slate-600">
            Every feature designed with restaurant owners, managers, and staff in mind.
          </p>
        </motion.div>

        {/* Scrollytelling Layout */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-12">
          {/* Left Sticky Sidebar */}
          <div className="hidden lg:block lg:col-span-4">
            <div className="sticky top-32">
              <nav className="space-y-2" aria-label="Feature navigation">
                {features.map((feature, index) => {
                  const Icon = feature.icon;
                  const isActive = index === activeIndex;

                  return (
                    <button
                      key={feature.id}
                      onClick={() => {
                        sectionRefs.current[index]?.scrollIntoView({
                          behavior: prefersReducedMotion ? 'auto' : 'smooth',
                          block: 'center',
                        });
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all duration-200 ${
                        isActive
                          ? 'bg-slate-900 text-white shadow-lg'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          isActive ? 'bg-white/20' : 'bg-white'
                        }`}
                      >
                        <Icon
                          className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-600'}`}
                        />
                      </div>
                      <span className="font-medium">{feature.title}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Right Content Panels */}
          <div className="lg:col-span-8 space-y-32 lg:space-y-48">
            {features.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <div
                  key={feature.id}
                  ref={(el) => { sectionRefs.current[index] = el; }}
                  className="scroll-mt-32"
                >
                  <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-100px' }}
                    transition={{ duration: 0.5 }}
                    className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/50 overflow-hidden"
                  >
                    {/* Feature Header */}
                    <div className="p-6 lg:p-8 border-b border-slate-100">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl lg:text-2xl font-bold text-slate-900 mb-2">
                            {feature.title}
                          </h3>
                          <p className="text-slate-600">{feature.description}</p>
                        </div>
                      </div>
                    </div>

                    {/* Feature Content */}
                    <div className="p-6 lg:p-8">
                      {/* Bullets */}
                      <ul className="space-y-4 mb-8">
                        {feature.bullets.map((bullet, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <svg
                              className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                            <span className="text-slate-700">{bullet}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Metrics */}
                      <div className="flex flex-wrap gap-4">
                        {feature.metrics.map((metric) => (
                          <div
                            key={metric.label}
                            className="bg-slate-50 rounded-lg px-4 py-3 flex-1 min-w-[140px]"
                          >
                            <div className="text-2xl font-bold text-slate-900">
                              {metric.value}
                            </div>
                            <div className="text-sm text-slate-500">{metric.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
