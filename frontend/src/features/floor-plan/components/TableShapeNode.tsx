import { Group, Circle, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { TableShape, TableStatus } from '../../../types';
import type { EditorTable } from '../floorEditorStore';
import { computeSeatPositions } from '../geometry';

/** Status → fill, matching lib/tableStatus.ts (emerald / red / amber 500). */
const STATUS_FILL: Record<TableStatus, string> = {
  [TableStatus.AVAILABLE]: '#10b981',
  [TableStatus.OCCUPIED]: '#ef4444',
  [TableStatus.RESERVED]: '#f59e0b',
};
const SEAT_FILL = '#cbd5e1';
const SEAT_STROKE = '#94a3b8';

interface Props {
  table: EditorTable;
  selected: boolean;
  editable: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (posX: number, posY: number) => void;
  onTransformEnd: (geo: { posX: number; posY: number; width: number; height: number; rotation: number }) => void;
}

/**
 * A table rendered on the canvas: status-colored silhouette (round/square/
 * rect), auto seat dots from capacity, the table number, and an active-order
 * badge. Used in both the editor (editable) and the live map (read-only).
 */
export default function TableShapeNode({
  table,
  selected,
  editable,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: Props) {
  const { width: w, height: h } = table;
  const fill = STATUS_FILL[table.status] ?? '#10b981';
  const seats = computeSeatPositions(table.tableShape, w, h, table.capacity);

  const handleTransformEnd = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    // Bake the scale back into width/height so the next transform starts fresh.
    node.scaleX(1);
    node.scaleY(1);
    onTransformEnd({
      posX: node.x(),
      posY: node.y(),
      width: Math.max(20, w * scaleX),
      height: Math.max(20, h * scaleY),
      rotation: node.rotation(),
    });
  };

  return (
    <Group
      id={table.id}
      name="table-node"
      x={table.posX}
      y={table.posY}
      rotation={table.rotation}
      draggable={editable}
      onClick={(e) => { e.cancelBubble = true; onSelect(e.evt.shiftKey); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(false); }}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      onTransformEnd={handleTransformEnd}
    >
      {/* seat dots (drawn first, behind the table body) */}
      {seats.map((s, i) => (
        <Circle key={i} x={s.x} y={s.y} radius={6} fill={SEAT_FILL} stroke={SEAT_STROKE} strokeWidth={1} />
      ))}

      {/* table body */}
      {table.tableShape === TableShape.ROUND ? (
        <Circle
          x={w / 2}
          y={h / 2}
          radius={Math.min(w, h) / 2}
          fill={fill}
          stroke={selected ? '#0ea5e9' : '#0f172a'}
          strokeWidth={selected ? 3 : 1}
          shadowColor="#000000"
          shadowOpacity={0.15}
          shadowBlur={6}
          shadowOffsetY={2}
        />
      ) : (
        <Rect
          width={w}
          height={h}
          cornerRadius={table.tableShape === TableShape.SQUARE ? 8 : 6}
          fill={fill}
          stroke={selected ? '#0ea5e9' : '#0f172a'}
          strokeWidth={selected ? 3 : 1}
          shadowColor="#000000"
          shadowOpacity={0.15}
          shadowBlur={6}
          shadowOffsetY={2}
        />
      )}

      {/* table number */}
      <Text
        x={0}
        y={h / 2 - 9}
        width={w}
        align="center"
        text={table.number}
        fontSize={16}
        fontStyle="bold"
        fill="#ffffff"
        listening={false}
      />

      {/* active-order badge */}
      {table.activeOrderCount > 0 && (
        <Group x={w - 6} y={-6} listening={false}>
          <Circle radius={11} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
          <Text x={-11} y={-7} width={22} align="center" text={String(table.activeOrderCount)} fontSize={12} fontStyle="bold" fill="#ffffff" />
        </Group>
      )}
    </Group>
  );
}
