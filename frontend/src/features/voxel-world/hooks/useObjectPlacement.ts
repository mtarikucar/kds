import { useCallback } from 'react'
import { useVoxelStore } from '../store/voxelStore'
import {
  FURNITURE_LIBRARY,
  DEFAULT_WORLD_DIMENSIONS,
  type LibraryItem,
  type VoxelObject,
  type VoxelModelObject,
  type ModelLibraryItem,
} from '../types/voxel'
import { suggestPosition } from '../utils/placementEngine'

export function useObjectPlacement() {
  const addObject = useVoxelStore((state) => state.addObject)
  const layout = useVoxelStore((state) => state.layout)

  const placeLibraryItem = useCallback(
    (item: LibraryItem) => {
      if (!layout) return

      // Tables must come from the database — block placement from the library
      if (item.type === 'table') return

      const worldDims = layout.dimensions ?? DEFAULT_WORLD_DIMENSIONS
      const suggested = suggestPosition(
        item.type,
        item.dimensions,
        layout.objects,
        worldDims,
      )

      const position = suggested ?? { x: 5, y: 0, z: 5 }

      const newObject: VoxelObject = {
        id: `${item.type}-${Date.now()}`,
        type: item.type,
        position,
        rotation: { y: 0 },
        metadata: {
          libraryItemId: item.id,
          dimensions: item.dimensions,
        },
      }

      addObject(newObject)
    },
    [layout, addObject]
  )

  const placeModelItem = useCallback(
    (item: ModelLibraryItem) => {
      if (!layout) return

      const worldDims = layout.dimensions ?? DEFAULT_WORLD_DIMENSIONS
      const suggested = suggestPosition(
        'model',
        item.dimensions,
        layout.objects,
        worldDims,
      )

      const position = suggested ?? { x: 5, y: 0, z: 5 }

      const newObject: VoxelModelObject = {
        id: `model-${Date.now()}`,
        type: 'model',
        position,
        rotation: { y: 0 },
        modelConfig: {
          modelUrl: item.modelUrl,
          scale: item.defaultScale,
          animations: item.animations?.map((name) => ({
            name,
            autoPlay: true,
            loop: true,
            speed: 1,
          })),
        },
        metadata: {
          modelLibraryItemId: item.id,
          dimensions: item.dimensions,
        },
      }

      addObject(newObject)
    },
    [layout, addObject]
  )

  return {
    placeLibraryItem,
    placeModelItem,
    furnitureLibrary: FURNITURE_LIBRARY,
  }
}
