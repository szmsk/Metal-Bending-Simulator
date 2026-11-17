import { DEFAULT_MACHINE } from '../data/library';
import {
  BendStepConfig,
  CollisionEvent,
  CollisionTargetType,
  DieTool,
  PartDefinition,
  Point2D,
  PressMachineSpec,
  PunchTool,
  SheetMaterial,
  StepSimulationReport,
} from '../types/bending';
import { evaluateKinematics, FlangeGeometry2D, KinematicFrame } from './kinematics';

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
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): Point2D | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;

  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-9) return null;

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;

  const t = (dx * dby - dy * dbx) / denom;
  const u = (dx * day - dy * dax) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: a1.x + t * dax,
      y: a1.y + t * day,
    };
  }
  return null;
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
 * Exact 2D polygon intersection & clearance test (supports concave polygons).
 * Uses a 0.28mm inset test to distinguish true solid penetration from flush tangent contact.
 */
function testPolygonIntersection(
  polyA: Point2D[],
  polyB: Point2D[]
): { intersecting: boolean; clearanceMm: number; contactPoint: Point2D } {
  const coreA = insetPolygon(polyA, 0.28);
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
    let maxDepth = 0.3;
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
      if (minEdgeDist + 0.28 > maxDepth) {
        maxDepth = minEdgeDist + 0.28;
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

/**
 * Returns a trimmed polygon for an active flange so the legitimate forming zone
 * inside the V-die / under the punch tip does not create false-positive collisions.
 */
function trimActiveFlangePolygon(
  flange: FlangeGeometry2D,
  trimFromStartMm: number,
  thicknessMm: number
): Point2D[] | null {
  if (!flange.isActiveFlange) return flange.polygon;
  const remainingTrim = Math.max(0, trimFromStartMm - flange.startTrimMm);
  if (flange.lengthMm <= remainingTrim + 2.0) return null;

  const newStart: Point2D = {
    x: flange.start.x + flange.dir.x * remainingTrim,
    y: flange.start.y + flange.dir.y * remainingTrim,
  };
  const halfT = thicknessMm * 0.5;
  return [
    { x: newStart.x - flange.normal.x * halfT, y: newStart.y - flange.normal.y * halfT },
    { x: flange.end.x - flange.normal.x * halfT, y: flange.end.y - flange.normal.y * halfT },
    { x: flange.end.x + flange.normal.x * halfT, y: flange.end.y + flange.normal.y * halfT },
    { x: newStart.x + flange.normal.x * halfT, y: newStart.y + flange.normal.y * halfT },
  ];
}

export function buildObstaclePolygons(
  frame: KinematicFrame,
  punch: PunchTool,
  die: DieTool,
  punchReversed: boolean,
  machine: PressMachineSpec = DEFAULT_MACHINE
): {
  punchPoly: Point2D[];
  ramPoly: Point2D[];
  diePoly: Point2D[];
  tablePoly: Point2D[];
  backgaugePoly: Point2D[];
  throatPoly: Point2D[];
} {
  const xSign = punchReversed ? -1 : 1;
  const punchPoly = punch.profile2D.map((p) => ({
    x: p.x * xSign,
    y: p.y + frame.punchTipY,
  }));

  // Match real Promecam quick-clamp bar (±23 mm × 24 mm) + Ermaksan upper ram (±34 mm)
  const ramBottomY = frame.punchTipY + punch.heightMm;
  const ramPoly: Point2D[] = [
    { x: -23, y: ramBottomY },
    { x: 23, y: ramBottomY },
    { x: 23, y: ramBottomY + 24 },
    { x: 34, y: ramBottomY + 24 },
    { x: 34, y: ramBottomY + 260 },
    { x: -34, y: ramBottomY + 260 },
    { x: -34, y: ramBottomY + 24 },
    { x: -23, y: ramBottomY + 24 },
  ];

  const diePoly = die.profile2D.map((p) => ({ x: p.x, y: p.y }));

  // Match real 90 mm die holder rail (±45 mm × 25 mm) + 120 mm lower bed (±60 mm)
  const tableTopY = -die.heightMm;
  const halfRail = Math.max(40, machine.tableWidthMm * 0.5);
  const halfBed = Math.max(60, halfRail + 15);
  const tablePoly: Point2D[] = [
    { x: -halfRail, y: tableTopY },
    { x: halfRail, y: tableTopY },
    { x: halfRail, y: tableTopY - 25 },
    { x: halfBed, y: tableTopY - 25 },
    { x: halfBed, y: tableTopY - 220 },
    { x: -halfBed, y: tableTopY - 220 },
    { x: -halfBed, y: tableTopY - 25 },
    { x: -halfRail, y: tableTopY - 25 },
  ];

  const bgFrontX = frame.backgaugeXMm - 1.0;
  const bgY = frame.backgaugeRMm;
  const backgaugePoly: Point2D[] = [
    { x: bgFrontX - 45, y: bgY - 8 },
    { x: bgFrontX, y: bgY - 8 },
    { x: bgFrontX, y: bgY + 10 },
    { x: bgFrontX - 45, y: bgY + 10 },
  ];

  // Ermaksan C-frame throat rear wall at x = -throatDepthMm (-410 mm)
  const throatX = -machine.throatDepthMm;
  const throatPoly: Point2D[] = [
    { x: throatX - 240, y: -300 },
    { x: throatX, y: -300 },
    { x: throatX, y: machine.daylightMm },
    { x: throatX - 240, y: machine.daylightMm },
  ];

  return { punchPoly, ramPoly, diePoly, tablePoly, backgaugePoly, throatPoly };
}

function getCollisionLabel(type: CollisionTargetType, flangeIdx: number): string {
  const f = `Ramię S${flangeIdx + 1}`;
  switch (type) {
    case 'punch':
      return `${f}: Kolizja ze stemplem / belką górną`;
    case 'die':
      return `${f}: Kolizja z matrycą V`;
    case 'table':
      return `${f}: Kolizja ze stołem dolnym prasy`;
    case 'backgauge':
      return `${f}: Kolizja ze zderzakiem tylnym`;
    case 'throat':
      return `${f}: Kolizja z gardzielą C korpusu prasy`;
    case 'self':
      return `${f}: Samokolizja blachy`;
  }
}

/**
 * Checks a single instantaneous KinematicFrame for all geometric collisions.
 */
export function detectFrameCollisions(
  frame: KinematicFrame,
  part: PartDefinition,
  punch: PunchTool,
  die: DieTool,
  punchReversed: boolean,
  machine: PressMachineSpec = DEFAULT_MACHINE
): CollisionEvent[] {
  const obstacles = buildObstaclePolygons(frame, punch, die, punchReversed, machine);
  const events: CollisionEvent[] = [];
  const t = part.thicknessMm;
  const activeBend = part.bends[frame.activeBendIndex];

  // Clear the active forming zone inside the V-die and around the punch tip bevel
  const halfThetaRad = ((frame.currentBendAngleDeg * 0.5) * Math.PI) / 180;
  const cosHalf = Math.max(0.28, Math.cos(halfThetaRad));
  const halfV = die.vOpeningMm * 0.5;
  const punchTipWidthHalf = punch.type === 'acute' ? 7.5 : 10.5;

  const punchTrim = Math.max(die.vOpeningMm * 0.78, punchTipWidthHalf / cosHalf + t * 0.75, 14.0);
  const dieTrim = Math.max(halfV / cosHalf + t * 0.75, die.vOpeningMm * 0.78, 14.0);

  const checkAgainst = (
    flange: FlangeGeometry2D,
    polyA: Point2D[],
    polyB: Point2D[],
    type: CollisionTargetType,
    warnThresholdMm = 2.5
  ) => {
    const res = testPolygonIntersection(polyA, polyB);
    if (res.intersecting && -res.clearanceMm > 0.45) {
      events.push({
        id: `${frame.stepOrderIndex}-${flange.flangeIndex}-${type}`,
        stepOrderIndex: frame.stepOrderIndex,
        bendIndex: frame.activeBendIndex,
        bendLabel: activeBend.label,
        severity: 'critical',
        type,
        flangeIndex: flange.flangeIndex,
        strokeProgress: frame.strokeProgress,
        angleAtCollisionDeg: Number(frame.currentBendAngleDeg.toFixed(1)),
        penetrationMm: Number((-res.clearanceMm).toFixed(2)),
        clearanceMm: Number(res.clearanceMm.toFixed(2)),
        contactPointMm: res.contactPoint,
        message: getCollisionLabel(type, flange.flangeIndex),
      });
    } else if (!res.intersecting && res.clearanceMm < warnThresholdMm) {
      // Flat sheet resting flush on V-die shoulder plane y=0 is normal operation
      if (type === 'die' && res.contactPoint.y >= -0.4) return;
      if (flange.isActiveFlange && (type === 'punch' || type === 'die')) return;
      // Backgauge finger touching rear sheet edge during gauging (u <= 0.18) is intentional
      if (type === 'backgauge' && frame.strokeProgress <= 0.18) return;

      events.push({
        id: `${frame.stepOrderIndex}-${flange.flangeIndex}-${type}-warn`,
        stepOrderIndex: frame.stepOrderIndex,
        bendIndex: frame.activeBendIndex,
        bendLabel: activeBend.label,
        severity: 'warning',
        type,
        flangeIndex: flange.flangeIndex,
        strokeProgress: frame.strokeProgress,
        angleAtCollisionDeg: Number(frame.currentBendAngleDeg.toFixed(1)),
        penetrationMm: 0,
        clearanceMm: Number(res.clearanceMm.toFixed(2)),
        contactPointMm: res.contactPoint,
        message: `${getCollisionLabel(type, flange.flangeIndex)} (mały prześwit: ${res.clearanceMm.toFixed(1)} mm)`,
      });
    }
  };

  for (const flange of frame.flanges) {
    // 1. Punch & Upper Ram check
    const polyForPunch = trimActiveFlangePolygon(flange, punchTrim, t);
    if (polyForPunch) {
      checkAgainst(flange, polyForPunch, obstacles.punchPoly, 'punch', 2.0);
      checkAgainst(flange, polyForPunch, obstacles.ramPoly, 'punch', 2.5);
    }

    // 2. V-Die & Lower Table check
    const polyForDie = trimActiveFlangePolygon(flange, dieTrim, t);
    if (polyForDie) {
      checkAgainst(flange, polyForDie, obstacles.diePoly, 'die', 1.5);
      checkAgainst(flange, polyForDie, obstacles.tablePoly, 'table', 2.5);
    }

    // 3. Backgauge check (only non-active flanges during stroke)
    if (!flange.isActiveFlange) {
      checkAgainst(flange, flange.polygon, obstacles.backgaugePoly, 'backgauge', 1.5);
    }

    // 4. C-frame Throat depth check when sheet width exceeds distance between columns (3600 mm)
    if (part.widthMm > machine.distanceBetweenColumnsMm) {
      checkAgainst(flange, flange.polygon, obstacles.throatPoly, 'throat', 3.0);
    }
  }

  // 4. Self-collision check between non-adjacent flanges
  for (let i = 0; i < frame.flanges.length; i++) {
    for (let j = i + 1; j < frame.flanges.length; j++) {
      const fA = frame.flanges[i];
      const fB = frame.flanges[j];
      if (Math.abs(fA.flangeIndex - fB.flangeIndex) <= 1) continue;
      const res = testPolygonIntersection(fA.polygon, fB.polygon);
      if (res.intersecting && -res.clearanceMm > 0.4) {
        events.push({
          id: `${frame.stepOrderIndex}-${fA.flangeIndex}-${fB.flangeIndex}-self`,
          stepOrderIndex: frame.stepOrderIndex,
          bendIndex: frame.activeBendIndex,
          bendLabel: activeBend.label,
          severity: 'critical',
          type: 'self',
          flangeIndex: fA.flangeIndex,
          strokeProgress: frame.strokeProgress,
          angleAtCollisionDeg: Number(frame.currentBendAngleDeg.toFixed(1)),
          penetrationMm: Number((-res.clearanceMm).toFixed(2)),
          clearanceMm: Number(res.clearanceMm.toFixed(2)),
          contactPointMm: res.contactPoint,
          message: `Samokolizja blachy: S${fA.flangeIndex + 1} ↔ S${fB.flangeIndex + 1}`,
        });
      }
    }
  }

  return events;
}

/**
 * Sweeps the full bending stroke u in [0, 1] for every step in the sequence
 * and aggregates worst-case collisions per step.
 */
export function simulateFullSequenceCollisions(
  part: PartDefinition,
  material: SheetMaterial,
  punch: PunchTool,
  die: DieTool,
  steps: BendStepConfig[],
  compensateSpringback: boolean,
  punchReversed: boolean,
  customKFactor?: number,
  sampleCount = 22,
  machine: PressMachineSpec = DEFAULT_MACHINE
): StepSimulationReport[] {
  const reports: StepSimulationReport[] = [];

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const worstMap = new Map<string, CollisionEvent>();
    let firstFrame: KinematicFrame | null = null;
    let lastFrame: KinematicFrame | null = null;
    let maxPenetrationMm = 0;
    let minClearanceMm = 999;

    for (let s = 0; s <= sampleCount; s++) {
      const u = s / sampleCount;
      const frame = evaluateKinematics(
        part,
        material,
        punch,
        die,
        steps,
        stepIdx,
        u,
        compensateSpringback,
        customKFactor
      );
      if (s === 0) firstFrame = frame;
      lastFrame = frame;

      const evs = detectFrameCollisions(frame, part, punch, die, punchReversed, machine);
      for (const ev of evs) {
        if (ev.penetrationMm > maxPenetrationMm) {
          maxPenetrationMm = ev.penetrationMm;
        }
        if (ev.clearanceMm < minClearanceMm) {
          minClearanceMm = ev.clearanceMm;
        }
        const key = `${ev.flangeIndex}-${ev.type}-${ev.severity}`;
        const prev = worstMap.get(key);
        if (!prev || ev.penetrationMm > prev.penetrationMm) {
          worstMap.set(key, ev);
        }
      }
    }

    // Deduplicate: if a (flange, type) has a critical collision, drop its warning entry
    const finalEvents: CollisionEvent[] = [];
    const allEvs = Array.from(worstMap.values());
    for (const ev of allEvs) {
      if (
        ev.severity === 'warning' &&
        allEvs.some(
          (other) =>
            other.severity === 'critical' &&
            other.flangeIndex === ev.flangeIndex &&
            other.type === ev.type
        )
      ) {
        continue;
      }
      finalEvents.push(ev);
    }

    finalEvents.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.penetrationMm - a.penetrationMm;
    });

    const f = lastFrame!;
    const gaugeFrame = firstFrame ?? f;
    reports.push({
      stepOrderIndex: stepIdx,
      bendIndex: f.activeBendIndex,
      bendLabel: part.bends[f.activeBendIndex].label,
      flipHorizontal: f.flipHorizontal,
      upsideDown: f.upsideDown,
      springback: f.springback,
      collisions: finalEvents,
      maxPenetrationMm: Number(maxPenetrationMm.toFixed(2)),
      minClearanceMm: minClearanceMm === 999 ? 25 : Number(minClearanceMm.toFixed(2)),
      backgaugeXMm: gaugeFrame.backgaugeXMm,
      backgaugeRMm: gaugeFrame.backgaugeRMm,
      tonnageExceeded: f.springback.bendingForceKn > machine.maxForceKn,
      backgaugeOutOfRange: Math.abs(gaugeFrame.backgaugeXMm) > machine.backgaugeXMaxMm,
    });
  }

  return reports;
}
