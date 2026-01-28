import { useState, useCallback, useRef } from 'react'
import { MASCOT_DIALOGUES, type DialoguePhase } from '../data/mascotDialogues'

interface UseMascotDialogueOptions {
  phase: DialoguePhase
  autoHideDelay?: number
}

interface UseMascotDialogueReturn {
  currentText: string | null
  isVisible: boolean
  showNext: () => void
  hide: () => void
}

export function useMascotDialogue({
  phase,
  autoHideDelay = 4000,
}: UseMascotDialogueOptions): UseMascotDialogueReturn {
  const [currentText, setCurrentText] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const indexRef = useRef(0)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearHideTimeout()
    setIsVisible(false)
    setCurrentText(null)
  }, [clearHideTimeout])

  const showNext = useCallback(() => {
    clearHideTimeout()

    const dialogues = MASCOT_DIALOGUES[phase]

    if (phase === 'exterior') {
      // Sequential dialogues for exterior
      const text = dialogues[indexRef.current % dialogues.length]
      setCurrentText(text)
      setIsVisible(true)
      indexRef.current = (indexRef.current + 1) % dialogues.length
    } else {
      // Random dialogues for interior
      const randomIndex = Math.floor(Math.random() * dialogues.length)
      setCurrentText(dialogues[randomIndex])
      setIsVisible(true)
    }

    // Auto-hide after delay
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false)
      setCurrentText(null)
    }, autoHideDelay)
  }, [phase, autoHideDelay, clearHideTimeout])

  return {
    currentText,
    isVisible,
    showNext,
    hide,
  }
}
