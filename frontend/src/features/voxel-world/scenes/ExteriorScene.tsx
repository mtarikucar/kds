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
        target={[0, 3, 0]}
        distance={40}
        enablePan={true}
        enableZoom={true}
      />

      {/* Lighting - soft and bright for white background */}
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[30, 50, 30]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={150}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <directionalLight
        position={[-20, 30, -20]}
        intensity={0.4}
      />
      {/* Fill light from front */}
      <directionalLight
        position={[0, 20, 40]}
        intensity={0.3}
      />

      {/* Pure white background */}
      <color attach="background" args={['#ffffff']} />

      {/* Ground - light gray */}
      <Ground size={100} />

      {/* Building - auto-positioned on ground */}
      <Building3D
        position={[0, 0, 0]}
        scale={8}
        isClickable={true}
        onClick={handleBuildingClick}
      />

      {/* Mascot - in the garden area */}
      <Mascot3D
        position={[6, 0, 8]}
        rotation={[0, -Math.PI / 4, 0]}
        scale={1}
        animation={mascotAnimation}
        isClickable={true}
        onClick={handleMascotClick}
      />

      {/* Speech bubble - positioned above mascot */}
      <SpeechBubble3D
        text={currentText}
        visible={isVisible}
        position={[6, 4, 8]}
      />
    </>
  )
}
