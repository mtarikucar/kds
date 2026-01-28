import * as THREE from 'three'

interface VoxelData {
  position: { x: number; y: number; z: number }
  color: string
  visible: boolean
}

interface MergedGeometry {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export function createInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  positions: THREE.Vector3[],
  colors?: THREE.Color[]
): THREE.InstancedMesh {
  const count = positions.length
  const mesh = new THREE.InstancedMesh(geometry, material, count)

  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()

  for (let i = 0; i < count; i++) {
    matrix.setPosition(positions[i])
    mesh.setMatrixAt(i, matrix)

    if (colors && colors[i]) {
      mesh.setColorAt(i, colors[i])
    }
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true
  }

  return mesh
}

export function mergeGeometries(
  geometries: THREE.BufferGeometry[],
  transforms: THREE.Matrix4[]
): THREE.BufferGeometry {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry()
  }

  const mergedPositions: number[] = []
  const mergedNormals: number[] = []
  const mergedUvs: number[] = []
  const mergedIndices: number[] = []

  let indexOffset = 0

  for (let i = 0; i < geometries.length; i++) {
    const geom = geometries[i].clone()
    geom.applyMatrix4(transforms[i])

    const positions = geom.getAttribute('position')
    const normals = geom.getAttribute('normal')
    const uvs = geom.getAttribute('uv')
    const indices = geom.getIndex()

    for (let j = 0; j < positions.count; j++) {
      mergedPositions.push(positions.getX(j), positions.getY(j), positions.getZ(j))
    }

    if (normals) {
      for (let j = 0; j < normals.count; j++) {
        mergedNormals.push(normals.getX(j), normals.getY(j), normals.getZ(j))
      }
    }

    if (uvs) {
      for (let j = 0; j < uvs.count; j++) {
        mergedUvs.push(uvs.getX(j), uvs.getY(j))
      }
    }

    if (indices) {
      for (let j = 0; j < indices.count; j++) {
        mergedIndices.push(indices.getX(j) + indexOffset)
      }
    }

    indexOffset += positions.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(mergedPositions, 3)
  )

  if (mergedNormals.length > 0) {
    merged.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(mergedNormals, 3)
    )
  }

  if (mergedUvs.length > 0) {
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(mergedUvs, 2))
  }

  if (mergedIndices.length > 0) {
    merged.setIndex(mergedIndices)
  }

  return merged
}

export function disposeGeometry(geometry: THREE.BufferGeometry): void {
  geometry.dispose()
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material]
  materials.forEach((mat) => {
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.map?.dispose()
      mat.normalMap?.dispose()
      mat.roughnessMap?.dispose()
      mat.metalnessMap?.dispose()
      mat.emissiveMap?.dispose()
      mat.aoMap?.dispose()
    }
    mat.dispose()
  })
}

export function disposeMesh(mesh: THREE.Mesh | THREE.InstancedMesh): void {
  if (mesh.geometry) {
    disposeGeometry(mesh.geometry)
  }
  if (mesh.material) {
    disposeMaterial(mesh.material)
  }
}

export function calculateBoundingBox(
  objects: { position: { x: number; y: number; z: number } }[]
): THREE.Box3 {
  const box = new THREE.Box3()

  objects.forEach((obj) => {
    box.expandByPoint(new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z))
  })

  return box
}

export function frustumCull(
  camera: THREE.Camera,
  objects: THREE.Object3D[]
): THREE.Object3D[] {
  const frustum = new THREE.Frustum()
  const projScreenMatrix = new THREE.Matrix4()

  projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  )
  frustum.setFromProjectionMatrix(projScreenMatrix)

  return objects.filter((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.computeBoundingSphere()
      if (obj.geometry.boundingSphere) {
        const sphere = obj.geometry.boundingSphere.clone()
        sphere.applyMatrix4(obj.matrixWorld)
        return frustum.intersectsSphere(sphere)
      }
    }
    return true
  })
}

export function createLODForObject(
  highDetail: THREE.BufferGeometry,
  mediumDetail: THREE.BufferGeometry,
  lowDetail: THREE.BufferGeometry,
  material: THREE.Material
): THREE.LOD {
  const lod = new THREE.LOD()

  const highMesh = new THREE.Mesh(highDetail, material)
  const mediumMesh = new THREE.Mesh(mediumDetail, material)
  const lowMesh = new THREE.Mesh(lowDetail, material)

  lod.addLevel(highMesh, 0)
  lod.addLevel(mediumMesh, 15)
  lod.addLevel(lowMesh, 30)

  return lod
}
