import { EffectComposer, Bloom, Vignette, ToneMapping, BrightnessContrast, HueSaturation } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

interface PostprocessingEffectsProps {
  bloomIntensity?: number
  vignetteOffset?: number
  vignetteDarkness?: number
  isExterior?: boolean
}

export function PostprocessingEffects({
  bloomIntensity = 0.4,
  vignetteOffset = 0.3,
  vignetteDarkness = 0.3,
  isExterior = false,
}: PostprocessingEffectsProps) {
  return (
    <EffectComposer>
      {/* Bloom - soft glow effect */}
      <Bloom
        intensity={isExterior ? 0.5 : bloomIntensity}
        luminanceThreshold={0.8}
        luminanceSmoothing={0.05}
        mipmapBlur
      />

      {/* Brightness/Contrast - make it pop */}
      <BrightnessContrast
        brightness={isExterior ? 0.05 : 0}
        contrast={isExterior ? 0.1 : 0.05}
      />

      {/* Saturation boost for vibrant colors */}
      <HueSaturation
        saturation={isExterior ? 0.15 : 0.1}
      />

      {/* Subtle vignette for focus */}
      <Vignette
        offset={vignetteOffset}
        darkness={isExterior ? 0.2 : vignetteDarkness}
        eskil={false}
      />

      {/* Tone mapping - natural color balance */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
