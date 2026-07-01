import { describe, expect, it } from 'vitest';
import { scalePointerToCanvas } from './calibrationGeometry';

describe('scalePointerToCanvas', () => {
  it('is identity when the rect matches the target size and sits at the origin', () => {
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(scalePointerToCanvas(100, 200, rect, 640, 480)).toEqual({ x: 100, y: 200 });
  });

  it('subtracts the rect origin before scaling', () => {
    // element rendered at (50, 30); a click at (60, 50) is 10px / 20px inside it
    const rect = { left: 50, top: 30, width: 640, height: 480 };
    expect(scalePointerToCanvas(60, 50, rect, 640, 480)).toEqual({ x: 10, y: 20 });
  });

  it('upscales when the canvas is larger than its rendered size', () => {
    // canvas is 640x480 but displayed at 320x240 -> 2x scaling on both axes
    const rect = { left: 0, top: 0, width: 320, height: 240 };
    expect(scalePointerToCanvas(100, 100, rect, 640, 480)).toEqual({ x: 200, y: 200 });
  });

  it('scales each axis independently for non-uniform display', () => {
    // displayed half-width, full-height
    const rect = { left: 0, top: 0, width: 200, height: 400 };
    expect(scalePointerToCanvas(50, 50, rect, 400, 400)).toEqual({ x: 100, y: 50 });
  });

  it('maps the bottom-right corner onto the full target extent', () => {
    const rect = { left: 10, top: 10, width: 100, height: 100 };
    // click at the far corner of the rendered element
    expect(scalePointerToCanvas(110, 110, rect, 400, 400)).toEqual({ x: 400, y: 400 });
  });

  it('fails safe to the origin (not NaN/Infinity) when the rect has no size', () => {
    // A not-yet-laid-out element (display:none / pre-mount) reports width/height 0.
    // Unguarded this divides by zero -> Infinity, and a click on the edge -> NaN,
    // which would poison the saved calibration homography.
    const degenerate = { left: 0, top: 0, width: 0, height: 0 };
    const out = scalePointerToCanvas(0, 0, degenerate, 640, 480);
    expect(out).toEqual({ x: 0, y: 0 });
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
  });
});
