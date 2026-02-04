import { useGLTF } from '@react-three/drei'
import { useMemo, useState, useEffect, useCallback } from 'react'
import * as THREE from 'three'

export interface ModelLoadResult {
  scene: THREE.Group | null
  animations: THREE.AnimationClip[]
  isLoading: boolean
  error: Error | null
  progress: number
}

export interface UseModelLoaderOptions {
  draco?: boolean
  onProgress?: (progress: number) => void
  onError?: (error: Error) => void
}

const loadedModels = new Map<string, { scene: THREE.Group; animations: THREE.AnimationClip[] }>()
const loadingPromises = new Map<string, Promise<void>>()

/**
 * Hook to load GLTF models.
 *
 * Note: This hook is currently not used in the codebase.
 * For model loading, prefer using useGLTF from @react-three/drei directly in components.
 *
 * @deprecated Use useGLTF from @react-three/drei directly instead
 */
export function useModelLoader(
  modelUrl: string | null,
  _options: UseModelLoaderOptions = {}
): ModelLoadResult {
  // All hooks must be called unconditionally at the top level
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [progress, setProgress] = useState(0)
  const [loadedData, setLoadedData] = useState<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>(null)

  // Reset state when modelUrl changes
  useEffect(() => {
    if (!modelUrl) {
      setIsLoading(false)
      setError(null)
      setProgress(0)
      setLoadedData(null)
      return
    }

    // Check cache first
    const cached = loadedModels.get(modelUrl)
    if (cached) {
      setLoadedData(cached)
      setIsLoading(false)
      setProgress(100)
      return
    }

    // Mark as loading - actual loading should be done via useGLTF in a separate component
    setIsLoading(true)
    setProgress(0)
  }, [modelUrl])

  const result = useMemo((): ModelLoadResult => {
    if (!modelUrl) {
      return {
        scene: null,
        animations: [],
        isLoading: false,
        error: null,
        progress: 0,
      }
    }

    if (loadedData) {
      return {
        scene: loadedData.scene.clone(),
        animations: loadedData.animations,
        isLoading: false,
        error: null,
        progress: 100,
      }
    }

    return {
      scene: null,
      animations: [],
      isLoading,
      error,
      progress,
    }
  }, [modelUrl, loadedData, isLoading, error, progress])

  return result
}

export function preloadModel(modelUrl: string): Promise<void> {
  if (loadedModels.has(modelUrl)) {
    return Promise.resolve()
  }

  const existingPromise = loadingPromises.get(modelUrl)
  if (existingPromise) {
    return existingPromise
  }

  const promise = new Promise<void>((resolve, reject) => {
    useGLTF.preload(modelUrl)
    setTimeout(() => {
      try {
        resolve()
      } catch (err) {
        reject(err)
      }
    }, 100)
  })

  loadingPromises.set(modelUrl, promise)
  promise.finally(() => loadingPromises.delete(modelUrl))

  return promise
}

export function clearModelCache(modelUrl?: string): void {
  if (modelUrl) {
    loadedModels.delete(modelUrl)
    useGLTF.clear(modelUrl)
  } else {
    loadedModels.clear()
  }
}
