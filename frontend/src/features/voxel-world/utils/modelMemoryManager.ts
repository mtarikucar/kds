import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

interface ModelCacheEntry {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
  refCount: number
  lastAccessed: number
  memorySize: number
}

interface MemoryStats {
  totalModels: number
  totalMemoryMB: number
  modelStats: Array<{
    url: string
    refCount: number
    memoryMB: number
    lastAccessed: Date
  }>
}

const modelCache = new Map<string, ModelCacheEntry>()
const MAX_CACHE_SIZE_MB = 100
const CACHE_CLEANUP_THRESHOLD_MB = 80
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

export function estimateObjectMemorySize(object: THREE.Object3D): number {
  let totalBytes = 0

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry as THREE.BufferGeometry
      if (geometry.attributes) {
        Object.values(geometry.attributes).forEach((attribute) => {
          if (attribute instanceof THREE.BufferAttribute) {
            totalBytes += attribute.array.byteLength
          }
        })
      }
      if (geometry.index) {
        totalBytes += geometry.index.array.byteLength
      }

      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            const textures = [
              material.map,
              material.normalMap,
              material.roughnessMap,
              material.metalnessMap,
              material.aoMap,
              material.emissiveMap,
            ].filter(Boolean)

            textures.forEach((texture) => {
              if (texture instanceof THREE.Texture && texture.image) {
                const img = texture.image
                if (img.width && img.height) {
                  totalBytes += img.width * img.height * 4
                }
              }
            })
          }
        })
      }
    }
  })

  return totalBytes
}

export function registerModel(url: string, scene: THREE.Group, animations: THREE.AnimationClip[]): void {
  const existing = modelCache.get(url)
  if (existing) {
    existing.refCount++
    existing.lastAccessed = Date.now()
    return
  }

  const memorySize = estimateObjectMemorySize(scene)
  modelCache.set(url, {
    scene: scene.clone(),
    animations,
    refCount: 1,
    lastAccessed: Date.now(),
    memorySize,
  })

  const totalMemory = getTotalCacheMemory()
  if (totalMemory > CACHE_CLEANUP_THRESHOLD_MB * 1024 * 1024) {
    cleanupCache()
  }
}

export function unregisterModel(url: string): void {
  const entry = modelCache.get(url)
  if (entry) {
    entry.refCount--
    if (entry.refCount <= 0) {
      entry.lastAccessed = Date.now()
    }
  }
}

export function getModelFromCache(url: string): ModelCacheEntry | undefined {
  const entry = modelCache.get(url)
  if (entry) {
    entry.lastAccessed = Date.now()
  }
  return entry
}

function getTotalCacheMemory(): number {
  let total = 0
  modelCache.forEach((entry) => {
    total += entry.memorySize
  })
  return total
}

function cleanupCache(): void {
  const now = Date.now()
  const entriesToRemove: string[] = []

  const entries = Array.from(modelCache.entries())
    .filter(([_, entry]) => entry.refCount <= 0)
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)

  let currentMemory = getTotalCacheMemory()
  const targetMemory = MAX_CACHE_SIZE_MB * 1024 * 1024 * 0.6

  for (const [url, entry] of entries) {
    if (currentMemory <= targetMemory) break

    const isIdle = now - entry.lastAccessed > IDLE_TIMEOUT_MS
    if (isIdle || currentMemory > MAX_CACHE_SIZE_MB * 1024 * 1024) {
      entriesToRemove.push(url)
      currentMemory -= entry.memorySize
    }
  }

  entriesToRemove.forEach((url) => {
    const entry = modelCache.get(url)
    if (entry) {
      disposeObject(entry.scene)
      modelCache.delete(url)
      useGLTF.clear(url)
    }
  })
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose()

      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.map?.dispose()
            material.normalMap?.dispose()
            material.roughnessMap?.dispose()
            material.metalnessMap?.dispose()
            material.aoMap?.dispose()
            material.emissiveMap?.dispose()
            material.dispose()
          } else if (material instanceof THREE.Material) {
            material.dispose()
          }
        })
      }
    }
  })
}

export function getMemoryStats(): MemoryStats {
  const stats: MemoryStats = {
    totalModels: modelCache.size,
    totalMemoryMB: getTotalCacheMemory() / (1024 * 1024),
    modelStats: [],
  }

  modelCache.forEach((entry, url) => {
    stats.modelStats.push({
      url,
      refCount: entry.refCount,
      memoryMB: entry.memorySize / (1024 * 1024),
      lastAccessed: new Date(entry.lastAccessed),
    })
  })

  return stats
}

export function clearAllCache(): void {
  modelCache.forEach((entry, url) => {
    disposeObject(entry.scene)
    useGLTF.clear(url)
  })
  modelCache.clear()
}

export function preloadModels(urls: string[]): Promise<void[]> {
  return Promise.all(
    urls.map((url) => {
      useGLTF.preload(url)
      return Promise.resolve()
    })
  )
}
