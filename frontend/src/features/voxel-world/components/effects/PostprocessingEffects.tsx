import { useRef, useEffect, Fragment } from 'react'
import { EffectComposer, Bloom, Vignette, ToneMapping, BrightnessContrast, HueSaturation, Outline } from '@react-three/postprocessing'
import { ToneMappingMode, BlendFunction } from 'postprocessing'
import type { Object3D } from 'three'

interface PostprocessingEffectsProps {
  bloomIntensity?: number
  vignetteOffset?: number
  vignetteDarkness?: number
  isExterior?: boolean
  /** Selected objects for outline effect */
  selectedObjects?: Object3D[]
  /** Enable stylized (TinyGlade) rendering mode */
  stylizedMode?: boolean
}

export function PostprocessingEffects({
  bloomIntensity = 0.4,
  vignetteOffset = 0.3,
  vignetteDarkness = 0.3,
  isExterior = false,
  selectedObjects = [],
  stylizedMode = false,
}: PostprocessingEffectsProps) {
  // Stylized mode has different settings for TinyGlade-like appearance
  const effectiveBloom = stylizedMode ? 0.15 : (isExterior ? 0.5 : bloomIntensity)
  const effectiveSaturation = stylizedMode ? 0.15 : (isExterior ? 0.15 : 0.05)
  const effectiveContrast = stylizedMode ? 0.1 : (isExterior ? 0.1 : 0.08)

  return (
    <EffectComposer>
      <>
        {selectedObjects.length > 0 && (
          <Outline
            selection={selectedObjects}
            edgeStrength={stylizedMode ? 3 : 2.5}
            pulseSpeed={0}
            visibleEdgeColor={0x000000}
            hiddenEdgeColor={0x333333}
            blur
            xRay={false}
            blendFunction={BlendFunction.ALPHA}
          />
        )}

        <Bloom
          intensity={effectiveBloom}
          luminanceThreshold={0.85}
          luminanceSmoothing={0.03}
          mipmapBlur
        />

        <BrightnessContrast
          brightness={isExterior ? 0.05 : 0.02}
          contrast={effectiveContrast}
        />

        <HueSaturation
          saturation={effectiveSaturation}
        />

        <Vignette
          offset={vignetteOffset}
          darkness={isExterior ? 0.2 : 0.25}
          eskil={false}
        />

        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </>
    </EffectComposer>
  )
}
