import { useMemo } from 'react'
import { useVoxelStore } from '../store/voxelStore'
import { DEFAULT_WORLD_DIMENSIONS, VOXEL_COLORS, type VoxelTable, type VoxelModelObject as VoxelModelObjectType } from '../types/voxel'
import { OrbitCamera } from './camera/OrbitCamera'
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
  const hoveredObjectId = useVoxelStore((state) => state.hoveredObjectId)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)
  const selectObject = useVoxelStore((state) => state.selectObject)
  const hoverObject = useVoxelStore((state) => state.hoverObject)

  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS
  const objects = layout?.objects ?? []

  const renderedObjects = useMemo(() => {
    return objects.map((obj) => {
      const isSelected = obj.id === selectedObjectId
      const isHovered = obj.id === hoveredObjectId

      const commonProps = {
        key: obj.id,
        position: obj.position,
        rotation: obj.rotation,
        isSelected,
        isHovered,
        isEditorMode,
        onClick: () => isEditorMode && selectObject(obj.id),
        onPointerEnter: () => isEditorMode && hoverObject(obj.id),
        onPointerLeave: () => isEditorMode && hoverObject(null),
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
              isHovered={isHovered}
              isEditorMode={isEditorMode}
              onClick={() => isEditorMode && selectObject(obj.id)}
              onPointerEnter={() => isEditorMode && hoverObject(obj.id)}
              onPointerLeave={() => isEditorMode && hoverObject(null)}
              modelConfig={modelObj.modelConfig}
            />
          )
        }
        default:
          return null
      }
    })
  }, [objects, selectedObjectId, hoveredObjectId, isEditorMode, selectObject, hoverObject])

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[dimensions.width, dimensions.height * 2, dimensions.depth]}
        intensity={0.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={100}
        shadow-camera-left={-dimensions.width}
        shadow-camera-right={dimensions.width}
        shadow-camera-top={dimensions.depth}
        shadow-camera-bottom={-dimensions.depth}
      />
      <directionalLight
        position={[-dimensions.width, dimensions.height, -dimensions.depth]}
        intensity={0.3}
      />

      {/* Sky / Background */}
      <color attach="background" args={['#1a1a2e']} />
      <fog attach="fog" args={['#1a1a2e', 30, 100]} />

      {/* Camera Controls */}
      <OrbitCamera isometric={isometric} />

      {/* Floor */}
      <VoxelFloor
        width={dimensions.width}
        depth={dimensions.depth}
        color={VOXEL_COLORS.floorTile}
      />

      {/* Walls */}
      <VoxelWalls
        width={dimensions.width}
        height={dimensions.height}
        depth={dimensions.depth}
        wallColor={VOXEL_COLORS.wallBrick}
      />

      {/* Objects */}
      {renderedObjects}

      {/* Grid helper for editor mode */}
      {isEditorMode && (
        <gridHelper
          args={[dimensions.width, dimensions.width, '#444', '#333']}
          position={[dimensions.width / 2, 0.01, dimensions.depth / 2]}
        />
      )}
    </>
  )
}
