/**
 * ChunkedStructureRenderer
 *
 * Per-chunk renderer that renders walls, windows, doors, railings,
 * and corner pieces from classified edges.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { type ThreeEvent } from '@react-three/fiber'
import type { CellEdge, CornerClassification } from '../types/worldModel'

const LEVEL_HEIGHT = 1
const RAILING_HEIGHT = 0.4
const RAILING_POST_THICKNESS = 0.02
const RAILING_POST_SPACING = 0.2
const RAILING_TOP_THICKNESS = 0.03

interface ChunkedStructureRendererProps {
  edges: ReadonlyArray<CellEdge>
  corners: ReadonlyArray<CornerClassification>
  wallMaterials: THREE.Material[]
  railingMaterial: THREE.Material
  windowMaterial: THREE.Material
  doorMaterial: THREE.Material
  wallHeight: number
  wallThickness: number
  onEdgeClick?: (edge: CellEdge, e: ThreeEvent<MouseEvent>) => void
}

export function ChunkedStructureRenderer({
  edges,
  corners,
  wallMaterials,
  railingMaterial,
  windowMaterial,
  doorMaterial,
  wallHeight,
  wallThickness,
  onEdgeClick,
}: ChunkedStructureRendererProps) {
  // Separate edges by type for rendering
  const { walls, windows, doors, railings } = useMemo(() => {
    const walls: CellEdge[] = []
    const windows: CellEdge[] = []
    const doors: CellEdge[] = []
    const railings: CellEdge[] = []

    for (const edge of edges) {
      switch (edge.classification.type) {
        case 'wall':
          walls.push(edge)
          break
        case 'window':
          windows.push(edge)
          break
        case 'door':
          doors.push(edge)
          break
        case 'railing':
          railings.push(edge)
          break
        // 'open' and 'none' edges are not rendered
      }
    }

    return { walls, windows, doors, railings }
  }, [edges])

  return (
    <group>
      {/* Wall edges */}
      {walls.map((edge, i) => (
        <WallEdgeMesh
          key={`w-${edge.x}-${edge.z}-${edge.level}-${edge.side}`}
          edge={edge}
          materials={wallMaterials}
          height={wallHeight}
          thickness={wallThickness}
          onClick={onEdgeClick}
        />
      ))}

      {/* Window edges */}
      {windows.map((edge) => (
        <WindowEdgeMesh
          key={`win-${edge.x}-${edge.z}-${edge.level}-${edge.side}`}
          edge={edge}
          wallMaterials={wallMaterials}
          windowMaterial={windowMaterial}
          height={wallHeight}
          thickness={wallThickness}
          onClick={onEdgeClick}
        />
      ))}

      {/* Door edges */}
      {doors.map((edge) => (
        <DoorEdgeMesh
          key={`d-${edge.x}-${edge.z}-${edge.level}-${edge.side}`}
          edge={edge}
          doorMaterial={doorMaterial}
          wallMaterials={wallMaterials}
          height={wallHeight}
          thickness={wallThickness}
          onClick={onEdgeClick}
        />
      ))}

      {/* Railing edges */}
      {railings.map((edge) => (
        <RailingEdgeMesh
          key={`r-${edge.x}-${edge.z}-${edge.level}-${edge.side}`}
          edge={edge}
          material={railingMaterial}
        />
      ))}

      {/* Corner pieces */}
      {corners.map((corner, i) => (
        <CornerMesh
          key={`c-${corner.x}-${corner.z}-${corner.level}-${i}`}
          corner={corner}
          materials={wallMaterials}
          height={wallHeight}
          thickness={wallThickness}
        />
      ))}
    </group>
  )
}

// --- Edge position helpers ---

function getEdgePosition(
  x: number,
  z: number,
  level: number,
  side: 'n' | 'e' | 's' | 'w',
  height: number
): [number, number, number] {
  const yPosition = (level - 1) * LEVEL_HEIGHT + height / 2

  switch (side) {
    case 'n':
      return [x + 0.5, yPosition, z]
    case 's':
      return [x + 0.5, yPosition, z + 1]
    case 'e':
      return [x + 1, yPosition, z + 0.5]
    case 'w':
      return [x, yPosition, z + 0.5]
  }
}

function isHorizontalEdge(side: 'n' | 'e' | 's' | 'w'): boolean {
  return side === 'n' || side === 's'
}

// --- Wall edge mesh ---

interface WallEdgeMeshProps {
  edge: CellEdge
  materials: THREE.Material[]
  height: number
  thickness: number
  onClick?: (edge: CellEdge, e: ThreeEvent<MouseEvent>) => void
}

function WallEdgeMesh({ edge, materials, height, thickness, onClick }: WallEdgeMeshProps) {
  const matIndex = Math.min(edge.level - 1, materials.length - 1)
  const material = materials[matIndex]
  const horizontal = isHorizontalEdge(edge.side)

  const geometry = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(1, height, thickness)
      : new THREE.BoxGeometry(thickness, height, 1)
  }, [horizontal, height, thickness])

  const position = getEdgePosition(edge.x, edge.z, edge.level, edge.side, height)

  return (
    <mesh
      position={position}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      onClick={onClick ? (e) => onClick(edge, e) : undefined}
    />
  )
}

// --- Window edge mesh ---

interface WindowEdgeMeshProps {
  edge: CellEdge
  wallMaterials: THREE.Material[]
  windowMaterial: THREE.Material
  height: number
  thickness: number
  onClick?: (edge: CellEdge, e: ThreeEvent<MouseEvent>) => void
}

function WindowEdgeMesh({
  edge,
  wallMaterials,
  windowMaterial,
  height,
  thickness,
  onClick,
}: WindowEdgeMeshProps) {
  const matIndex = Math.min(edge.level - 1, wallMaterials.length - 1)
  const wallMat = wallMaterials[matIndex]
  const horizontal = isHorizontalEdge(edge.side)
  const yBase = (edge.level - 1) * LEVEL_HEIGHT

  // Window proportions: small centered opening
  const windowWidth = 0.45
  const windowHeight = height * 0.35
  const windowBottom = height * 0.4
  const wallAboveHeight = height - windowBottom - windowHeight
  const sideWallWidth = (1 - windowWidth) / 2

  // Wall below window
  const bottomGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(1, windowBottom, thickness)
      : new THREE.BoxGeometry(thickness, windowBottom, 1)
  }, [horizontal, windowBottom, thickness])

  // Wall above window
  const topGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(1, wallAboveHeight, thickness)
      : new THREE.BoxGeometry(thickness, wallAboveHeight, 1)
  }, [horizontal, wallAboveHeight, thickness])

  // Side wall pieces (left and right of window)
  const sideGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(sideWallWidth, windowHeight, thickness)
      : new THREE.BoxGeometry(thickness, windowHeight, sideWallWidth)
  }, [horizontal, sideWallWidth, windowHeight, thickness])

  // Window pane (glass)
  const windowGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(windowWidth, windowHeight, thickness * 0.2)
      : new THREE.BoxGeometry(thickness * 0.2, windowHeight, windowWidth)
  }, [horizontal, windowWidth, windowHeight, thickness])

  // Frame material (dark wood)
  const frameMat = useMemo(() => {
    return new THREE.MeshStandardMaterial({ color: '#5a3a1a', roughness: 0.7, metalness: 0 })
  }, [])

  // Window frame pieces
  const frameThick = 0.03
  const frameHGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(windowWidth + frameThick * 2, frameThick, thickness * 0.4)
      : new THREE.BoxGeometry(thickness * 0.4, frameThick, windowWidth + frameThick * 2)
  }, [horizontal, windowWidth, thickness])

  const frameVGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(frameThick, windowHeight, thickness * 0.4)
      : new THREE.BoxGeometry(thickness * 0.4, windowHeight, frameThick)
  }, [horizontal, windowHeight, thickness])

  const basePos = getEdgePosition(edge.x, edge.z, edge.level, edge.side, height)
  const bottomPos: [number, number, number] = [basePos[0], yBase + windowBottom / 2, basePos[2]]
  const topPos: [number, number, number] = [basePos[0], yBase + windowBottom + windowHeight + wallAboveHeight / 2, basePos[2]]
  const windowPos: [number, number, number] = [basePos[0], yBase + windowBottom + windowHeight / 2, basePos[2]]

  // Side wall offsets
  const sideOffset = (windowWidth + sideWallWidth) / 2
  const leftSidePos: [number, number, number] = horizontal
    ? [basePos[0] - sideOffset, yBase + windowBottom + windowHeight / 2, basePos[2]]
    : [basePos[0], yBase + windowBottom + windowHeight / 2, basePos[2] - sideOffset]
  const rightSidePos: [number, number, number] = horizontal
    ? [basePos[0] + sideOffset, yBase + windowBottom + windowHeight / 2, basePos[2]]
    : [basePos[0], yBase + windowBottom + windowHeight / 2, basePos[2] + sideOffset]

  // Frame positions
  const frameTopPos: [number, number, number] = [windowPos[0], yBase + windowBottom + windowHeight, windowPos[2]]
  const frameBotPos: [number, number, number] = [windowPos[0], yBase + windowBottom, windowPos[2]]
  const frameLeftPos: [number, number, number] = horizontal
    ? [windowPos[0] - windowWidth / 2, windowPos[1], windowPos[2]]
    : [windowPos[0], windowPos[1], windowPos[2] - windowWidth / 2]
  const frameRightPos: [number, number, number] = horizontal
    ? [windowPos[0] + windowWidth / 2, windowPos[1], windowPos[2]]
    : [windowPos[0], windowPos[1], windowPos[2] + windowWidth / 2]

  return (
    <group onClick={onClick ? (e) => onClick(edge, e) : undefined}>
      {/* Solid wall sections */}
      <mesh position={bottomPos} geometry={bottomGeom} material={wallMat} castShadow receiveShadow />
      <mesh position={topPos} geometry={topGeom} material={wallMat} castShadow receiveShadow />
      <mesh position={leftSidePos} geometry={sideGeom} material={wallMat} castShadow receiveShadow />
      <mesh position={rightSidePos} geometry={sideGeom} material={wallMat} castShadow receiveShadow />
      {/* Glass pane */}
      <mesh position={windowPos} geometry={windowGeom} material={windowMaterial} />
      {/* Window frame */}
      <mesh position={frameTopPos} geometry={frameHGeom} material={frameMat} />
      <mesh position={frameBotPos} geometry={frameHGeom} material={frameMat} />
      <mesh position={frameLeftPos} geometry={frameVGeom} material={frameMat} />
      <mesh position={frameRightPos} geometry={frameVGeom} material={frameMat} />
    </group>
  )
}

// --- Door edge mesh ---

interface DoorEdgeMeshProps {
  edge: CellEdge
  doorMaterial: THREE.Material
  wallMaterials: THREE.Material[]
  height: number
  thickness: number
  onClick?: (edge: CellEdge, e: ThreeEvent<MouseEvent>) => void
}

function DoorEdgeMesh({
  edge,
  doorMaterial,
  wallMaterials,
  height,
  thickness,
  onClick,
}: DoorEdgeMeshProps) {
  const matIndex = Math.min(edge.level - 1, wallMaterials.length - 1)
  const wallMat = wallMaterials[matIndex]
  const horizontal = isHorizontalEdge(edge.side)
  const yBase = (edge.level - 1) * LEVEL_HEIGHT

  const doorHeight = height * 0.85
  const transom = height - doorHeight

  // Door panel
  const doorGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(0.7, doorHeight, thickness * 0.5)
      : new THREE.BoxGeometry(thickness * 0.5, doorHeight, 0.7)
  }, [horizontal, doorHeight, thickness])

  // Transom above door
  const transomGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(1, transom, thickness)
      : new THREE.BoxGeometry(thickness, transom, 1)
  }, [horizontal, transom, thickness])

  const basePos = getEdgePosition(edge.x, edge.z, edge.level, edge.side, height)
  const doorPos: [number, number, number] = [
    basePos[0],
    yBase + doorHeight / 2,
    basePos[2],
  ]
  const transomPos: [number, number, number] = [
    basePos[0],
    yBase + doorHeight + transom / 2,
    basePos[2],
  ]

  return (
    <group onClick={onClick ? (e) => onClick(edge, e) : undefined}>
      <mesh position={doorPos} geometry={doorGeom} material={doorMaterial} castShadow receiveShadow />
      {transom > 0.01 && (
        <mesh position={transomPos} geometry={transomGeom} material={wallMat} castShadow receiveShadow />
      )}
    </group>
  )
}

// --- Railing edge mesh ---

interface RailingEdgeMeshProps {
  edge: CellEdge
  material: THREE.Material
}

function RailingEdgeMesh({ edge, material }: RailingEdgeMeshProps) {
  const baseY = (edge.level - 1) * LEVEL_HEIGHT + LEVEL_HEIGHT
  const horizontal = isHorizontalEdge(edge.side)

  // Posts along the railing
  const posts = useMemo(() => {
    const result: Array<[number, number, number]> = []
    const numPosts = Math.ceil(1 / RAILING_POST_SPACING) + 1

    for (let i = 0; i < numPosts; i++) {
      const offset = Math.min(i * RAILING_POST_SPACING, 1)

      switch (edge.side) {
        case 'n':
          result.push([edge.x + offset, baseY + RAILING_HEIGHT / 2, edge.z])
          break
        case 's':
          result.push([edge.x + offset, baseY + RAILING_HEIGHT / 2, edge.z + 1])
          break
        case 'e':
          result.push([edge.x + 1, baseY + RAILING_HEIGHT / 2, edge.z + offset])
          break
        case 'w':
          result.push([edge.x, baseY + RAILING_HEIGHT / 2, edge.z + offset])
          break
      }
    }

    return result
  }, [edge, baseY])

  const postGeom = useMemo(() => {
    return new THREE.BoxGeometry(RAILING_POST_THICKNESS, RAILING_HEIGHT, RAILING_POST_THICKNESS)
  }, [])

  // Top rail
  const topRailGeom = useMemo(() => {
    return horizontal
      ? new THREE.BoxGeometry(1, RAILING_TOP_THICKNESS, RAILING_TOP_THICKNESS)
      : new THREE.BoxGeometry(RAILING_TOP_THICKNESS, RAILING_TOP_THICKNESS, 1)
  }, [horizontal])

  const topY = baseY + RAILING_HEIGHT

  const topRailPos: [number, number, number] = (() => {
    switch (edge.side) {
      case 'n': return [edge.x + 0.5, topY, edge.z]
      case 's': return [edge.x + 0.5, topY, edge.z + 1]
      case 'e': return [edge.x + 1, topY, edge.z + 0.5]
      case 'w': return [edge.x, topY, edge.z + 0.5]
    }
  })()

  return (
    <group>
      {posts.map((pos, i) => (
        <mesh
          key={i}
          position={pos}
          geometry={postGeom}
          material={material}
          castShadow
          receiveShadow
        />
      ))}
      <mesh
        position={topRailPos}
        geometry={topRailGeom}
        material={material}
        castShadow
        receiveShadow
      />
    </group>
  )
}

// --- Corner mesh ---

interface CornerMeshProps {
  corner: CornerClassification
  materials: THREE.Material[]
  height: number
  thickness: number
}

function CornerMesh({ corner, materials, height, thickness }: CornerMeshProps) {
  if (corner.type === 'none') return null

  const matIndex = Math.min(corner.level - 1, materials.length - 1)
  const material = materials[matIndex]

  const geometry = useMemo(() => {
    return new THREE.BoxGeometry(thickness, height, thickness)
  }, [thickness, height])

  const yPosition = (corner.level - 1) * LEVEL_HEIGHT + height / 2

  return (
    <mesh
      position={[corner.x, yPosition, corner.z]}
      rotation={[0, THREE.MathUtils.degToRad(corner.rotation), 0]}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
    />
  )
}

export default ChunkedStructureRenderer
