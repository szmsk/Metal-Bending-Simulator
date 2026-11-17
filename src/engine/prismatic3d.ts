/**
 * Solid intersection for 3D prisms. XY cross-sections are arbitrary simple polygons,
 * while each body's Z span is finite. Unlike a section-only test, disjoint tools,
 * fingers and housings at different Z stations do not collide.
 *
 * The result is exact with respect to Z for the prescribed prismatic geometry.
 * XY penetration depth is a geometric estimate. This is not arbitrary triangle-mesh
 * collision detection, finite-element forming analysis or certified machine safety.
 */
import { Point2D } from '../types/bending';
import { testPolygonIntersection } from './polygon2d';

export interface Point3D { x: number; y: number; z: number }
export interface Prism3D {
  id: string;
  section: Point2D[];
  zMin: number;
  zMax: number;
}
export interface PrismContact {
  intersecting: boolean;
  clearanceMm: number;
  penetrationMm: number;
  point: Point3D;
  overlapWidthMm: number;
}

export function prism(id: string, section: Point2D[], zMin: number, zMax: number): Prism3D {
  return { id, section, zMin, zMax };
}

function xyBounds(poly: Point2D[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** No material intersection at zero Z overlap (contact is not penetration). */
export function intersectPrisms3D(a: Prism3D, b: Prism3D): PrismContact {
  const depthZ = Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin);
  const gapZ = Math.max(0, Math.max(a.zMin - b.zMax, b.zMin - a.zMax));
  const z = depthZ > 0
    ? (Math.max(a.zMin, b.zMin) + Math.min(a.zMax, b.zMax)) / 2
    : (Math.max(a.zMin, b.zMin) + Math.min(a.zMax, b.zMax)) / 2;
  const empty: PrismContact = { intersecting: false, clearanceMm: 0,
    penetrationMm: 0, point: { x: a.section[0]?.x ?? 0, y: a.section[0]?.y ?? 0, z },
    overlapWidthMm: Math.max(0, depthZ) };
  if (a.section.length < 3 || b.section.length < 3) return { ...empty, clearanceMm: Infinity };

  const aa = xyBounds(a.section), bb = xyBounds(b.section);
  const dx = Math.max(0, aa.minX - bb.maxX, bb.minX - aa.maxX);
  const dy = Math.max(0, aa.minY - bb.maxY, bb.minY - aa.maxY);
  // Fast rejection: the XY projected boxes don't overlap and Z is separated.
  // The actual XY distance is calculated below when it might be needed.
  const xy = testPolygonIntersection(a.section, b.section);
  if (xy.intersecting && depthZ > 1e-5) {
    // Physical overlap exists in all 3 axes. Penetration is an estimate, not volume.
    const penetration = Math.min(-xy.clearanceMm, depthZ);
    if (penetration > 1e-5) {
      return { intersecting: true, clearanceMm: -penetration,
        penetrationMm: penetration, point: { ...xy.contactPoint, z }, overlapWidthMm: depthZ };
    }
  }
  const distanceXY = xy.intersecting ? 0 : Math.max(0, xy.clearanceMm, Math.hypot(dx, dy));
  return { ...empty,
    clearanceMm: Math.hypot(distanceXY, gapZ),
    point: { ...xy.contactPoint, z },
  };
}

function clipHalfPlane(poly: Point2D[], axis: 'x'|'y', boundary: number, keepLess: boolean): Point2D[] {
  const inside = (p: Point2D) => keepLess ? p[axis] <= boundary : p[axis] >= boundary;
  const output: Point2D[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const aInside = inside(a), bInside = inside(b);
    if (aInside) output.push(a);
    if (aInside !== bInside && b[axis] !== a[axis]) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      output.push({ x: a.x + (b.x-a.x)*t, y: a.y+(b.y-a.y)*t });
    }
  }
  return output;
}

/**
 * Partition a polygon outside of a known intentional contact pocket. This does
 * not remove the entire flange: any material outside the forming area is checked.
 * Applied ONLY to punch/die forming contact, never to ram/bed/gauge/columns.
 */
export function outsideContactPocket(poly: Point2D[], xMin: number, xMax: number, yMin: number, yMax: number): Point2D[][] {
  const lo = clipHalfPlane(poly, 'x', xMin, true);
  const hi = clipHalfPlane(poly, 'x', xMax, false);
  let middle = clipHalfPlane(poly, 'x', xMin, false);
  middle = clipHalfPlane(middle, 'x', xMax, true);
  const bottom = clipHalfPlane(middle, 'y', yMin, true);
  const top = clipHalfPlane(middle, 'y', yMax, false);
  return [lo, hi, bottom, top].filter((p) => p.length >= 3 && Math.abs(area(p)) > 1e-6);
}

function area(poly: Point2D[]): number {
  let sum = 0;
  for (let i=0; i<poly.length; i++) {
    const a=poly[i], b=poly[(i+1)%poly.length]; sum+=a.x*b.y-b.x*a.y;
  }
  return sum * 0.5;
}
