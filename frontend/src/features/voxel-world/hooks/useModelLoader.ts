import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
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

export function useModelLoader(
  modelUrl: string | null,
  options: UseModelLoaderOptions = {}
): ModelLoadResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [progress, setProgress] = useState(0)

  const gltf = useMemo(() => {
    if (!modelUrl) return null
    try {
      return useGLTF(modelUrl)
    } catch {
      return null
    }
  }, [modelUrl])

  useEffect(() => {
    if (!modelUrl) {
      setIsLoading(false)
      setError(null)
      setProgress(0)
      return
    }

    if (loadedModels.has(modelUrl)) {
      setIsLoading(false)
      setProgress(100)
      return
    }

    setIsLoading(true)
    setError(null)
    setProgress(0)

    const existingPromise = loadingPromises.get(modelUrl)
    if (existingPromise) {
      existingPromise
        .then(() => {
          setIsLoading(false)
          setProgress(100)
        })
        .catch((err) => {
          setError(err)
          setIsLoading(false)
          options.onError?.(err)
        })
      return
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = Math.min(prev + 10, 90)
          options.onProgress?.(newProgress)
          return newProgress
        })
      }, 100)

      try {
        if (gltf) {
          clearInterval(progressInterval)
          loadedModels.set(modelUrl, {
            scene: gltf.scene.clone(),
            animations: gltf.animations || [],
          })
          setProgress(100)
          options.onProgress?.(100)
          setIsLoading(false)
          resolve()
        } else {
          clearInterval(progressInterval)
          reject(new Error(`Failed to load model: ${modelUrl}`))
        }
      } catch (err) {
        clearInterval(progressInterval)
        reject(err)
      }
    })

    loadingPromises.set(modelUrl, loadPromise)

    loadPromise
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        options.onError?.(err)
      })
      .finally(() => {
        loadingPromises.delete(modelUrl)
      })

    return () => {
      loadingPromises.delete(modelUrl)
    }
  }, [modelUrl, gltf, options])

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

    const cached = loadedModels.get(modelUrl)
    if (cached) {
      return {
        scene: cached.scene.clone(),
        animations: cached.animations,
        isLoading: false,
        error: null,
        progress: 100,
      }
    }

    if (gltf) {
      return {
        scene: gltf.scene.clone(),
        animations: gltf.animations || [],
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
  }, [modelUrl, gltf, isLoading, error, progress])

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
