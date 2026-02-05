import { useMemo } from 'react'
import { useVoxelStore } from '../store/voxelStore'
import { DEFAULT_WORLD_DIMENSIONS, type VoxelTable, type VoxelModelObject as VoxelModelObjectType } from '../types/voxel'
import { IsometricCamera } from './camera/IsometricCamera'
import { ProceduralFloor } from './ProceduralFloor'
import { ProceduralWalls } from './ProceduralWalls'
import { ProceduralStairs } from './ProceduralStairs'
import { ProceduralRailings } from './ProceduralRailings'
import { InteractiveGrid } from './InteractiveGrid'
import { VoxelTableObject } from './objects/VoxelTable'
import { VoxelChair } from './objects/VoxelChair'
import { VoxelKitchen } from './objects/VoxelKitchen'
import { VoxelBar } from './objects/VoxelBar'
import { VoxelDecor } from './objects/VoxelDecor'
import { VoxelModelObject } from './objects/VoxelModelObject'
import { ManipulationHandles } from './interaction/ManipulationHandles'
import { GhostPreview } from './interaction/GhostPreview'
import { SnapGuides } from './interaction/SnapGuide'
import { PointerCapturePlane } from './interaction/PointerCapturePlane'
import { useManipulationGestures } from '../hooks/useManipulationGestures'
import { getFloorBounds } from '../utils/procedural/floorCellManager'

interface VoxelWorldProps {
  isometric?: boolean
}

/**
 * Separate component for manipulation features to isolate hooks
 * This prevents "Rendered more hooks than previous render" errors
 */
function ManipulationLayer({ dimensions }: { dimensions: { width: number; height: number; depth: number } }) {
  const manipulation = useVoxelStore((state) => state.manipulation)
  const snapConfig = useVoxelStore((state) => state.snapConfig)
  const snapGuides = useVoxelStore((state) => state.snapGuides)

  const {
    selectedObject,
    handleHandlePointerDown,
    handleHandlePointerUp,
    handleWorldPointerMove,
  } = useManipulationGestures({ enabled: true })

  return (
    <>
      {/* Pointer Capture Plane - active during manipulation */}
      <PointerCapturePlane
        width={dimensions.width}
        depth={dimensions.depth}
        onPointerMove={handleWorldPointerMove}
        onPointerUp={() => handleHandlePointerUp()}
        enabled={manipulation.mode !== 'none'}
      />

      {/* Ghost Preview - manipulation sırasında */}
      {manipulation.ghostPreview && (
        <GhostPreview object={manipulation.ghostPreview} />
      )}

      {/* Manipulation Handles - seçili obje için */}
      {selectedObject && (
        <ManipulationHandles
          object={selectedObject}
          onHandlePointerDown={handleHandlePointerDown}
          onHandlePointerUp={handleHandlePointerUp}
          activeHandle={manipulation.activeHandle}
        />
      )}

      {/* Snap Guides */}
      {snapConfig.showGuides && snapGuides.length > 0 && (
        <SnapGuides guides={snapGuides} worldDimensions={dimensions} />
      )}
    </>
  )
}

export function VoxelWorld({ isometric = false }: VoxelWorldProps) {
  const layout = useVoxelStore((state) => state.layout)
  const selectedObjectId = useVoxelStore((state) => state.selectedObjectId)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)
  const selectObject = useVoxelStore((state) => state.selectObject)
  const floorCells = useVoxelStore((state) => state.floorCells)

  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS
  const objects = layout?.objects ?? []

  // Calculate effective dimensions based on floor cells or layout
  const effectiveDimensions = useMemo(() => {
    const bounds = getFloorBounds(floorCells)
    if (bounds) {
      return {
        width: Math.max(bounds.maxX + 2, 16),
        height: dimensions.height,
        depth: Math.max(bounds.maxZ + 2, 16),
      }
    }
    return dimensions
  }, [floorCells, dimensions])

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

  // Use effectiveDimensions for camera and lighting calculations
  const viewDimensions = effectiveDimensions

  return (
    <>
      {/* Lighting - bright for white theme */}
      <ambientLight intensity={0.9} />
      <directionalLight
        position={[viewDimensions.width * 1.5, viewDimensions.height * 3, viewDimensions.depth * 1.5]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={150}
        shadow-camera-left={-viewDimensions.width}
        shadow-camera-right={viewDimensions.width}
        shadow-camera-top={viewDimensions.depth}
        shadow-camera-bottom={-viewDimensions.depth}
      />
      <directionalLight
        position={[-viewDimensions.width, viewDimensions.height * 2, viewDimensions.depth]}
        intensity={0.4}
      />
      {/* Fill light */}
      <directionalLight
        position={[viewDimensions.width, viewDimensions.height, viewDimensions.depth * 2]}
        intensity={0.3}
      />

      {/* White background */}
      <color attach="background" args={['#ffffff']} />

      {/* Camera Controls - Isometric */}
      <IsometricCamera
        target={[viewDimensions.width / 2, 0, viewDimensions.depth / 2]}
        distance={Math.max(viewDimensions.width, viewDimensions.depth) * 1.5}
      />

      {/* Procedural Floor - Townscaper-style */}
      <ProceduralFloor color="#e8dcc8" />

      {/* Procedural Walls - auto-generated at floor edges */}
      <ProceduralWalls
        wallColor="#f5f5f5"
        wallHeight={1}
      />

      {/* Procedural Stairs - manually placed between levels */}
      <ProceduralStairs />

      {/* Procedural Railings - auto-generated at upper level edges */}
      <ProceduralRailings />

      {/* Interactive Grid for floor editing */}
      {isEditorMode && (
        <InteractiveGrid
          size={64}
          enabled={true}
          showGridLines={true}
        />
      )}

      {/* Objects */}
      {renderedObjects}

      {/* Manipulation Layer - only in editor mode */}
      {isEditorMode && <ManipulationLayer dimensions={viewDimensions} />}
    </>
  )
}
