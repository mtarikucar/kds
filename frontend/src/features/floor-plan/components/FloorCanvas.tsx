import { useEffect, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Line, Rect, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import type { FloorZone } from '../../../types';
import type { EditorElement, EditorTable, Selection } from '../floorEditorStore';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../constants';
import TableShapeNode from './TableShapeNode';
import FloorElementNode from './FloorElementNode';

interface Props {
  zone: FloorZone;
  tables: EditorTable[];
  elements: EditorElement[];
  selection: Selection[];
  editable: boolean;
  showGrid: boolean;
  width: number;
  height: number;
  onSelect: (sel: Selection | null, additive: boolean) => void;
  onTableDragEnd: (id: string, posX: number, posY: number) => void;
  onTableTransformEnd: (id: string, geo: { posX: number; posY: number; width: number; height: number; rotation: number }) => void;
  onElementDragEnd: (id: string, x: number, y: number) => void;
  onElementTransformEnd: (id: string, geo: { x: number; y: number; width: number; height: number; rotation: number }) => void;
  /** Click on empty canvas at design-space coords (used to drop a new item). */
  onCanvasClick?: (x: number, y: number) => void;
}

function useBackgroundImage(url?: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    image.onload = () => setImg(image);
    image.onerror = () => setImg(null);
    return () => { image.onload = null; image.onerror = null; };
  }, [url]);
  return img;
}

export default function FloorCanvas({
  zone, tables, elements, selection, editable, showGrid, width, height,
  onSelect, onTableDragEnd, onTableTransformEnd, onElementDragEnd, onElementTransformEnd, onCanvasClick,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const bgImage = useBackgroundImage(zone.backgroundImageUrl);

  const fitToView = useCallback(() => {
    const pad = 40;
    const s = Math.min(
      (width - pad) / zone.canvasWidth,
      (height - pad) / zone.canvasHeight,
      1,
    );
    const ns = Math.max(ZOOM_MIN, s);
    setScale(ns);
    setPos({
      x: (width - zone.canvasWidth * ns) / 2,
      y: (height - zone.canvasHeight * ns) / 2,
    });
  }, [width, height, zone.canvasWidth, zone.canvasHeight]);

  // Fit whenever the zone or viewport changes.
  useEffect(() => { fitToView(); }, [fitToView, zone.id]);

  // Attach the transformer to the currently-selected nodes (editor only).
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    if (!editable || selection.length === 0) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes = selection
      .map((s) => layer.findOne('#' + s.id))
      .filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, editable, tables, elements]);

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const oldScale = scale;
    const mousePoint = { x: (pointer.x - pos.x) / oldScale, y: (pointer.y - pos.y) / oldScale };
    const direction = e.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale * direction));
    setScale(newScale);
    setPos({ x: pointer.x - mousePoint.x * newScale, y: pointer.y - mousePoint.y * newScale });
  };

  const zoomBy = (factor: number) => {
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor));
    // zoom around the viewport center
    const cx = width / 2;
    const cy = height / 2;
    const mp = { x: (cx - pos.x) / scale, y: (cy - pos.y) / scale };
    setScale(newScale);
    setPos({ x: cx - mp.x * newScale, y: cy - mp.y * newScale });
  };

  const handleStageClick = (e: KonvaEventObject<MouseEvent>) => {
    // A click that lands on the stage/background (not a node) clears selection
    // (or drops a new item if a placement handler is set).
    if (e.target === e.target.getStage() || e.target.name() === 'bg') {
      onSelect(null, false);
      if (onCanvasClick) {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        if (pointer) {
          onCanvasClick((pointer.x - pos.x) / scale, (pointer.y - pos.y) / scale);
        }
      }
    }
  };

  const gridLines: number[][] = [];
  if (showGrid && zone.gridSize > 1) {
    for (let x = 0; x <= zone.canvasWidth; x += zone.gridSize) gridLines.push([x, 0, x, zone.canvasHeight]);
    for (let y = 0; y <= zone.canvasHeight; y += zone.gridSize) gridLines.push([0, y, zone.canvasWidth, y]);
  }

  const selectedIds = new Set(selection.map((s) => s.id));

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-100">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        draggable
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onDragEnd={(e) => {
          // Only the stage pan updates pos (node drags are handled per-node).
          if (e.target === e.target.getStage()) setPos({ x: e.target.x(), y: e.target.y() });
        }}
      >
        <Layer ref={layerRef}>
          {/* canvas surface */}
          <Rect name="bg" x={0} y={0} width={zone.canvasWidth} height={zone.canvasHeight} fill="#ffffff" stroke="#e2e8f0" strokeWidth={1} />
          {bgImage && (
            <KonvaImage image={bgImage} x={0} y={0} width={zone.canvasWidth} height={zone.canvasHeight} opacity={zone.backgroundOpacity} listening={false} />
          )}
          {/* grid */}
          {gridLines.map((pts, i) => (
            <Line key={i} points={pts} stroke="#eef2f7" strokeWidth={1} listening={false} />
          ))}
          {/* elements (behind tables) */}
          {elements.map((el) => (
            <FloorElementNode
              key={el.id}
              element={el}
              selected={selectedIds.has(el.id)}
              editable={editable}
              onSelect={(additive) => onSelect({ kind: 'element', id: el.id }, additive)}
              onDragEnd={(x, y) => onElementDragEnd(el.id, x, y)}
              onTransformEnd={(geo) => onElementTransformEnd(el.id, geo)}
            />
          ))}
          {/* tables */}
          {tables.map((t) => (
            <TableShapeNode
              key={t.id}
              table={t}
              selected={selectedIds.has(t.id)}
              editable={editable}
              onSelect={(additive) => onSelect({ kind: 'table', id: t.id }, additive)}
              onDragEnd={(x, y) => onTableDragEnd(t.id, x, y)}
              onTransformEnd={(geo) => onTableTransformEnd(t.id, geo)}
            />
          ))}
          {editable && (
            <Transformer
              ref={trRef}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 16 || newBox.height < 16 ? oldBox : newBox)}
            />
          )}
        </Layer>
      </Stage>

      {/* zoom overlay */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button type="button" onClick={() => zoomBy(ZOOM_STEP)} className="w-9 h-9 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50" aria-label="zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} className="w-9 h-9 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50" aria-label="zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button type="button" onClick={fitToView} className="w-9 h-9 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50" aria-label="fit to screen">
          <Maximize className="w-4 h-4" />
        </button>
      </div>
      <div className="absolute bottom-3 left-3 text-xs text-slate-400 bg-white/70 rounded px-2 py-1">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
