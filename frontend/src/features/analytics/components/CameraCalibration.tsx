import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// Types
interface CalibrationPoint {
  id: string;
  imageX: number;
  imageY: number;
  floorX: number;
  floorZ: number;
}

interface CameraCalibrationData {
  points: CalibrationPoint[];
  homographyMatrix?: number[][];
}

interface CameraCalibrationProps {
  cameraId: string;
  streamUrl: string;
  floorPlanWidth: number;
  floorPlanHeight: number;
  gridSize?: number;
  onCalibrationComplete?: (data: CameraCalibrationData) => void;
  onCancel?: () => void;
}

type CalibrationStep = 'image-points' | 'floor-points' | 'preview' | 'complete';

// Component
export function CameraCalibration({
  cameraId,
  streamUrl,
  floorPlanWidth,
  floorPlanHeight,
  gridSize = 20,
  onCalibrationComplete,
  onCancel,
}: CameraCalibrationProps) {
  const queryClient = useQueryClient();

  // State
  const [step, setStep] = useState<CalibrationStep>('image-points');
  const [imagePoints, setImagePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [floorPoints, setFloorPoints] = useState<Array<{ x: number; z: number }>>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const floorCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Constants
  const REQUIRED_POINTS = 4;
  const CANVAS_WIDTH = 640;
  const CANVAS_HEIGHT = 480;

  // Point labels for corners
  const POINT_LABELS = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];

  // Capture current frame from video
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = imageCanvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    setPreviewFrame(canvas.toDataURL('image/jpeg'));
  }, []);

  // Handle image click for point selection
  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (imagePoints.length >= REQUIRED_POINTS) return;

      const canvas = imageCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      setImagePoints([...imagePoints, { x, y }]);
    },
    [imagePoints]
  );

  // Handle floor plan click for point selection
  const handleFloorClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (floorPoints.length >= REQUIRED_POINTS) return;

      const canvas = floorCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = floorPlanWidth / rect.width;
      const scaleZ = floorPlanHeight / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const z = (e.clientY - rect.top) * scaleZ;

      setFloorPoints([...floorPoints, { x, z }]);
    },
    [floorPoints, floorPlanWidth, floorPlanHeight]
  );

  // Draw points on canvases
  useEffect(() => {
    // Draw image points
    const imageCanvas = imageCanvasRef.current;
    if (imageCanvas && previewFrame) {
      const ctx = imageCanvas.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

          // Draw points
          imagePoints.forEach((point, index) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = index === selectedPointIndex ? '#3b82f6' : '#ef4444';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(POINT_LABELS[index], point.x + 12, point.y + 4);
          });

          // Draw connecting lines
          if (imagePoints.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(imagePoints[0].x, imagePoints[0].y);
            for (let i = 1; i < imagePoints.length; i++) {
              ctx.lineTo(imagePoints[i].x, imagePoints[i].y);
            }
            if (imagePoints.length === REQUIRED_POINTS) {
              ctx.closePath();
            }
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        };
        img.src = previewFrame;
      }
    }
  }, [imagePoints, previewFrame, selectedPointIndex]);

  // Draw floor plan grid
  useEffect(() => {
    const floorCanvas = floorCanvasRef.current;
    if (!floorCanvas) return;

    const ctx = floorCanvas.getContext('2d');
    if (!ctx) return;

    const width = floorCanvas.width;
    const height = floorCanvas.height;

    // Clear
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    const cellWidth = width / gridSize;
    const cellHeight = height / gridSize;

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;

    for (let i = 0; i <= gridSize; i++) {
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(i * cellWidth, 0);
      ctx.lineTo(i * cellWidth, height);
      ctx.stroke();

      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, i * cellHeight);
      ctx.lineTo(width, i * cellHeight);
      ctx.stroke();
    }

    // Draw floor points
    const scaleX = width / floorPlanWidth;
    const scaleZ = height / floorPlanHeight;

    floorPoints.forEach((point, index) => {
      const canvasX = point.x * scaleX;
      const canvasZ = point.z * scaleZ;

      ctx.beginPath();
      ctx.arc(canvasX, canvasZ, 8, 0, Math.PI * 2);
      ctx.fillStyle = index === selectedPointIndex ? '#3b82f6' : '#22c55e';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(POINT_LABELS[index], canvasX + 12, canvasZ + 4);
    });

    // Draw connecting lines
    if (floorPoints.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(floorPoints[0].x * scaleX, floorPoints[0].z * scaleZ);
      for (let i = 1; i < floorPoints.length; i++) {
        ctx.lineTo(floorPoints[i].x * scaleX, floorPoints[i].z * scaleZ);
      }
      if (floorPoints.length === REQUIRED_POINTS) {
        ctx.closePath();
      }
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [floorPoints, floorPlanWidth, floorPlanHeight, gridSize, selectedPointIndex]);

  // Remove last point
  const removeLastPoint = useCallback(() => {
    if (step === 'image-points' && imagePoints.length > 0) {
      setImagePoints(imagePoints.slice(0, -1));
    } else if (step === 'floor-points' && floorPoints.length > 0) {
      setFloorPoints(floorPoints.slice(0, -1));
    }
  }, [step, imagePoints, floorPoints]);

  // Reset calibration
  const resetCalibration = useCallback(() => {
    setImagePoints([]);
    setFloorPoints([]);
    setStep('image-points');
    setError(null);
  }, []);

  // Move to next step
  const nextStep = useCallback(() => {
    if (step === 'image-points' && imagePoints.length === REQUIRED_POINTS) {
      setStep('floor-points');
    } else if (step === 'floor-points' && floorPoints.length === REQUIRED_POINTS) {
      setStep('preview');
    }
  }, [step, imagePoints.length, floorPoints.length]);

  // Move to previous step
  const prevStep = useCallback(() => {
    if (step === 'floor-points') {
      setStep('image-points');
    } else if (step === 'preview') {
      setStep('floor-points');
    }
  }, [step]);

  // Calculate homography matrix (client-side preview)
  const calculateHomography = useCallback(() => {
    if (imagePoints.length !== REQUIRED_POINTS || floorPoints.length !== REQUIRED_POINTS) {
      return null;
    }

    // This is a simplified calculation for preview
    // The actual matrix calculation is done server-side using OpenCV
    const points: CalibrationPoint[] = imagePoints.map((imgPt, index) => ({
      id: `point-${index}`,
      imageX: imgPt.x,
      imageY: imgPt.y,
      floorX: floorPoints[index].x,
      floorZ: floorPoints[index].z,
    }));

    return { points };
  }, [imagePoints, floorPoints]);

  // Save calibration to backend
  const saveCalibrationMutation = useMutation({
    mutationFn: async (data: CameraCalibrationData) => {
      const response = await fetch(`/api/analytics/cameras/${cameraId}/calibration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to save calibration');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cameras', cameraId] });
      setStep('complete');
      onCalibrationComplete?.(data);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save calibration');
    },
  });

  // Handle save
  const handleSave = useCallback(() => {
    const data = calculateHomography();
    if (data) {
      saveCalibrationMutation.mutate(data);
    }
  }, [calculateHomography, saveCalibrationMutation]);

  // Render step content
  const renderStepContent = () => {
    switch (step) {
      case 'image-points':
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">Step 1: Select Camera Points</h4>
              <p className="text-sm text-blue-700">
                Click on 4 corners of a rectangular area in the camera view. Start from the
                top-left corner and go clockwise.
              </p>
            </div>

            <div className="relative border rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={streamUrl}
                autoPlay
                muted
                playsInline
                className={previewFrame ? 'hidden' : 'w-full'}
              />
              <canvas
                ref={imageCanvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onClick={handleImageClick}
                className="w-full cursor-crosshair"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">
                Points selected: {imagePoints.length} / {REQUIRED_POINTS}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={captureFrame}
                  className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                >
                  Capture Frame
                </button>
                <button
                  onClick={removeLastPoint}
                  disabled={imagePoints.length === 0}
                  className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                >
                  Undo
                </button>
              </div>
            </div>
          </div>
        );

      case 'floor-points':
        return (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-medium text-green-900 mb-2">Step 2: Select Floor Plan Points</h4>
              <p className="text-sm text-green-700">
                Click on the corresponding 4 points on the floor plan grid. Match the same order as
                the camera points (top-left, top-right, bottom-right, bottom-left).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Camera preview (read-only) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Camera View</label>
                <canvas
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="w-full border rounded-lg opacity-75"
                />
              </div>

              {/* Floor plan */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Floor Plan</label>
                <canvas
                  ref={floorCanvasRef}
                  width={400}
                  height={400}
                  onClick={handleFloorClick}
                  className="w-full border rounded-lg cursor-crosshair"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">
                Points selected: {floorPoints.length} / {REQUIRED_POINTS}
              </span>
              <button
                onClick={removeLastPoint}
                disabled={floorPoints.length === 0}
                className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          </div>
        );

      case 'preview':
        return (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-medium text-amber-900 mb-2">Step 3: Review Calibration</h4>
              <p className="text-sm text-amber-700">
                Verify that the camera and floor plan points are correctly aligned. The
                transformation will map positions from the camera view to the floor plan.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Camera Points</label>
                <ul className="text-sm text-slate-600 space-y-1">
                  {imagePoints.map((point, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: '#ef4444' }}
                      />
                      {POINT_LABELS[index]}: ({Math.round(point.x)}, {Math.round(point.y)})
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Floor Plan Points</label>
                <ul className="text-sm text-slate-600 space-y-1">
                  {floorPoints.map((point, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: '#22c55e' }}
                      />
                      {POINT_LABELS[index]}: ({point.x.toFixed(2)}m, {point.z.toFixed(2)}m)
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        );

      case 'complete':
        return (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h4 className="text-lg font-medium text-slate-900 mb-2">Calibration Complete</h4>
            <p className="text-sm text-slate-600">
              The camera has been successfully calibrated. Position data will now be mapped to the
              floor plan coordinates.
            </p>
          </div>
        );
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium text-slate-900">Camera Calibration</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-6">
        {['image-points', 'floor-points', 'preview', 'complete'].map((s, index) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s
                  ? 'bg-primary-500 text-white'
                  : index < ['image-points', 'floor-points', 'preview', 'complete'].indexOf(step)
                    ? 'bg-green-500 text-white'
                    : 'bg-slate-200 text-slate-500'
              }`}
            >
              {index + 1}
            </div>
            {index < 3 && <div className="w-8 h-0.5 bg-slate-200" />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {renderStepContent()}

      {/* Navigation Buttons */}
      {step !== 'complete' && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
          <button
            onClick={step === 'image-points' ? resetCalibration : prevStep}
            className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
          >
            {step === 'image-points' ? 'Reset' : 'Back'}
          </button>

          <div className="flex gap-2">
            {step === 'preview' ? (
              <button
                onClick={handleSave}
                disabled={saveCalibrationMutation.isPending}
                className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
              >
                {saveCalibrationMutation.isPending ? 'Saving...' : 'Save Calibration'}
              </button>
            ) : (
              <button
                onClick={nextStep}
                disabled={
                  (step === 'image-points' && imagePoints.length !== REQUIRED_POINTS) ||
                  (step === 'floor-points' && floorPoints.length !== REQUIRED_POINTS)
                }
                className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                Next
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CameraCalibration;
