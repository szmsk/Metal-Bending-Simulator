import { Point2D } from '../types/bending';
import { edgesIntersect } from './profileValidation';

const EPS = 1e-6;

function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + EPS) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D
): Point2D | null {
  if (!edgesIntersect(a1, a2, b1, b2)) return null;
  const dx = a2.x - a1.x, dy = a2.y - a1.y;
  const ex = b2.x - b1.x, ey = b2.y - b1.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < EPS) return null; // coincident boundaries are contact, not penetration
  const t = ((b1.x - a1.x) * ey - (b1.y - a1.y) * ex) / den;
  const u = ((b1.x - a1.x) * dy - (b1.y - a1.y) * dx) / den;
  // Proper crossings only. Endpoint touching is not a solid collision by itself.
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: a1.x + dx * t, y: a1.y + dy * t };
}

function pointToSegmentDist(p: Point2D, v: Point2D, w: Point2D): { dist: number; closest: Point2D } {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 < 1e-9) {
    return { dist: Math.hypot(p.x - v.x, p.y - v.y), closest: v };
  }
  const t = Math.max(0, Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2));
  const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return { dist: Math.hypot(p.x - proj.x, p.y - proj.y), closest: proj };
}

function insetPolygon(poly: Point2D[], insetMm: number): Point2D[] {
  if (poly.length === 4) {
    const [v0, v1, v2, v3] = poly;
    const lx = v1.x - v0.x;
    const ly = v1.y - v0.y;
    const lLen = Math.hypot(lx, ly) || 1;
    const ux = (lx / lLen) * Math.min(insetMm, lLen * 0.25);
    const uy = (ly / lLen) * Math.min(insetMm, lLen * 0.25);

    const tx = v3.x - v0.x;
    const ty = v3.y - v0.y;
    const tLen = Math.hypot(tx, ty) || 1;
    const vx = (tx / tLen) * Math.min(insetMm, tLen * 0.3);
    const vy = (ty / tLen) * Math.min(insetMm, tLen * 0.3);

    return [
      { x: v0.x + ux + vx, y: v0.y + uy + vy },
      { x: v1.x - ux + vx, y: v1.y - uy + vy },
      { x: v2.x - ux - vx, y: v2.y - uy - vy },
      { x: v3.x + ux - vx, y: v3.y + uy - vy },
    ];
  }
  return poly;
}

/**
 * Approximate 2D polygon intersection & clearance test (supports concave polygons).
 * Uses a small 0.05 mm interior test to distinguish solid overlap from tangent contact.
 */
export function testPolygonIntersection(
  polyA: Point2D[],
  polyB: Point2D[]
): { intersecting: boolean; clearanceMm: number; contactPoint: Point2D } {
  const coreA = insetPolygon(polyA, 0.05);
  const edgeIntersections: Point2D[] = [];

  for (let i = 0; i < coreA.length; i++) {
    const a1 = coreA[i];
    const a2 = coreA[(i + 1) % coreA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      const hit = segmentsIntersect(a1, a2, b1, b2);
      if (hit) edgeIntersections.push(hit);
    }
  }

  const aInsideB = coreA.filter((p) => pointInPolygon(p, polyB));
  const bInsideA = polyB.filter((p) => pointInPolygon(p, coreA));

  if (edgeIntersections.length > 0 || aInsideB.length > 0 || bInsideA.length > 0) {
    // Crossing edges alone prove intersection but give NO reliable depth estimate.
    // In particular, never fabricate 0.21 mm at the *instant of first touch*.
    // Use a tiny positive intersection witness until an enclosed vertex supplies depth.
    let maxDepth = 0.0001;
    let bestPt: Point2D =
      aInsideB[0] || bInsideA[0] || edgeIntersections[0] || polyA[0];

    if (edgeIntersections.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const p of edgeIntersections) {
        sx += p.x;
        sy += p.y;
      }
      bestPt = { x: sx / edgeIntersections.length, y: sy / edgeIntersections.length };
    }

    for (const p of aInsideB) {
      let minEdgeDist = Infinity;
      for (let j = 0; j < polyB.length; j++) {
        const d = pointToSegmentDist(p, polyB[j], polyB[(j + 1) % polyB.length]).dist;
        if (d < minEdgeDist) minEdgeDist = d;
      }
      if (minEdgeDist + 0.05 > maxDepth) {
        maxDepth = minEdgeDist + 0.05;
        bestPt = p;
      }
    }

    for (const p of bInsideA) {
      let minEdgeDist = Infinity;
      for (let i = 0; i < polyA.length; i++) {
        const d = pointToSegmentDist(p, polyA[i], polyA[(i + 1) % polyA.length]).dist;
        if (d < minEdgeDist) minEdgeDist = d;
      }
      if (minEdgeDist > maxDepth) {
        maxDepth = minEdgeDist;
        bestPt = p;
      }
    }

    return {
      intersecting: true,
      clearanceMm: -maxDepth,
      contactPoint: bestPt,
    };
  }

  // Separated: compute exact minimum distance between un-inset boundaries
  let minDist = Infinity;
  let closestPt = polyA[0];

  for (const p of polyA) {
    for (let j = 0; j < polyB.length; j++) {
      const res = pointToSegmentDist(p, polyB[j], polyB[(j + 1) % polyB.length]);
      if (res.dist < minDist) {
        minDist = res.dist;
        closestPt = p;
      }
    }
  }
  for (const p of polyB) {
    for (let i = 0; i < polyA.length; i++) {
      const res = pointToSegmentDist(p, polyA[i], polyA[(i + 1) % polyA.length]);
      if (res.dist < minDist) {
        minDist = res.dist;
        closestPt = res.closest;
      }
    }
  }

  return {
    intersecting: false,
    clearanceMm: minDist,
    contactPoint: closestPt,
  };
}

