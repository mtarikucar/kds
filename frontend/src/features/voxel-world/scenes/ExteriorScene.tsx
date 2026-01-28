import { useCallback } from 'react'
import { IsometricCamera } from '../components/camera/IsometricCamera'
import { Building3D } from '../components/building/Building3D'
import { Ground } from '../components/building/Ground'
import { Mascot3D } from '../components/mascot/Mascot3D'
import { SpeechBubble3D } from '../components/mascot/SpeechBubble3D'
import { useMascotDialogue } from '../hooks/useMascotDialogue'
import { useVoxelStore } from '../store/voxelStore'

interface ExteriorSceneProps {
  onEnterBuilding: () => void
}

export function ExteriorScene({ onEnterBuilding }: ExteriorSceneProps) {
  const mascotAnimation = useVoxelStore((state) => state.mascotAnimation)
  const setMascotAnimation = useVoxelStore((state) => state.setMascotAnimation)

  const {
    currentText,
    isVisible,
    showNext,
  } = useMascotDialogue({ phase: 'exterior' })

  const handleMascotClick = useCallback(() => {
    // Trigger bounce animation
    setMascotAnimation('bounce')

    // Show dialogue
    showNext()

    // Reset to idle after bounce
    setTimeout(() => {
      setMascotAnimation('idle')
    }, 500)
  }, [showNext, setMascotAnimation])

  const handleBuildingClick = useCallback(() => {
    onEnterBuilding()
  }, [onEnterBuilding])

  return (
    <>
      {/* Camera - fixed isometric angle */}
      <IsometricCamera
        target={[0, 2, 0]}
        distance={35}
        enablePan={true}
        enableZoom={true}
      />

      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[20, 30, 20]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={100}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight
        position={[-10, 15, -10]}
        intensity={0.3}
      />

      {/* Sky / Background */}
      <color attach="background" args={['#1a1a2e']} />
      <fog attach="fog" args={['#1a1a2e', 40, 120]} />

      {/* Ground */}
      <Ground size={60} />

      {/* Building */}
      <Building3D
        position={[0, 0, 0]}
        scale={2}
        isClickable={true}
        onClick={handleBuildingClick}
      />

      {/* Mascot - positioned in front of the building */}
      <Mascot3D
        position={[5, 0, 10]}
        rotation={[0, -Math.PI / 4, 0]} // Face towards camera
        scale={1.5}
        animation={mascotAnimation}
        isClickable={true}
        onClick={handleMascotClick}
      />

      {/* Speech bubble - positioned above mascot */}
      <SpeechBubble3D
        text={currentText}
        visible={isVisible}
        position={[5, 4, 10]}
      />

      {/* Decorative lights */}
      <pointLight
        position={[0, 5, 8]}
        color="#fff5e6"
        intensity={0.5}
        distance={15}
      />
      <pointLight
        position={[-5, 3, 0]}
        color="#ffd6a5"
        intensity={0.3}
        distance={10}
      />
      <pointLight
        position={[5, 3, 0]}
        color="#ffd6a5"
        intensity={0.3}
        distance={10}
      />
    </>
  )
}
