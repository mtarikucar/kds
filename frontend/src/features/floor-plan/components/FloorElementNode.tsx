import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { FloorElementType } from '../../../types';
import type { EditorElement } from '../floorEditorStore';
import { spriteForElementType } from '../sprites';
import useSpriteImage from '../useSpriteImage';

interface Props {
  element: EditorElement;
  selected: boolean;
  editable: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (geo: { x: number; y: number; width: number; height: number; rotation: number }) => void;
}

/**
 * A decorative/structural floor element. DOOR/BAR/KITCHEN/PLANT/DECOR render
 * their pixel-art sprite when loaded (styled rectangle while loading / with no
 * asset); WALL/RECT stay rectangles, TEXT renders as a label. Geometry edits
 * mirror the table node (scale baked back into width/height on transform end).
 */
export default function FloorElementNode({
  element,
  selected,
  editable,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: Props) {
  const style = element.style ?? {};
  const isText = element.type === FloorElementType.TEXT;
  const loadedSprite = useSpriteImage(spriteForElementType(element.type));
  // Aspect guard: sprites are authored at each type's DEFAULT footprint aspect,
  // but persisted elements may carry older defaults (e.g. pre-sprite 60×12
  // doors) or extreme user resizes. Past ~1.6× mismatch a stretched sprite
  // reads as a smear — fall back to the vector rendering instead.
  const sprite = (() => {
    if (!loadedSprite) return null;
    const boxAspect = element.width / Math.max(1, element.height);
    const imgAspect = loadedSprite.width / Math.max(1, loadedSprite.height);
    const mismatch = boxAspect > imgAspect ? boxAspect / imgAspect : imgAspect / boxAspect;
    return mismatch <= 1.6 ? loadedSprite : null;
  })();

  const handleTransformEnd = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onTransformEnd({
      x: node.x(),
      y: node.y(),
      width: Math.max(8, element.width * scaleX),
      height: Math.max(8, element.height * scaleY),
      rotation: node.rotation(),
    });
  };

  return (
    <Group
      id={element.id}
      name="element-node"
      x={element.x}
      y={element.y}
      rotation={element.rotation}
      draggable={editable}
      onClick={(e) => { e.cancelBubble = true; onSelect(e.evt.shiftKey); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(false); }}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      onTransformEnd={handleTransformEnd}
    >
      {isText ? (
        <Text
          text={element.label || 'Text'}
          width={element.width}
          fontSize={(style.fontSize as number) || 18}
          fontStyle="bold"
          fill={(style.color as string) || '#0f172a'}
        />
      ) : sprite ? (
        // Pixel-art sprite; the node layer draws with smoothing disabled
        // (Konva only honors imageSmoothingEnabled at the Layer level).
        <KonvaImage
          image={sprite}
          width={element.width}
          height={element.height}
          opacity={(style.opacity as number) ?? 1}
        />
      ) : (
        <Rect
          width={element.width}
          height={element.height}
          fill={(style.fill as string) || '#cbd5e1'}
          stroke={selected ? '#0ea5e9' : (style.stroke as string) || undefined}
          strokeWidth={selected ? 3 : (style.strokeWidth as number) || 0}
          cornerRadius={(style.cornerRadius as number) || 2}
          opacity={(style.opacity as number) ?? 1}
        />
      )}
      {/* selection ring for text + sprites (neither has a stroke of its own) */}
      {(isText || sprite) && selected && (
        <Rect width={element.width} height={element.height} stroke="#0ea5e9" strokeWidth={2} dash={[4, 4]} listening={false} />
      )}
      {/* label on filled blocks (bar/kitchen) */}
      {!isText && element.label && (
        <Text
          y={element.height / 2 - 8}
          width={element.width}
          align="center"
          text={element.label}
          fontSize={13}
          fill="#ffffff"
          listening={false}
        />
      )}
    </Group>
  );
}
