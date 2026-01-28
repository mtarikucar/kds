import { useState, useEffect } from 'react'
import { Html } from '@react-three/drei'
import { motion, AnimatePresence } from 'framer-motion'

interface SpeechBubble3DProps {
  text: string | null
  visible: boolean
  position: [number, number, number]
  onComplete?: () => void
}

export function SpeechBubble3D({
  text,
  visible,
  position,
  onComplete,
}: SpeechBubble3DProps) {
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(false)

  // Typewriter effect
  useEffect(() => {
    if (!visible || !text) {
      setDisplayedText('')
      setIsTyping(false)
      return
    }

    setIsTyping(true)
    setDisplayedText('')

    let currentIndex = 0
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1))
        currentIndex++
      } else {
        clearInterval(interval)
        setIsTyping(false)
        onComplete?.()
      }
    }, 40) // 40ms per character

    return () => clearInterval(interval)
  }, [text, visible, onComplete])

  if (!visible || !text) return null

  return (
    <Html
      position={position}
      center
      distanceFactor={15}
      style={{ pointerEvents: 'none' }}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 20,
            }}
            className="relative"
          >
            {/* Speech bubble */}
            <div className="relative rounded-2xl bg-white px-4 py-3 shadow-lg">
              {/* Text content */}
              <p className="whitespace-nowrap text-base font-medium text-gray-800">
                {displayedText}
                {isTyping && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.5 }}
                  >
                    |
                  </motion.span>
                )}
              </p>

              {/* Tail pointing down */}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                <div className="h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-white" />
              </div>
            </div>

            {/* Subtle shadow under the bubble */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 0.2 }}
              className="absolute -bottom-4 left-1/2 h-2 w-16 -translate-x-1/2 rounded-full bg-black blur-sm"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Html>
  )
}
