import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export type HeatmapColorScheme = 'viridis' | 'plasma' | 'coolwarm' | 'heat' | 'blues';

export interface HeatmapOverlayProps {
  width: number;
  depth: number;
  data: number[][];
  colorScheme?: HeatmapColorScheme;
  opacity?: number;
  animated?: boolean;
  visible?: boolean;
  cellSize?: number;
}

// Color schemes for different visualization needs
const COLOR_SCHEMES: Record<HeatmapColorScheme, string[]> = {
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26838f', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  coolwarm: ['#3b4cc0', '#5977e3', '#7b9ff9', '#9ebeff', '#c0d4f5', '#f2cbb7', '#f7ac8e', '#ee8468', '#d65244', '#b40426'],
  heat: ['#000000', '#1a0000', '#4d0000', '#800000', '#b30000', '#e60000', '#ff1a1a', '#ff6666', '#ffb3b3', '#ffffff'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b', '#041f4d'],
};

// Interpolate between colors based on value (0-1)
function interpolateColor(value: number, colors: string[]): [number, number, number] {
  const clampedValue = Math.max(0, Math.min(1, value));
  const scaledValue = clampedValue * (colors.length - 1);
  const lowerIndex = Math.floor(scaledValue);
  const upperIndex = Math.min(lowerIndex + 1, colors.length - 1);
  const t = scaledValue - lowerIndex;

  const lowerColor = hexToRgb(colors[lowerIndex]);
  const upperColor = hexToRgb(colors[upperIndex]);

  return [
    Math.round(lowerColor[0] + (upperColor[0] - lowerColor[0]) * t),
    Math.round(lowerColor[1] + (upperColor[1] - lowerColor[1]) * t),
    Math.round(lowerColor[2] + (upperColor[2] - lowerColor[2]) * t),
  ];
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
}

// Gaussian blur for smoothing heatmap
function gaussianBlur(data: number[][], radius: number = 1): number[][] {
  const rows = data.length;
  const cols = data[0]?.length || 0;
  if (rows === 0 || cols === 0) return data;

  const result: number[][] = Array(rows)
    .fill(null)
    .map(() => Array(cols).fill(0));

  const kernel: number[][] = [];
  const sigma = radius / 2;
  let sum = 0;

  for (let y = -radius; y <= radius; y++) {
    const row: number[] = [];
    for (let x = -radius; x <= radius; x++) {
      const value = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      row.push(value);
      sum += value;
    }
    kernel.push(row);
  }

  // Normalize kernel
  for (let y = 0; y < kernel.length; y++) {
    for (let x = 0; x < kernel[y].length; x++) {
      kernel[y][x] /= sum;
    }
  }

  // Apply convolution
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let value = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const ny = Math.min(Math.max(y + ky, 0), rows - 1);
          const nx = Math.min(Math.max(x + kx, 0), cols - 1);
          value += data[ny][nx] * kernel[ky + radius][kx + radius];
        }
      }
      result[y][x] = value;
    }
  }

  return result;
}

export function HeatmapOverlay({
  width,
  depth,
  data,
  colorScheme = 'heat',
  opacity = 0.6,
  animated = false,
  visible = true,
  cellSize = 1,
}: HeatmapOverlayProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  // Create canvas texture from heatmap data
  const texture = useMemo(() => {
    if (!data || data.length === 0) return null;

    const colors = COLOR_SCHEMES[colorScheme];
    const gridWidth = data.length;
    const gridHeight = data[0]?.length || 0;

    // Higher resolution for smoother appearance
    const textureSize = Math.max(256, Math.min(1024, Math.max(gridWidth, gridHeight) * 8));
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d')!;

    // Apply gaussian blur for smoother visualization
    const smoothedData = gaussianBlur(data, 2);

    // Draw heatmap
    for (let y = 0; y < textureSize; y++) {
      for (let x = 0; x < textureSize; x++) {
        // Bilinear interpolation for smooth texture
        const fx = (x / textureSize) * (gridWidth - 1);
        const fy = (y / textureSize) * (gridHeight - 1);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(x0 + 1, gridWidth - 1);
        const y1 = Math.min(y0 + 1, gridHeight - 1);
        const tx = fx - x0;
        const ty = fy - y0;

        const v00 = smoothedData[x0]?.[y0] ?? 0;
        const v10 = smoothedData[x1]?.[y0] ?? 0;
        const v01 = smoothedData[x0]?.[y1] ?? 0;
        const v11 = smoothedData[x1]?.[y1] ?? 0;

        const value = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;

        const [r, g, b] = interpolateColor(value, colors);
        const alpha = value > 0.01 ? Math.max(0.1, value) : 0;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;

    return tex;
  }, [data, colorScheme]);

  // Animation for pulsing effect
  useFrame((state) => {
    if (animated && materialRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.1 + 0.9;
      materialRef.current.opacity = opacity * pulse;
    }
  });

  if (!visible || !texture || !data || data.length === 0) {
    return null;
  }

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[width / 2, 0.01, depth / 2]} // Slightly above floor to prevent z-fighting
      receiveShadow
    >
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial
        ref={materialRef}
        map={texture}
        transparent={true}
        opacity={opacity}
        roughness={0.8}
        metalness={0}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// Helper function to create heatmap data from point data
export function createHeatmapFromPoints(
  points: Array<{ x: number; z: number; value: number }>,
  gridWidth: number,
  gridHeight: number,
  worldWidth: number,
  worldDepth: number,
  radius: number = 2
): number[][] {
  const grid: number[][] = Array(gridWidth)
    .fill(null)
    .map(() => Array(gridHeight).fill(0));

  points.forEach((point) => {
    const gridX = Math.floor((point.x / worldWidth) * gridWidth);
    const gridZ = Math.floor((point.z / worldDepth) * gridHeight);

    // Add value with radial falloff
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const nx = gridX + dx;
        const nz = gridZ + dz;
        if (nx >= 0 && nx < gridWidth && nz >= 0 && nz < gridHeight) {
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance <= radius) {
            const falloff = 1 - distance / radius;
            grid[nx][nz] += point.value * falloff;
          }
        }
      }
    }
  });

  // Normalize to 0-1
  const maxValue = Math.max(...grid.flat(), 0.001);
  return grid.map((row) => row.map((v) => v / maxValue));
}

// Helper function to create heatmap from occupancy data
export function createOccupancyHeatmap(
  occupancyData: Array<{ positionX: number; positionZ: number }>,
  gridWidth: number,
  gridHeight: number,
  worldWidth: number,
  worldDepth: number
): number[][] {
  const points = occupancyData.map((record) => ({
    x: record.positionX,
    z: record.positionZ,
    value: 1,
  }));

  return createHeatmapFromPoints(points, gridWidth, gridHeight, worldWidth, worldDepth, 3);
}

export default HeatmapOverlay;
