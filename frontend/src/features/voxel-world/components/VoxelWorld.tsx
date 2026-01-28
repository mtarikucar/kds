import { useMemo } from 'react'
import { useVoxelStore } from '../store/voxelStore'
import { DEFAULT_WORLD_DIMENSIONS, type VoxelTable, type VoxelModelObject as VoxelModelObjectType } from '../types/voxel'
import { IsometricCamera } from './camera/IsometricCamera'
import { VoxelFloor } from './VoxelFloor'
import { VoxelWalls } from './VoxelWalls'
import { VoxelTableObject } from './objects/VoxelTable'
import { VoxelChair } from './objects/VoxelChair'
import { VoxelKitchen } from './objects/VoxelKitchen'
import { VoxelBar } from './objects/VoxelBar'
import { VoxelDecor } from './objects/VoxelDecor'
import { VoxelModelObject } from './objects/VoxelModelObject'

interface VoxelWorldProps {
  isometric?: boolean
}

export function VoxelWorld({ isometric = false }: VoxelWorldProps) {
  const layout = useVoxelStore((state) => state.layout)
  const selectedObjectId = useVoxelStore((state) => state.selectedObjectId)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)
  const selectObject = useVoxelStore((state) => state.selectObject)

  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS
  const objects = layout?.objects ?? []

  const renderedObjects = useMemo(() => {
    return objects.map((obj) => {
      const isSelected = obj.id === selectedObjectId

      const commonProps = {
        key: obj.id,
        position: obj.position,
        rotation: obj.rotation,
        isSelected,
        isEditorMode,
        onClick: () => isEditorMode && selectObject(obj.id),
      }

      switch (obj.type) {
        case 'table': {
          const tableObj = obj as VoxelTable
          return (
            <VoxelTableObject
              {...commonProps}
              status={tableObj.status}
              tableNumber={tableObj.tableNumber}
              capacity={tableObj.capacity}
            />
          )
        }
        case 'chair':
          return <VoxelChair {...commonProps} />
        case 'kitchen':
          return <VoxelKitchen {...commonProps} />
        case 'bar':
          return <VoxelBar {...commonProps} />
        case 'decor':
          return <VoxelDecor {...commonProps} />
        case 'model': {
          const modelObj = obj as VoxelModelObjectType
          return (
            <VoxelModelObject
              key={obj.id}
              id={obj.id}
              position={obj.position}
              rotation={obj.rotation}
              isSelected={isSelected}
              isEditorMode={isEditorMode}
              onClick={() => isEditorMode && selectObject(obj.id)}
              modelConfig={modelObj.modelConfig}
            />
          )
        }
        default:
          return null
      }
    })
  }, [objects, selectedObjectId, isEditorMode, selectObject])

  return (
    <>
      {/* Lighting - bright for white theme */}
      <ambientLight intensity={0.9} />
      <directionalLight
        position={[dimensions.width * 1.5, dimensions.height * 3, dimensions.depth * 1.5]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={150}
        shadow-camera-left={-dimensions.width}
        shadow-camera-right={dimensions.width}
        shadow-camera-top={dimensions.depth}
        shadow-camera-bottom={-dimensions.depth}
      />
      <directionalLight
        position={[-dimensions.width, dimensions.height * 2, dimensions.depth]}
        intensity={0.4}
      />
      {/* Fill light */}
      <directionalLight
        position={[dimensions.width, dimensions.height, dimensions.depth * 2]}
        intensity={0.3}
      />

      {/* White background */}
      <color attach="background" args={['#ffffff']} />

      {/* Camera Controls - Isometric */}
      <IsometricCamera
        target={[dimensions.width / 2, 0, dimensions.depth / 2]}
        distance={Math.max(dimensions.width, dimensions.depth) * 1.5}
      />

      {/* Floor - light wood color */}
      <VoxelFloor
        width={dimensions.width}
        depth={dimensions.depth}
        color="#e8dcc8"
      />

      {/* Walls - only 2 walls (back and left) */}
      <VoxelWalls
        width={dimensions.width}
        height={dimensions.height}
        depth={dimensions.depth}
        wallColor="#f5f5f5"
      />

      {/* Objects */}
      {renderedObjects}

      {/* Grid helper for editor mode */}
      {isEditorMode && (
        <gridHelper
          args={[dimensions.width, dimensions.width, '#ddd', '#eee']}
          position={[dimensions.width / 2, 0.01, dimensions.depth / 2]}
        />
      )}
    </>
  )
}
