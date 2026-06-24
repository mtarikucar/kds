import { describe, it, expect } from 'vitest';
import {
  snap,
  snapPoint,
  clamp,
  clampToCanvas,
  computeSeatPositions,
  normalizeRotation,
  clampCoord,
  clampTableSize,
  clampElementSize,
} from './geometry';
import { TableShape } from '../../types';

describe('floor-plan geometry', () => {
  describe('snap', () => {
    it('rounds to the nearest grid line', () => {
      expect(snap(23, 20)).toBe(20);
      expect(snap(31, 20)).toBe(40);
      expect(snap(50, 20)).toBe(60); // 2.5 rounds up
    });
    it('is a no-op when gridSize <= 0', () => {
      expect(snap(23.4, 0)).toBe(23.4);
      expect(snap(23.4, -5)).toBe(23.4);
    });
    it('snapPoint snaps both axes', () => {
      expect(snapPoint({ x: 23, y: 38 }, 20)).toEqual({ x: 20, y: 40 });
    });
  });

  describe('clamp / clampToCanvas', () => {
    it('clamps within bounds', () => {
      expect(clamp(-5, 0, 100)).toBe(0);
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(50, 0, 100)).toBe(50);
    });
    it('keeps an item inside the canvas accounting for its size', () => {
      expect(clampToCanvas(-10, -10, 80, 80, 1200, 800)).toEqual({ x: 0, y: 0 });
      expect(clampToCanvas(2000, 2000, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 });
    });
  });

  describe('computeSeatPositions', () => {
    it('returns exactly `capacity` seats for a round table', () => {
      expect(computeSeatPositions(TableShape.ROUND, 80, 80, 4)).toHaveLength(4);
      expect(computeSeatPositions(TableShape.ROUND, 80, 80, 6)).toHaveLength(6);
    });
    it('returns exactly `capacity` seats for a rectangular table (largest-remainder sums exactly)', () => {
      for (const cap of [1, 2, 3, 5, 7, 8, 12]) {
        expect(computeSeatPositions(TableShape.RECT, 200, 80, cap)).toHaveLength(cap);
      }
    });
    it('returns no seats for capacity 0', () => {
      expect(computeSeatPositions(TableShape.SQUARE, 80, 80, 0)).toHaveLength(0);
    });
    it('returns no seats (no NaN) for a degenerate 0×0 rectangular table', () => {
      const seats = computeSeatPositions(TableShape.RECT, 0, 0, 4);
      expect(seats).toHaveLength(0);
    });
    it('round seats lie roughly on a circle outside the table', () => {
      const seats = computeSeatPositions(TableShape.ROUND, 80, 80, 8);
      const cx = 40;
      const cy = 40;
      const r = 40 + 10;
      for (const s of seats) {
        const dist = Math.hypot(s.x - cx, s.y - cy);
        expect(Math.abs(dist - r)).toBeLessThan(0.001);
      }
    });
    it('rectangular seats favor the longer edges', () => {
      // A long, thin rectangle: most seats should land on top/bottom (y≈-gap
      // or y≈h+gap) rather than the short left/right edges.
      const seats = computeSeatPositions(TableShape.RECT, 300, 60, 10);
      const onLongEdges = seats.filter((s) => s.y < 0 || s.y > 60).length;
      expect(onLongEdges).toBeGreaterThan(seats.length / 2);
    });
  });

  describe('backend-bound clamps (keep the working copy saveable)', () => {
    it('normalizeRotation folds any cumulative rotation into [0,360)', () => {
      expect(normalizeRotation(725)).toBe(5);
      expect(normalizeRotation(-90)).toBe(270);
      expect(normalizeRotation(360)).toBe(0);
      expect(normalizeRotation(45)).toBe(45);
      expect(normalizeRotation(Number.NaN)).toBe(0);
    });
    it('clampCoord pins coordinates to [-2000, 12000]', () => {
      expect(clampCoord(-99999)).toBe(-2000);
      expect(clampCoord(99999)).toBe(12000);
      expect(clampCoord(500)).toBe(500);
    });
    it('clampTableSize pins (abs) size to [10, 2000]', () => {
      expect(clampTableSize(-50)).toBe(50); // flip → abs
      expect(clampTableSize(5)).toBe(10);
      expect(clampTableSize(9000)).toBe(2000);
    });
    it('clampElementSize pins (abs) size to [1, 12000]', () => {
      expect(clampElementSize(-3)).toBe(3);
      expect(clampElementSize(0)).toBe(1);
      expect(clampElementSize(99999)).toBe(12000);
    });
  });
});
