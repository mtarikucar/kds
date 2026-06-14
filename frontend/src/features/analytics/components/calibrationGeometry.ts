// Pure pointer-to-canvas coordinate mapping, extracted verbatim from the
// click handlers in CameraCalibration so the scaling math can be unit-tested
// without a DOM / canvas. A pointer event lands at viewport coordinates
// (clientX/clientY); we offset by the element's on-screen rect origin and
// rescale by the ratio between the element's intrinsic (target) size and its
// rendered (CSS) size.

/** The subset of a DOMRect the scaling math actually reads. */
export interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Map a pointer's viewport coordinates onto an element's intrinsic
 * coordinate space.
 *
 * @param clientX  pointer X in viewport pixels (e.g. MouseEvent.clientX)
 * @param clientY  pointer Y in viewport pixels (e.g. MouseEvent.clientY)
 * @param rect     the element's on-screen bounding rect
 * @param targetWidth   the element's intrinsic width (e.g. canvas.width)
 * @param targetHeight  the element's intrinsic height (e.g. canvas.height)
 */
export function scalePointerToCanvas(
  clientX: number,
  clientY: number,
  rect: ElementRect,
  targetWidth: number,
  targetHeight: number
): Point2D {
  const scaleX = targetWidth / rect.width;
  const scaleY = targetHeight / rect.height;

  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  return { x, y };
}
