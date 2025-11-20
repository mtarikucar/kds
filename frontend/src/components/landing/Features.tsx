import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  QrCode,
  LayoutDashboard,
  ChefHat,
  BarChart3,
  CreditCard,
  Users
} from 'lucide-react';

export const Features = () => {
  const { t } = useTranslation('common');

  const features = [
    {
      icon: <QrCode className="w-8 h-8" />,
      title: t('landing.feature1Title'),
      description: t('landing.feature1Desc'),
      color: "bg-warm-orange/20 text-warm-brown",
      gradient: "from-warm-orange/10 to-primary-200/10",
    },
    {
      icon: <LayoutDashboard className="w-8 h-8" />,
      title: t('landing.feature2Title'),
      description: t('landing.feature2Desc'),
      color: "bg-primary-300/20 text-warm-dark",
      gradient: "from-primary-200/10 to-warm-tan/20",
    },
    {
      icon: <ChefHat className="w-8 h-8" />,
      title: t('landing.feature3Title'),
      description: t('landing.feature3Desc'),
      color: "bg-warm-brown/20 text-warm-dark",
      gradient: "from-warm-brown/10 to-warm-orange/10",
    },
    {
      icon: <BarChart3 className="w-8 h-8" />,
      title: t('landing.feature4Title'),
      description: t('landing.feature4Desc'),
      color: "bg-primary-400/20 text-warm-brown",
      gradient: "from-primary-300/10 to-warm-beige/20",
    },
    {
      icon: <CreditCard className="w-8 h-8" />,
      title: t('landing.feature5Title'),
      description: t('landing.feature5Desc'),
      color: "bg-warm-sand/30 text-warm-dark",
      gradient: "from-warm-sand/20 to-primary-100/20",
    },
    {
      icon: <Users className="w-8 h-8" />,
      title: t('landing.feature6Title'),
      description: t('landing.feature6Desc'),
      color: "bg-warm-orange/15 text-warm-brown",
      gradient: "from-warm-cream/30 to-warm-orange/10",
    },
  ];

  return (
    <section id="features" className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-white via-warm-cream/30 to-white relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-warm-orange/30 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-warm-orange/30 to-transparent" />

      {/* Decorative blob shapes */}
      <div className="absolute top-1/4 left-0 w-96 h-96 bg-warm-orange/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-primary-200/20 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-20"
        >
          <h2 className="text-4xl md:text-5xl font-heading font-bold text-warm-dark mb-6">
            {t('landing.everythingYouNeed')}
          </h2>
          <p className="text-xl text-warm-brown/70 max-w-2xl mx-auto">
            {t('landing.featuresDescription')}
          </p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ y: -8 }}
              className="bg-white/80 p-8 rounded-3xl border-2 border-warm-orange/20 hover:border-warm-orange/50 hover:shadow-2xl hover:shadow-warm-orange/10 transition-all duration-300 group cursor-pointer relative overflow-hidden backdrop-blur-sm"
            >
              <div className={`w-16 h-16 ${feature.color} rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-md`}>
                {feature.icon}
              </div>

              <h3 className="text-xl font-bold text-warm-dark mb-3 group-hover:text-warm-orange transition-colors">
                {feature.title}
              </h3>

              <p className="text-warm-brown/70 leading-relaxed">
                {feature.description}
              </p>

              {/* Hover gradient overlay */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-3xl`} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
