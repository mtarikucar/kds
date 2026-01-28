import { useRef, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { VoxelModelObject } from '../../types/voxel'

interface InstancedModelsProps {
  objects: VoxelModelObject[]
  modelUrl: string
}

interface InstanceData {
  id: string
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: THREE.Vector3
}

export function InstancedModels({ objects, modelUrl }: InstancedModelsProps) {
  const { scene } = useGLTF(modelUrl)
  const instancedMeshRefs = useRef<Map<string, THREE.InstancedMesh>>(new Map())
  const tempObject = useMemo(() => new THREE.Object3D(), [])

  const instances: InstanceData[] = useMemo(
    () =>
      objects.map((obj) => ({
        id: obj.id,
        position: new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z),
        rotation: new THREE.Euler(0, (obj.rotation.y * Math.PI) / 180, 0),
        scale: new THREE.Vector3(
          obj.modelConfig.scale ?? 1,
          obj.modelConfig.scale ?? 1,
          obj.modelConfig.scale ?? 1
        ),
      })),
    [objects]
  )

  const meshData = useMemo(() => {
    const data: Array<{
      geometry: THREE.BufferGeometry
      material: THREE.Material | THREE.Material[]
      name: string
    }> = []

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        data.push({
          geometry: child.geometry,
          material: child.material,
          name: child.name || child.uuid,
        })
      }
    })

    return data
  }, [scene])

  useEffect(() => {
    meshData.forEach((mesh) => {
      const instancedMesh = instancedMeshRefs.current.get(mesh.name)
      if (!instancedMesh) return

      instances.forEach((instance, index) => {
        tempObject.position.copy(instance.position)
        tempObject.rotation.copy(instance.rotation)
        tempObject.scale.copy(instance.scale)
        tempObject.updateMatrix()

        instancedMesh.setMatrixAt(index, tempObject.matrix)
      })

      instancedMesh.instanceMatrix.needsUpdate = true
    })
  }, [instances, meshData, tempObject])

  if (instances.length === 0) return null

  return (
    <group>
      {meshData.map((mesh) => (
        <instancedMesh
          key={mesh.name}
          ref={(ref) => {
            if (ref) {
              instancedMeshRefs.current.set(mesh.name, ref)
            }
          }}
          args={[mesh.geometry, undefined, instances.length]}
          castShadow
          receiveShadow
        >
          {Array.isArray(mesh.material) ? (
            mesh.material.map((mat, i) => (
              <primitive key={i} object={mat} attach={`material-${i}`} />
            ))
          ) : (
            <primitive object={mesh.material} attach="material" />
          )}
        </instancedMesh>
      ))}
    </group>
  )
}

interface GroupedInstancedModelsProps {
  objects: VoxelModelObject[]
}

export function GroupedInstancedModels({ objects }: GroupedInstancedModelsProps) {
  const groupedByModel = useMemo(() => {
    const groups = new Map<string, VoxelModelObject[]>()

    objects.forEach((obj) => {
      const url = obj.modelConfig.modelUrl
      const existing = groups.get(url) || []
      groups.set(url, [...existing, obj])
    })

    return groups
  }, [objects])

  const instanceableGroups = useMemo(() => {
    const result: Array<{ url: string; objects: VoxelModelObject[] }> = []

    groupedByModel.forEach((objs, url) => {
      const hasAnimations = objs.some(
        (obj) => obj.modelConfig.animations && obj.modelConfig.animations.length > 0
      )

      if (!hasAnimations && objs.length >= 3) {
        result.push({ url, objects: objs })
      }
    })

    return result
  }, [groupedByModel])

  return (
    <>
      {instanceableGroups.map(({ url, objects: objs }) => (
        <InstancedModels key={url} modelUrl={url} objects={objs} />
      ))}
    </>
  )
}

export function shouldUseInstancing(objects: VoxelModelObject[]): boolean {
  const groupedByModel = new Map<string, number>()

  objects.forEach((obj) => {
    const url = obj.modelConfig.modelUrl
    const count = groupedByModel.get(url) || 0
    groupedByModel.set(url, count + 1)
  })

  let instanceableCount = 0
  groupedByModel.forEach((count) => {
    if (count >= 3) {
      instanceableCount += count
    }
  })

  return instanceableCount / objects.length > 0.3
}
