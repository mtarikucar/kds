import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, ShaderMaterial, Vector3 } from 'three'

// Inline shaders for better bundling
const vertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelMatrix * vec4(position, 1.0)).xyz;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  vUv = uv;

  gl_Position = projectionMatrix * mvPosition;
}
`

const fragmentShader = `
uniform vec3 baseColor;
uniform vec3 shadowColor;
uniform vec3 highlightColor;
uniform vec3 ambientColor;
uniform vec3 lightDirection;
uniform float ambientOcclusionStrength;
uniform float shadowSoftness;
uniform float rimStrength;
uniform float saturationBoost;
uniform float time;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;
varying vec2 vUv;

float softStep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float calculateAO(vec3 position) {
  float heightAO = softStep(0.0, 0.5, position.y);
  return mix(1.0 - ambientOcclusionStrength, 1.0, heightAO);
}

vec3 adjustSaturation(vec3 color, float saturation) {
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(gray), color, saturation);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(lightDirection);
  vec3 viewDir = normalize(vViewPosition);

  float NdotL = dot(normal, lightDir);
  float diffuse = softStep(-shadowSoftness, shadowSoftness, NdotL);

  vec3 litColor = mix(shadowColor, baseColor, diffuse);

  float highlight = softStep(0.7, 0.9, NdotL);
  litColor = mix(litColor, highlightColor, highlight * 0.3);

  float ao = calculateAO(vPosition);
  litColor *= ao;

  litColor += ambientColor * 0.3;

  float rim = 1.0 - max(0.0, dot(normal, viewDir));
  rim = pow(rim, 3.0) * rimStrength;
  litColor += vec3(1.0) * rim * 0.2;

  litColor = adjustSaturation(litColor, 1.0 + saturationBoost);

  vec3 warmTint = vec3(1.0, 0.98, 0.95);
  litColor *= warmTint;

  gl_FragColor = vec4(litColor, 1.0);
}
`

// Stylized color palette
export const STYLIZED_PALETTE = {
  wood: {
    light: '#C4A77D',
    dark: '#8B6914',
    shadow: '#5C4710',
    highlight: '#E8D4B0',
  },
  metal: {
    light: '#9CA3AF',
    dark: '#4B5563',
    shadow: '#374151',
    highlight: '#D1D5DB',
  },
  fabric: {
    red: { base: '#DC2626', shadow: '#991B1B', highlight: '#F87171' },
    blue: { base: '#2563EB', shadow: '#1D4ED8', highlight: '#60A5FA' },
    green: { base: '#16A34A', shadow: '#15803D', highlight: '#4ADE80' },
    cream: { base: '#FEF3C7', shadow: '#FDE68A', highlight: '#FFFBEB' },
  },
  plant: {
    base: '#22C55E',
    shadow: '#16A34A',
    highlight: '#4ADE80',
  },
  floor: {
    base: '#D4A574',
    shadow: '#B8956A',
    highlight: '#E8C9A0',
  },
  wall: {
    base: '#F5F5DC',
    shadow: '#E5E5C0',
    highlight: '#FAFAF0',
  },
  ambient: '#FEF3C7',
} as const

export interface StylizedMaterialProps {
  baseColor?: string | Color
  shadowColor?: string | Color
  highlightColor?: string | Color
  ambientColor?: string | Color
  lightDirection?: [number, number, number]
  ambientOcclusionStrength?: number
  shadowSoftness?: number
  rimStrength?: number
  saturationBoost?: number
  animated?: boolean
}

export function StylizedMaterial({
  baseColor = STYLIZED_PALETTE.wood.light,
  shadowColor,
  highlightColor,
  ambientColor = STYLIZED_PALETTE.ambient,
  lightDirection = [1, 1, 0.5],
  ambientOcclusionStrength = 0.3,
  shadowSoftness = 0.1,
  rimStrength = 0.5,
  saturationBoost = 0.1,
  animated = false,
}: StylizedMaterialProps) {
  const materialRef = useRef<ShaderMaterial>(null)

  const uniforms = useMemo(() => {
    const base = new Color(baseColor)
    // Auto-generate shadow and highlight colors if not provided
    const shadow = shadowColor
      ? new Color(shadowColor)
      : new Color(baseColor).multiplyScalar(0.6)
    const highlight = highlightColor
      ? new Color(highlightColor)
      : new Color(baseColor).lerp(new Color('#FFFFFF'), 0.3)

    return {
      baseColor: { value: base },
      shadowColor: { value: shadow },
      highlightColor: { value: highlight },
      ambientColor: { value: new Color(ambientColor) },
      lightDirection: { value: new Vector3(...lightDirection).normalize() },
      ambientOcclusionStrength: { value: ambientOcclusionStrength },
      shadowSoftness: { value: shadowSoftness },
      rimStrength: { value: rimStrength },
      saturationBoost: { value: saturationBoost },
      time: { value: 0 },
    }
  }, [
    baseColor,
    shadowColor,
    highlightColor,
    ambientColor,
    lightDirection,
    ambientOcclusionStrength,
    shadowSoftness,
    rimStrength,
    saturationBoost,
  ])

  // Animate time uniform if needed
  useFrame((_, delta) => {
    if (animated && materialRef.current) {
      materialRef.current.uniforms.time.value += delta
    }
  })

  return (
    <shaderMaterial
      ref={materialRef}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
    />
  )
}

// Preset materials for common objects
export function WoodMaterial(props: Omit<StylizedMaterialProps, 'baseColor' | 'shadowColor' | 'highlightColor'>) {
  return (
    <StylizedMaterial
      baseColor={STYLIZED_PALETTE.wood.light}
      shadowColor={STYLIZED_PALETTE.wood.shadow}
      highlightColor={STYLIZED_PALETTE.wood.highlight}
      {...props}
    />
  )
}

export function DarkWoodMaterial(props: Omit<StylizedMaterialProps, 'baseColor' | 'shadowColor' | 'highlightColor'>) {
  return (
    <StylizedMaterial
      baseColor={STYLIZED_PALETTE.wood.dark}
      shadowColor={STYLIZED_PALETTE.wood.shadow}
      highlightColor={STYLIZED_PALETTE.wood.light}
      {...props}
    />
  )
}

export function MetalMaterial(props: Omit<StylizedMaterialProps, 'baseColor' | 'shadowColor' | 'highlightColor'>) {
  return (
    <StylizedMaterial
      baseColor={STYLIZED_PALETTE.metal.light}
      shadowColor={STYLIZED_PALETTE.metal.shadow}
      highlightColor={STYLIZED_PALETTE.metal.highlight}
      rimStrength={0.8}
      {...props}
    />
  )
}

export function PlantMaterial(props: Omit<StylizedMaterialProps, 'baseColor' | 'shadowColor' | 'highlightColor'>) {
  return (
    <StylizedMaterial
      baseColor={STYLIZED_PALETTE.plant.base}
      shadowColor={STYLIZED_PALETTE.plant.shadow}
      highlightColor={STYLIZED_PALETTE.plant.highlight}
      saturationBoost={0.2}
      {...props}
    />
  )
}

export function FabricMaterial({
  color = 'cream',
  ...props
}: Omit<StylizedMaterialProps, 'baseColor' | 'shadowColor' | 'highlightColor'> & {
  color?: 'red' | 'blue' | 'green' | 'cream'
}) {
  const palette = STYLIZED_PALETTE.fabric[color]
  return (
    <StylizedMaterial
      baseColor={palette.base}
      shadowColor={palette.shadow}
      highlightColor={palette.highlight}
      {...props}
    />
  )
}
