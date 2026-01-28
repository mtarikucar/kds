import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

interface PostprocessingEffectsProps {
  bloomIntensity?: number
  vignetteOffset?: number
  vignetteDarkness?: number
}

export function PostprocessingEffects({
  bloomIntensity = 0.3,
  vignetteOffset = 0.1,
  vignetteDarkness = 0.4,
}: PostprocessingEffectsProps) {
  return (
    <EffectComposer>
      {/* Bloom - subtle glow effect for lights and bright areas */}
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={0.9}
        luminanceSmoothing={0.025}
        mipmapBlur
      />

      {/* Vignette - darkens the corners for a more cinematic look */}
      <Vignette
        offset={vignetteOffset}
        darkness={vignetteDarkness}
        eskil={false}
      />

      {/* Tone mapping - improves overall color balance */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
