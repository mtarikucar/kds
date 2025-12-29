import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Star, Quote, ChevronLeft, ChevronRight, MapPin, BadgeCheck } from 'lucide-react';
import { usePublicStats, usePublicReviews, PublicReview } from '../../features/landing/publicStatsApi';

interface Testimonial {
  id: string | number;
  name: string;
  restaurant?: string;
  rating: number;
  comment: string;
  avatar: string;
  isVerified?: boolean;
}

export const Testimonials = () => {
  const { t } = useTranslation('common');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Fetch real data
  const { data: stats } = usePublicStats();
  const { data: reviews } = usePublicReviews(10);

  // Fallback testimonials for when no real reviews exist
  const fallbackTestimonials: Testimonial[] = [
    {
      id: 1,
      name: 'Mehmet Yılmaz',
      restaurant: 'Mavi Restaurant',
      rating: 5,
      comment: t('landing.testimonial1'),
      avatar: 'MY',
    },
    {
      id: 2,
      name: 'Ayşe Demir',
      restaurant: 'Cafe Istanbul',
      rating: 5,
      comment: t('landing.testimonial2'),
      avatar: 'AD',
    },
    {
      id: 3,
      name: 'Can Öztürk',
      restaurant: 'Lezzet Durağı',
      rating: 5,
      comment: t('landing.testimonial3'),
      avatar: 'CÖ',
    },
    {
      id: 4,
      name: 'Zeynep Kaya',
      restaurant: 'Tadım Mekan',
      rating: 5,
      comment: t('landing.testimonial4'),
      avatar: 'ZK',
    },
  ];

  // Use real reviews if available, fallback to hardcoded
  const testimonials: Testimonial[] = useMemo(() => {
    if (reviews && reviews.length > 0) {
      return reviews.map((review: PublicReview) => ({
        id: review.id,
        name: review.name,
        restaurant: review.restaurant,
        rating: review.rating,
        comment: review.comment,
        avatar: review.avatar || review.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
        isVerified: review.isVerified,
      }));
    }
    return fallbackTestimonials;
  }, [reviews, t]);

  // Trust badges with real stats (fallback to marketing values)
  const trustBadges = useMemo(() => [
    {
      value: stats?.totalTenants ? `${stats.totalTenants}+` : '100+',
      label: 'landing.happyClients',
    },
    {
      value: stats?.averageRating ? `${stats.averageRating.toFixed(1)}/5` : '4.9/5',
      label: 'landing.avgRating',
    },
    { value: '24/7', label: 'landing.support' },
    { value: '99%', label: 'landing.satisfaction' },
  ], [stats]);

  // Country stats for display
  const topCountries = useMemo(() => {
    if (stats?.countryDistribution) {
      return Object.entries(stats.countryDistribution)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 3);
    }
    return [];
  }, [stats]);

  // Auto-advance carousel every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [testimonials.length]);

  const handleDotClick = (index: number) => {
    setCurrentIndex(index);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % testimonials.length);
  };

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-white via-warm-cream/40 to-white relative overflow-hidden" id="testimonials">
      {/* Decorative blob shapes */}
      <div className="absolute top-1/3 right-0 w-96 h-96 bg-warm-orange/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/3 left-0 w-96 h-96 bg-primary-200/20 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center px-5 py-2.5 bg-white/80 border-2 border-warm-orange/30 text-warm-dark rounded-full text-sm font-semibold shadow-lg mb-6">
              <Star className="w-4 h-4 mr-2 fill-current text-warm-orange" />
              {t('landing.testimonials')}
            </div>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-warm-dark mb-6">
              {t('landing.whatClientsSay')}
            </h2>
            <p className="text-xl text-warm-brown/70 max-w-2xl mx-auto">
              {t('landing.testimonialSubtitle')}
            </p>

            {/* Country badges */}
            {topCountries.length > 0 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <MapPin className="w-4 h-4 text-warm-orange" />
                <span className="text-sm text-warm-brown/60">
                  {t('landing.trustedIn')}: {topCountries.map(([country]) => country).join(', ')}
                </span>
              </div>
            )}
          </motion.div>
        </div>

        {/* Testimonials Carousel */}
        <div className="relative max-w-5xl mx-auto">
          <div className="relative min-h-[400px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
                className="w-full"
              >
                <div className="bg-white/80 rounded-3xl shadow-2xl shadow-warm-orange/10 p-8 md:p-12 border-2 border-warm-orange/20 relative overflow-hidden backdrop-blur-sm">
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                    <Quote className="w-32 h-32 text-warm-orange transform rotate-180" />
                  </div>

                  <div className="flex flex-col md:flex-row gap-10 items-center relative z-10">
                    <div className="flex-shrink-0 relative">
                      <div className="w-32 h-32 bg-gradient-to-br from-warm-orange to-warm-brown rounded-full flex items-center justify-center text-white font-heading font-bold text-3xl shadow-xl ring-4 ring-white/80">
                        {testimonials[currentIndex].avatar}
                      </div>
                      {testimonials[currentIndex].isVerified && (
                        <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1.5 shadow-lg">
                          <BadgeCheck className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>

                    <div className="flex-grow text-center md:text-left">
                      <div className="flex gap-1 mb-6 justify-center md:justify-start">
                        {[...Array(testimonials[currentIndex].rating)].map((_, i) => (
                          <Star key={i} className="w-6 h-6 text-warm-orange fill-current" />
                        ))}
                      </div>

                      <p className="text-xl md:text-2xl text-warm-dark leading-relaxed mb-8 italic font-light">
                        "{testimonials[currentIndex].comment}"
                      </p>

                      <div>
                        <div className="flex items-center gap-2 justify-center md:justify-start">
                          <h4 className="font-bold text-warm-dark text-lg">
                            {testimonials[currentIndex].name}
                          </h4>
                          {testimonials[currentIndex].isVerified && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              {t('landing.verifiedCustomer')}
                            </span>
                          )}
                        </div>
                        {testimonials[currentIndex].restaurant && (
                          <p className="text-warm-orange font-semibold">{testimonials[currentIndex].restaurant}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation Arrows */}
          <div className="flex justify-center gap-4 mt-10">
            <button
              onClick={handlePrev}
              className="w-12 h-12 bg-white/80 rounded-full shadow-lg border-2 border-warm-orange/20 hover:border-warm-orange hover:bg-warm-orange/10 transition-all flex items-center justify-center group"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="w-6 h-6 text-warm-brown/60 group-hover:text-warm-orange transition-colors" />
            </button>
            <div className="flex gap-2 items-center px-4">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => handleDotClick(index)}
                  className={`h-2.5 rounded-full transition-all duration-300 focus:outline-none ${index === currentIndex
                      ? 'bg-warm-orange w-8 shadow-md'
                      : 'bg-warm-orange/30 w-2.5 hover:bg-warm-orange/50'
                    }`}
                  aria-label={`Go to testimonial ${index + 1}`}
                />
              ))}
            </div>
            <button
              onClick={handleNext}
              className="w-12 h-12 bg-white/80 rounded-full shadow-lg border-2 border-warm-orange/20 hover:border-warm-orange hover:bg-warm-orange/10 transition-all flex items-center justify-center group"
              aria-label="Next testimonial"
            >
              <ChevronRight className="w-6 h-6 text-warm-brown/60 group-hover:text-warm-orange transition-colors" />
            </button>
          </div>
        </div>

        {/* Trust Badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto"
        >
          {trustBadges.map((stat, index) => (
            <div key={index} className="text-center p-6 bg-white/70 rounded-3xl border-2 border-warm-orange/20 hover:border-warm-orange/40 hover:shadow-lg transition-all backdrop-blur-sm">
              <div className="text-4xl font-heading font-bold text-warm-orange mb-2">{stat.value}</div>
              <div className="text-warm-brown/70 text-sm font-semibold">{t(stat.label)}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};
