import type { VoxelObject, RestaurantLayout, WorldDimensions, VoxelTable, VoxelModelObject, ModelConfig } from '../types/voxel'
import { DEFAULT_WORLD_DIMENSIONS } from '../types/voxel'

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

interface SerializedLayout {
  v: number      // version
  d: [number, number, number]  // dimensions [width, height, depth]
  o: SerializedObject[]        // objects
}

export function serializeLayout(layout: RestaurantLayout): SerializedLayout {
  return {
    v: 1,
    d: [layout.dimensions.width, layout.dimensions.height, layout.dimensions.depth],
    o: layout.objects.map((obj) => serializeObject(obj)),
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
