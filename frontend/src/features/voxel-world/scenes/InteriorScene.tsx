import { useCallback } from 'react'
import { VoxelWorld } from '../components/VoxelWorld'
import { Mascot3D } from '../components/mascot/Mascot3D'
import { SpeechBubble3D } from '../components/mascot/SpeechBubble3D'
import { useMascotDialogue } from '../hooks/useMascotDialogue'
import { useVoxelStore } from '../store/voxelStore'
import { DEFAULT_WORLD_DIMENSIONS } from '../types/voxel'

export function InteriorScene() {
  const layout = useVoxelStore((state) => state.layout)
  const mascotAnimation = useVoxelStore((state) => state.mascotAnimation)
  const setMascotAnimation = useVoxelStore((state) => state.setMascotAnimation)

  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS

  const {
    currentText,
    isVisible,
    showNext,
  } = useMascotDialogue({ phase: 'interior' })

  const handleMascotClick = useCallback(() => {
    // Trigger bounce animation
    setMascotAnimation('bounce')

    // Show random tip
    showNext()

    // Reset to idle after bounce
    setTimeout(() => {
      setMascotAnimation('idle')
    }, 500)
  }, [showNext, setMascotAnimation])

  // Position mascot in the bottom-left corner of the floor plan
  const mascotPosition: [number, number, number] = [
    2,
    0,
    dimensions.depth - 2,
  ]

  // Speech bubble position above mascot
  const bubblePosition: [number, number, number] = [
    mascotPosition[0],
    mascotPosition[1] + 3,
    mascotPosition[2],
  ]

  return (
    <>
      {/* The existing VoxelWorld with isometric view */}
      <VoxelWorld isometric={true} />

      {/* Mascot in the corner */}
      <Mascot3D
        position={mascotPosition}
        rotation={[0, Math.PI / 4, 0]} // Face towards center
        scale={0.8}
        animation={mascotAnimation}
        isClickable={true}
        onClick={handleMascotClick}
      />

      {/* Speech bubble */}
      <SpeechBubble3D
        text={currentText}
        visible={isVisible}
        position={bubblePosition}
      />
    </>
  )
}
