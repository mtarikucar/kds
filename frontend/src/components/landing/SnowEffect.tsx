import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface Snowflake {
  id: number;
  x: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
}

export const SnowEffect = () => {
  const [snowflakes, setSnowflakes] = useState<Snowflake[]>([]);

  useEffect(() => {
    // Create snowflakes with random properties
    const flakes: Snowflake[] = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100, // Random horizontal position (0-100%)
      size: Math.random() * 8 + 4, // Size between 4-12px
      duration: Math.random() * 10 + 15, // Duration between 15-25s
      delay: Math.random() * 10, // Random initial delay
      opacity: Math.random() * 0.3 + 0.1, // Opacity between 0.1-0.4
    }));
    setSnowflakes(flakes);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[5] overflow-hidden">
      {snowflakes.map((flake) => (
        <motion.div
          key={flake.id}
          className="absolute"
          style={{
            left: `${flake.x}%`,
            width: flake.size,
            height: flake.size,
          }}
          initial={{
            top: -20,
            rotate: 0,
            opacity: 0,
          }}
          animate={{
            top: '100vh',
            rotate: 360,
            opacity: [0, flake.opacity, flake.opacity, 0],
          }}
          transition={{
            duration: flake.duration,
            repeat: Infinity,
            delay: flake.delay,
            ease: 'linear',
          }}
        >
          {/* Snowflake character or simple circle */}
          <div
            className="w-full h-full rounded-full bg-white/80 shadow-sm"
            style={{
              boxShadow: `0 0 ${flake.size}px rgba(255, 255, 255, 0.5)`,
            }}
          />
        </motion.div>
      ))}

      {/* Warm corner glows */}
      <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-gradient-to-br from-amber-100/20 to-transparent rounded-full blur-[100px]" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-tl from-orange-100/20 to-transparent rounded-full blur-[100px]" />
    </div>
  );
};
