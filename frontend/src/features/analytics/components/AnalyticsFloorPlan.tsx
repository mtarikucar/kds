import { useState, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { HeatmapOverlay, HeatmapColorScheme } from '../../voxel-world/components/HeatmapOverlay';
import { HeatmapControls, HeatmapType } from './HeatmapControls';
import { VoxelFloor } from '../../voxel-world/components/VoxelFloor';
import { VoxelWalls } from '../../voxel-world/components/VoxelWalls';
import { VoxelTableObject } from '../../voxel-world/components/objects/VoxelTable';
import { useVoxelStore } from '../../voxel-world/store/voxelStore';
import { DEFAULT_WORLD_DIMENSIONS, type VoxelObject } from '../../voxel-world/types/voxel';
import { TableStatus } from '@/types';
import {
  useOccupancyHeatmap,
  useTrafficHeatmap,
  useDwellTimeHeatmap,
} from '../analyticsApi';
import { HeatmapGranularity, HeatmapResponse } from '../types';

interface AnalyticsFloorPlanProps {
  startDate?: string;
  endDate?: string;
  className?: string;
}

// Convert API heatmap response to 2D grid format
function convertHeatmapData(response: HeatmapResponse | undefined): number[][] {
  if (!response || !response.data) {
    return [];
  }
  return response.data;
}

// Filter table objects from layout objects
function getTableObjects(objects: VoxelObject[]): VoxelObject[] {
  return objects.filter((obj) => obj.type === 'table');
}

function FloorPlanScene({
  heatmapData,
  colorScheme,
  opacity,
  showHeatmap,
}: {
  heatmapData: number[][];
  colorScheme: HeatmapColorScheme;
  opacity: number;
  showHeatmap: boolean;
}) {
  const layout = useVoxelStore((state) => state.layout);
  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS;
  const objects = layout?.objects ?? [];
  const tables = getTableObjects(objects);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.7} />
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
      <directionalLight position={[-10, 20, -10]} intensity={0.3} />

      {/* Floor */}
      <VoxelFloor width={dimensions.width} depth={dimensions.depth} color="#e8dcc8" />

      {/* Heatmap Overlay */}
      {showHeatmap && heatmapData.length > 0 && (
        <HeatmapOverlay
          width={dimensions.width}
          depth={dimensions.depth}
          data={heatmapData}
          colorScheme={colorScheme}
          opacity={opacity}
          visible={showHeatmap}
        />
      )}

      {/* Walls */}
      <VoxelWalls
        width={dimensions.width}
        height={dimensions.height}
        depth={dimensions.depth}
        wallColor="#d4c4b0"
      />

      {/* Tables */}
      {tables.map((table) => {
        const status = (table.metadata?.status as TableStatus) ?? TableStatus.AVAILABLE;
        const capacity = typeof table.metadata?.capacity === 'number' ? table.metadata.capacity : 4;
        return (
          <VoxelTableObject
            key={table.id}
            position={table.position}
            rotation={table.rotation}
            status={status}
            tableNumber={table.metadata?.tableNumber?.toString() ?? table.id}
            capacity={capacity}
            isSelected={false}
            isEditorMode={false}
          />
        );
      })}
    </>
  );
}

export function AnalyticsFloorPlan({ startDate, endDate, className = '' }: AnalyticsFloorPlanProps) {
  const [heatmapType, setHeatmapType] = useState<HeatmapType>('occupancy');
  const [colorScheme, setColorScheme] = useState<HeatmapColorScheme>('heat');
  const [opacity, setOpacity] = useState(0.6);

  const queryParams = {
    startDate,
    endDate,
    granularity: HeatmapGranularity.HOURLY,
  };

  // Fetch heatmap data based on selected type
  const occupancyQuery = useOccupancyHeatmap(queryParams);
  const trafficQuery = useTrafficHeatmap(queryParams);
  const dwellTimeQuery = useDwellTimeHeatmap(queryParams);

  const isLoading =
    (heatmapType === 'occupancy' && occupancyQuery.isLoading) ||
    (heatmapType === 'traffic' && trafficQuery.isLoading) ||
    (heatmapType === 'dwell-time' && dwellTimeQuery.isLoading);

  // Get the appropriate heatmap data based on selected type
  const heatmapData = useMemo(() => {
    switch (heatmapType) {
      case 'occupancy':
        return convertHeatmapData(occupancyQuery.data);
      case 'traffic':
        return convertHeatmapData(trafficQuery.data);
      case 'dwell-time':
        return convertHeatmapData(dwellTimeQuery.data);
      default:
        return [];
    }
  }, [heatmapType, occupancyQuery.data, trafficQuery.data, dwellTimeQuery.data]);

  return (
    <div className={`flex flex-col lg:flex-row gap-4 ${className}`}>
      {/* 3D Floor Plan Canvas */}
      <div className="flex-1 bg-slate-100 rounded-lg overflow-hidden min-h-[400px] lg:min-h-[500px] relative">
        <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
          <color attach="background" args={['#f1f5f9']} />
          <PerspectiveCamera makeDefault position={[30, 25, 30]} fov={50} />
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={10}
            maxDistance={80}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2.5}
            target={[16, 0, 16]}
          />
          <Suspense fallback={null}>
            <FloorPlanScene
              heatmapData={heatmapData}
              colorScheme={colorScheme}
              opacity={opacity}
              showHeatmap={heatmapType !== 'none'}
            />
          </Suspense>
        </Canvas>

        {/* Stats Overlay */}
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm">
          <div className="text-xs text-slate-500">
            {heatmapType !== 'none' ? (
              <>
                <span className="font-medium text-slate-700">
                  {heatmapType === 'occupancy' && 'Occupancy Heatmap'}
                  {heatmapType === 'traffic' && 'Traffic Flow Heatmap'}
                  {heatmapType === 'dwell-time' && 'Dwell Time Heatmap'}
                </span>
                <br />
                {heatmapData.length > 0 ? (
                  <span>Grid: {heatmapData.length}x{heatmapData[0]?.length || 0}</span>
                ) : (
                  <span className="text-amber-600">No data available</span>
                )}
              </>
            ) : (
              <span className="text-slate-400">Heatmap disabled</span>
            )}
          </div>
        </div>
      </div>

      {/* Controls Panel */}
      <div className="w-full lg:w-72 flex-shrink-0">
        <HeatmapControls
          heatmapType={heatmapType}
          onHeatmapTypeChange={setHeatmapType}
          colorScheme={colorScheme}
          onColorSchemeChange={setColorScheme}
          opacity={opacity}
          onOpacityChange={setOpacity}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

export default AnalyticsFloorPlan;
