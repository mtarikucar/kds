import { useState, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface AnimationState {
  currentAnimation: string | null
  isPlaying: boolean
  speed: number
  loop: boolean
  progress: number
}

export interface AnimationControls {
  play: (animationName?: string) => void
  pause: () => void
  stop: () => void
  setSpeed: (speed: number) => void
  setLoop: (loop: boolean) => void
  setProgress: (progress: number) => void
  getAvailableAnimations: () => string[]
}

export interface UseModelAnimationOptions {
  defaultAnimation?: string
  autoPlay?: boolean
  defaultSpeed?: number
  defaultLoop?: boolean
  onAnimationStart?: (name: string) => void
  onAnimationEnd?: (name: string) => void
}

export function useModelAnimation(
  actions: Record<string, THREE.AnimationAction | null>,
  names: string[],
  options: UseModelAnimationOptions = {}
): [AnimationState, AnimationControls] {
  const {
    defaultAnimation,
    autoPlay = true,
    defaultSpeed = 1,
    defaultLoop = true,
    onAnimationStart,
    onAnimationEnd,
  } = options

  const [state, setState] = useState<AnimationState>({
    currentAnimation: defaultAnimation || (names.length > 0 ? names[0] : null),
    isPlaying: autoPlay,
    speed: defaultSpeed,
    loop: defaultLoop,
    progress: 0,
  })

  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const updateProgress = useCallback(() => {
    if (currentActionRef.current && state.isPlaying) {
      const action = currentActionRef.current
      const clip = action.getClip()
      const progress = (action.time / clip.duration) * 100

      setState((prev) => ({ ...prev, progress }))
      animationFrameRef.current = requestAnimationFrame(updateProgress)
    }
  }, [state.isPlaying])

  const play = useCallback(
    (animationName?: string) => {
      const targetAnimation = animationName || state.currentAnimation
      if (!targetAnimation || !actions[targetAnimation]) return

      Object.values(actions).forEach((action) => {
        if (action && action !== actions[targetAnimation]) {
          action.fadeOut(0.3)
        }
      })

      const action = actions[targetAnimation]
      if (action) {
        currentActionRef.current = action
        action.reset()
        action.fadeIn(0.3)
        action.play()
        action.setLoop(
          state.loop ? THREE.LoopRepeat : THREE.LoopOnce,
          state.loop ? Infinity : 1
        )
        action.timeScale = state.speed

        setState((prev) => ({
          ...prev,
          currentAnimation: targetAnimation,
          isPlaying: true,
          progress: 0,
        }))

        onAnimationStart?.(targetAnimation)

        if (!state.loop) {
          const clip = action.getClip()
          const duration = (clip.duration / state.speed) * 1000

          setTimeout(() => {
            onAnimationEnd?.(targetAnimation)
            setState((prev) => ({
              ...prev,
              isPlaying: false,
              progress: 100,
            }))
          }, duration)
        }
      }
    },
    [actions, state.currentAnimation, state.loop, state.speed, onAnimationStart, onAnimationEnd]
  )

  const pause = useCallback(() => {
    if (currentActionRef.current) {
      currentActionRef.current.paused = true
      setState((prev) => ({ ...prev, isPlaying: false }))
    }
  }, [])

  const stop = useCallback(() => {
    if (currentActionRef.current) {
      currentActionRef.current.stop()
      currentActionRef.current = null
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        progress: 0,
      }))
    }
  }, [])

  const setSpeed = useCallback((speed: number) => {
    const clampedSpeed = Math.max(0.1, Math.min(3, speed))
    if (currentActionRef.current) {
      currentActionRef.current.timeScale = clampedSpeed
    }
    setState((prev) => ({ ...prev, speed: clampedSpeed }))
  }, [])

  const setLoop = useCallback((loop: boolean) => {
    if (currentActionRef.current) {
      currentActionRef.current.setLoop(
        loop ? THREE.LoopRepeat : THREE.LoopOnce,
        loop ? Infinity : 1
      )
    }
    setState((prev) => ({ ...prev, loop }))
  }, [])

  const setProgress = useCallback(
    (progress: number) => {
      if (currentActionRef.current) {
        const clip = currentActionRef.current.getClip()
        const time = (progress / 100) * clip.duration
        currentActionRef.current.time = time
        setState((prev) => ({ ...prev, progress }))
      }
    },
    []
  )

  const getAvailableAnimations = useCallback(() => names, [names])

  useEffect(() => {
    if (autoPlay && state.currentAnimation && actions[state.currentAnimation]) {
      play(state.currentAnimation)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (state.isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateProgress)
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [state.isPlaying, updateProgress])

  const controls: AnimationControls = {
    play,
    pause,
    stop,
    setSpeed,
    setLoop,
    setProgress,
    getAvailableAnimations,
  }

  return [state, controls]
}
