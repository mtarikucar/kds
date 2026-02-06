import type { VoxelObject, RestaurantLayout, WorldDimensions, VoxelTable, VoxelModelObject, ModelConfig, StairSegment } from '../types/voxel'
import { DEFAULT_WORLD_DIMENSIONS } from '../types/voxel'
import type { EdgeClassification } from '../types/worldModel'

interface SerializedModelConfig {
  u: string      // modelUrl
  sc?: number    // scale
  an?: Array<{ n: string; ap?: boolean; l?: boolean; sp?: number }>  // animations
  aa?: string    // activeAnimation
}

interface SerializedObject {
  i: string      // id
  t: string      // type
  p: [number, number, number]  // position [x, y, z]
  r: number      // rotation
  l?: string     // linkedTableId (for tables)
  s?: string     // status (for tables)
  n?: string     // tableNumber (for tables)
  c?: number     // capacity (for tables)
  mc?: SerializedModelConfig  // modelConfig (for models)
  m?: Record<string, unknown>  // metadata
}

interface SerializedStair {
  x: number
  z: number
  l: number      // level
  s: string      // side
}

interface SerializedOverride {
  k: string      // edgeKey
  c: EdgeClassification
}

/**
 * v1: objects only
 * v2: objects + floor cells + stairs + overrides
 */
interface SerializedLayoutV1 {
  v: 1
  d: [number, number, number]
  o: SerializedObject[]
}

interface SerializedLayoutV2 {
  v: 2
  d: [number, number, number]
  o: SerializedObject[]
  fc: Array<[number, number, number]>  // [x, z, height]
  st: SerializedStair[]
  ov: SerializedOverride[]
}

type SerializedLayout = SerializedLayoutV1 | SerializedLayoutV2

/**
 * World data for v2 serialization.
 */
export interface WorldData {
  floorCells: Map<string, number>
  stairs: Map<string, StairSegment>
  overrides: Map<string, EdgeClassification>
}

/**
 * Serialize a layout to v1 format (backwards compatible).
 */
export function serializeLayout(layout: RestaurantLayout): SerializedLayoutV1 {
  return {
    v: 1,
    d: [layout.dimensions.width, layout.dimensions.height, layout.dimensions.depth],
    o: layout.objects.map((obj) => serializeObject(obj)),
  }
}

/**
 * Serialize a layout with world data to v2 format.
 */
export function serializeLayoutV2(
  layout: RestaurantLayout,
  worldData: WorldData
): SerializedLayoutV2 {
  const fc: Array<[number, number, number]> = []
  for (const [key, height] of worldData.floorCells) {
    const [x, z] = key.split(',').map(Number)
    fc.push([x, z, height])
  }

  const st: SerializedStair[] = []
  for (const stair of worldData.stairs.values()) {
    st.push({ x: stair.x, z: stair.z, l: stair.level, s: stair.side })
  }

  const ov: SerializedOverride[] = []
  for (const [key, classification] of worldData.overrides) {
    ov.push({ k: key, c: classification })
  }

  return {
    v: 2,
    d: [layout.dimensions.width, layout.dimensions.height, layout.dimensions.depth],
    o: layout.objects.map((obj) => serializeObject(obj)),
    fc,
    st,
    ov,
  }
}

function serializeModelConfig(config: ModelConfig): SerializedModelConfig {
  return {
    u: config.modelUrl,
    sc: config.scale,
    an: config.animations?.map((a) => ({
      n: a.name,
      ap: a.autoPlay,
      l: a.loop,
      sp: a.speed,
    })),
    aa: config.activeAnimation,
  }
}

function serializeObject(obj: VoxelObject): SerializedObject {
  const serialized: SerializedObject = {
    i: obj.id,
    t: obj.type,
    p: [obj.position.x, obj.position.y, obj.position.z],
    r: obj.rotation.y,
  }

  if (obj.type === 'table') {
    const tableObj = obj as VoxelTable
    serialized.l = tableObj.linkedTableId
    serialized.s = tableObj.status
    serialized.n = tableObj.tableNumber
    serialized.c = tableObj.capacity
  }

  if (obj.type === 'model') {
    const modelObj = obj as VoxelModelObject
    serialized.mc = serializeModelConfig(modelObj.modelConfig)
  }

  if (obj.metadata) {
    serialized.m = obj.metadata
  }

  return serialized
}

export function deserializeLayout(
  data: SerializedLayout,
  layoutMeta: { id: string; tenantId: string; name: string; createdAt: string; updatedAt: string }
): RestaurantLayout {
  const dimensions: WorldDimensions = data.d
    ? { width: data.d[0], height: data.d[1], depth: data.d[2] }
    : DEFAULT_WORLD_DIMENSIONS

  return {
    id: layoutMeta.id,
    tenantId: layoutMeta.tenantId,
    name: layoutMeta.name,
    dimensions,
    objects: data.o?.map((obj) => deserializeObject(obj)) ?? [],
    createdAt: layoutMeta.createdAt,
    updatedAt: layoutMeta.updatedAt,
  }
}

/**
 * Deserialize world data from v2 format.
 * Returns empty world data for v1 layouts (backwards compatible).
 */
export function deserializeWorldData(data: SerializedLayout): WorldData {
  if (data.v < 2 || !('fc' in data)) {
    return {
      floorCells: new Map(),
      stairs: new Map(),
      overrides: new Map(),
    }
  }

  const v2 = data as SerializedLayoutV2

  const floorCells = new Map<string, number>()
  for (const [x, z, height] of v2.fc) {
    floorCells.set(`${x},${z}`, height)
  }

  const stairs = new Map<string, StairSegment>()
  for (const st of v2.st) {
    const key = `${st.x},${st.z},${st.l},${st.s}`
    stairs.set(key, {
      id: key,
      x: st.x,
      z: st.z,
      level: st.l,
      side: st.s as StairSegment['side'],
      steps: 4,
    })
  }

  const overrides = new Map<string, EdgeClassification>()
  for (const ov of v2.ov) {
    overrides.set(ov.k, ov.c)
  }

  return { floorCells, stairs, overrides }
}

function deserializeModelConfig(config: SerializedModelConfig): ModelConfig {
  return {
    modelUrl: config.u,
    scale: config.sc,
    animations: config.an?.map((a) => ({
      name: a.n,
      autoPlay: a.ap,
      loop: a.l,
      speed: a.sp,
    })),
    activeAnimation: config.aa,
  }
}

function deserializeObject(obj: SerializedObject): VoxelObject {
  const base: VoxelObject = {
    id: obj.i,
    type: obj.t as VoxelObject['type'],
    position: { x: obj.p[0], y: obj.p[1], z: obj.p[2] },
    rotation: { y: obj.r },
    metadata: obj.m,
  }

  if (obj.t === 'table' && obj.l !== undefined) {
    return {
      ...base,
      type: 'table',
      linkedTableId: obj.l,
      status: (obj.s ?? 'AVAILABLE') as VoxelTable['status'],
      tableNumber: obj.n ?? '',
      capacity: obj.c ?? 4,
    } as VoxelTable
  }

  if (obj.t === 'model' && obj.mc) {
    return {
      ...base,
      type: 'model',
      modelConfig: deserializeModelConfig(obj.mc),
    } as VoxelModelObject
  }

  return base
}

export function compressWorldData(data: SerializedLayout): string {
  return btoa(JSON.stringify(data))
}

export function decompressWorldData(compressed: string): SerializedLayout {
  return JSON.parse(atob(compressed))
}

export function calculateLayoutChecksum(layout: RestaurantLayout): string {
  const data = JSON.stringify({
    objects: layout.objects.map((o) => ({
      id: o.id,
      type: o.type,
      position: o.position,
      rotation: o.rotation,
    })),
  })

  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}
