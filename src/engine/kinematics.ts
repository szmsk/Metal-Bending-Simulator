import {
  BendStepConfig,
  DieTool,
  PartDefinition,
  Point2D,
  PunchTool,
  SheetMaterial,
  SpringbackAnalysis,
} from '../types/bending';
import { calculateSpringback } from './bendingMath';

const DEG_TO_RAD = Math.PI / 180;

export interface FlangeGeometry2D {
  flangeIndex: number;
  lengthMm: number;
  /** Centerline start and end in press brake world (X: +front/-back, Y: +up/-down) */
  start: Point2D;
  end: Point2D;
  /** Direction unit vector along flange from start to end */
  dir: Point2D;
  /** Normal unit vector pointing toward the "top/inside" side of the flat sheet */
  normal: Point2D;
  /** Centerline setback trimmed at the start end (closest to active bend) */
  startTrimMm: number;
  /** 4-corner thickness polygon (mm) for SAT collision detection */
  polygon: Point2D[];
  /** True if this flange is directly adjacent to the active bend in the V-die */
  isActiveFlange: boolean;
}

export interface BendArc2D {
  bendIndex: number;
  angleDeg: number;
  radiusMm: number;
  /** Outer and inner arc points for smooth 3D mesh extrusion */
  innerPoints: Point2D[];
  outerPoints: Point2D[];
  isActive: boolean;
}

export interface KinematicFrame {
  stepOrderIndex: number;
  activeBendIndex: number;
  strokeProgress: number;
  phase: 'approach' | 'bending' | 'springback';
  currentBendAngleDeg: number;
  targetBendAngleDeg: number;
  overbendAngleDeg: number;
  upsideDown: boolean;
  flipHorizontal: boolean;
  punchTipY: number;
  backgaugeXMm: number;
  backgaugeRMm: number;
  flanges: FlangeGeometry2D[];
  bendArcs: BendArc2D[];
  springback: SpringbackAnalysis;
}

/**
 * Determines which bends have already been folded prior to `stepOrderIndex`,
 * and whether the active bend requires flipping the part upside down.
 */
export function getStepOrientation(
  part: PartDefinition,
  steps: BendStepConfig[],
  stepOrderIndex: number
): {
  activeBendIndex: number;
  flipHorizontal: boolean;
  upsideDown: boolean;
  completedBends: Set<number>;
} {
  const step = steps[stepOrderIndex];
  const activeBendIndex = step.bendIndex;
  const targetSigned = part.bends[activeBendIndex].targetAngleDeg;
  const upsideDown = targetSigned < 0;

  const completedBends = new Set<number>();
  for (let i = 0; i < stepOrderIndex; i++) {
    completedBends.add(steps[i].bendIndex);
  }

  return {
    activeBendIndex,
    flipHorizontal: step.flipHorizontal,
    upsideDown,
    completedBends,
  };
}

/**
 * Evaluates the exact 2D cross-section geometry of the sheet metal, punch Y,
 * and CNC backgauge position for a given step and stroke progress u in [0, 1].
 */
export function evaluateKinematics(
  part: PartDefinition,
  material: SheetMaterial,
  punch: PunchTool,
  die: DieTool,
  steps: BendStepConfig[],
  stepOrderIndex: number,
  strokeProgress: number,
  compensateSpringback: boolean,
  customKFactor?: number
): KinematicFrame {
  const u = Math.max(0, Math.min(1, strokeProgress));
  const { activeBendIndex, flipHorizontal, upsideDown, completedBends } = getStepOrientation(
    part,
    steps,
    stepOrderIndex
  );

  const activeBend = part.bends[activeBendIndex];

  // Determine flange length facing the backgauge (-X) for gauge calculation
  const rawLeftLen = part.segmentLengthsMm
    .slice(0, activeBendIndex + 1)
    .reduce((a, b) => a + b, 0);
  const rawRightLen = part.segmentLengthsMm
    .slice(activeBendIndex + 1)
    .reduce((a, b) => a + b, 0);

  // If flipped horizontally, segment order reverses so right becomes -X (backgauge)
  const backgaugeFlangeEst = flipHorizontal ? rawRightLen : rawLeftLen;

  const springback = calculateSpringback(
    activeBendIndex,
    activeBend.targetAngleDeg,
    Math.min(
      backgaugeFlangeEst,
      flipHorizontal
        ? part.segmentLengthsMm[activeBendIndex + 1]
        : part.segmentLengthsMm[activeBendIndex]
    ),
    part,
    material,
    punch,
    die,
    customKFactor
  );

  const absTarget = Math.abs(activeBend.targetAngleDeg);
  const peakAngle = compensateSpringback ? springback.overbendAngleDeg : absTarget;
  const finalAngle = compensateSpringback ? absTarget : springback.uncompensatedAngleDeg;

  // Phase timing:
  // [0.00 - 0.16]: Punch approaches from top clearance (+52mm) down to sheet top (+t)
  // [0.16 - 0.82]: Bending stroke down to peakAngle (overbend)
  // [0.82 - 1.00]: Punch retracts slightly, sheet springs back from peakAngle -> finalAngle
  let phase: 'approach' | 'bending' | 'springback' = 'approach';
  let currentBendAngleDeg = 0;

  if (u <= 0.16) {
    phase = 'approach';
    currentBendAngleDeg = 0;
  } else if (u <= 0.82) {
    phase = 'bending';
    const bT = (u - 0.16) / (0.82 - 0.16);
    // Smooth ease-in-out curve for realistic hydraulic/servo press stroke
    const eased = bT < 0.5 ? 2 * bT * bT : 1 - Math.pow(-2 * bT + 2, 2) / 2;
    currentBendAngleDeg = peakAngle * eased;
  } else {
    phase = 'springback';
    const sT = (u - 0.82) / (1.0 - 0.82);
    const eased = 1 - Math.pow(1 - sT, 2);
    currentBendAngleDeg = peakAngle + (finalAngle - peakAngle) * eased;
  }

  const t = part.thicknessMm;
  const halfV = die.vOpeningMm * 0.5;
  const halfThetaRad = (currentBendAngleDeg * 0.5) * DEG_TO_RAD;

  // Outer bottom apex of active bend in V-die
  // When flat (theta=0), bottom of sheet rests on y=0.
  // As wings tilt by halfThetaRad, wings touch V-die shoulders at (±halfV, 0).
  const yOuterApex = -halfV * Math.tan(halfThetaRad);

  // Build ordered segment lengths & bend angles in current press orientation.
  // Press frame: +X = Front (Operator), -X = Rear (Backgauge).
  // When flipHorizontal=false: seg[0] is on the -X side, seg[N] is on the +X side.
  // When flipHorizontal=true: order reverses! seg[N] is on -X side, seg[0] is on +X side.
  const numSegs = part.segmentLengthsMm.length;
  const segIndices = Array.from({ length: numSegs }, (_, i) =>
    flipHorizontal ? numSegs - 1 - i : i
  );

  // Active bend position in the oriented chain
  const orientedActiveBendIdx = flipHorizontal
    ? numSegs - 2 - activeBendIndex
    : activeBendIndex;

  // Compute signed bend angle (in press frame, + = bends CCW / upward toward +Y when traveling +X)
  const getOrientedBendAngleDeg = (orientedBendPos: number): number => {
    const origBendIdx = flipHorizontal ? numSegs - 2 - orientedBendPos : orientedBendPos;
    if (origBendIdx === activeBendIndex) {
      return currentBendAngleDeg;
    }
    if (!completedBends.has(origBendIdx)) {
      return 0;
    }
    const rawTarget = part.bends[origBendIdx].targetAngleDeg;
    const rawMag = compensateSpringback
      ? Math.abs(rawTarget)
      : Math.max(0, Math.abs(rawTarget) - springback.springbackDeg * 0.85);
    const rawSign = rawTarget >= 0 ? 1 : -1;
    // Flipping upside down inverts all bend signs relative to press +Y.
    // Flipping horizontally (180° around Y) preserves +Y vs -Y bend sign!
    const effectiveSign = upsideDown ? -rawSign : rawSign;
    return effectiveSign * rawMag;
  };

  // Precompute tangent setbacks & effective centerline radii for every bend
  const numBends = Math.max(0, numSegs - 1);
  const setbacks: number[] = new Array(numBends).fill(0);
  const effRCenters: number[] = new Array(numBends).fill(0);
  const rCenterIdeal = springback.effectiveRadiusMm + t * 0.5;

  for (let b = 0; b < numBends; b++) {
    const angleDeg = getOrientedBendAngleDeg(b);
    const absTurn = Math.abs(angleDeg) * DEG_TO_RAD;
    if (absTurn >= 0.008) {
      setbacks[b] = rCenterIdeal * Math.tan(absTurn * 0.5);
    }
  }

  // Ensure combined bend setbacks never exceed straight segment length
  for (let oIdx = 0; oIdx < numSegs; oIdx++) {
    const segLen = part.segmentLengthsMm[segIndices[oIdx]];
    const leftTrim = oIdx > 0 ? setbacks[oIdx - 1] : 0;
    const rightTrim = oIdx < numBends ? setbacks[oIdx] : 0;
    const maxTotal = Math.max(0.2, segLen - 0.8);
    if (leftTrim + rightTrim > maxTotal && leftTrim + rightTrim > 0) {
      const scale = maxTotal / (leftTrim + rightTrim);
      if (oIdx > 0) setbacks[oIdx - 1] *= scale;
      if (oIdx < numBends) setbacks[oIdx] *= scale;
    }
  }

  for (let b = 0; b < numBends; b++) {
    const angleDeg = getOrientedBendAngleDeg(b);
    const absTurn = Math.abs(angleDeg) * DEG_TO_RAD;
    if (absTurn >= 0.008 && setbacks[b] > 0) {
      effRCenters[b] = setbacks[b] / Math.tan(absTurn * 0.5);
    }
  }

  // Centerline theoretical intersection at active bend:
  const centerApexY = yOuterApex + (t * 0.5) / Math.max(0.25, Math.cos(halfThetaRad));
  const activeCenter: Point2D = { x: 0, y: centerApexY };

  // Punch tip vertical position flush with inner curved bend surface
  const activeSetback = orientedActiveBendIdx >= 0 && orientedActiveBendIdx < numBends ? setbacks[orientedActiveBendIdx] : 0;
  const activeRCenter =
    orientedActiveBendIdx >= 0 && orientedActiveBendIdx < numBends && effRCenters[orientedActiveBendIdx] > 0
      ? effRCenters[orientedActiveBendIdx]
      : rCenterIdeal;
  const activeRIn = Math.max(0.2, activeRCenter - t * 0.5);
  const innerCurveY =
    halfThetaRad > 0.004
      ? centerApexY + activeRCenter / Math.max(0.25, Math.cos(halfThetaRad)) - activeRIn
      : t;

  let punchTipY = innerCurveY;
  if (u <= 0.16) {
    const aT = u / 0.16;
    const startY = 52 + t;
    punchTipY = startY + (t - startY) * (1 - Math.pow(1 - aT, 2));
  } else if (u > 0.82) {
    const sT = (u - 0.82) / (1.0 - 0.82);
    const peakHalfRad = (peakAngle * 0.5) * DEG_TO_RAD;
    const peakOuterApex = -halfV * Math.tan(peakHalfRad);
    const peakCenterApex = peakOuterApex + (t * 0.5) / Math.max(0.25, Math.cos(peakHalfRad));
    const peakInnerY =
      peakHalfRad > 0.004
        ? peakCenterApex + activeRCenter / Math.max(0.25, Math.cos(peakHalfRad)) - activeRIn
        : t;
    punchTipY = peakInnerY + 26 * sT;
  }

  const flanges: FlangeGeometry2D[] = [];
  const bendArcs: BendArc2D[] = [];

  const makeFlangePolygon = (
    p0: Point2D,
    p1: Point2D,
    nx: number,
    ny: number
  ): Point2D[] => {
    const halfT = t * 0.5;
    return [
      { x: p0.x - nx * halfT, y: p0.y - ny * halfT },
      { x: p1.x - nx * halfT, y: p1.y - ny * halfT },
      { x: p1.x + nx * halfT, y: p1.y + ny * halfT },
      { x: p0.x + nx * halfT, y: p0.y + ny * halfT },
    ];
  };

  // Helper to build smooth tangent-continuous arc connecting straightEnd -> nextStraightStart
  const createArc = (
    bendIdx: number,
    jointPt: Point2D,
    inDirAngle: number,
    turnRad: number,
    effSetback: number,
    effRCenter: number,
    isActive: boolean
  ): BendArc2D => {
    const absTurn = Math.abs(turnRad);
    if (absTurn < 0.008 || effSetback <= 0 || effRCenter <= 0) {
      return {
        bendIndex: bendIdx,
        angleDeg: 0,
        radiusMm: springback.effectiveRadiusMm,
        innerPoints: [],
        outerPoints: [],
        isActive,
      };
    }

    const sign = turnRad >= 0 ? 1 : -1;
    // Center of curvature sits effRCenter perpendicular to tangentIn
    const cNormalAngle = inDirAngle + sign * (Math.PI * 0.5);
    const arcCenter: Point2D = {
      x: jointPt.x - Math.cos(inDirAngle) * effSetback + Math.cos(cNormalAngle) * effRCenter,
      y: jointPt.y - Math.sin(inDirAngle) * effSetback + Math.sin(cNormalAngle) * effRCenter,
    };

    const innerPoints: Point2D[] = [];
    const outerPoints: Point2D[] = [];
    const stepsArc = Math.max(12, Math.round((absTurn / DEG_TO_RAD) / 4));
    const startAngle = cNormalAngle + Math.PI;
    const rIn = Math.max(0.2, effRCenter - t * 0.5);
    const rOut = effRCenter + t * 0.5;

    for (let s = 0; s <= stepsArc; s++) {
      const a = startAngle + (turnRad * s) / stepsArc;
      innerPoints.push({
        x: arcCenter.x + Math.cos(a) * rIn,
        y: arcCenter.y + Math.sin(a) * rIn,
      });
      outerPoints.push({
        x: arcCenter.x + Math.cos(a) * rOut,
        y: arcCenter.y + Math.sin(a) * rOut,
      });
    }

    return {
      bendIndex: bendIdx,
      angleDeg: turnRad / DEG_TO_RAD,
      radiusMm: Math.max(0.2, effRCenter - t * 0.5),
      innerPoints,
      outerPoints,
      isActive,
    };
  };

  // 1. Walk RIGHT (+X side: from orientedActiveBendIdx + 1 up to numSegs - 1)
  let jointPt: Point2D = { ...activeCenter };
  let currAngle = halfThetaRad; // Tilted up-right

  for (let oIdx = orientedActiveBendIdx + 1; oIdx < numSegs; oIdx++) {
    const origSegIdx = segIndices[oIdx];
    const fullLen = part.segmentLengthsMm[origSegIdx];
    const dir = { x: Math.cos(currAngle), y: Math.sin(currAngle) };
    const normal = { x: -dir.y, y: dir.x }; // +Y when currAngle=0

    const startTrim = setbacks[oIdx - 1] ?? 0;
    const endTrim = oIdx < numBends ? (setbacks[oIdx] ?? 0) : 0;

    const straightStart: Point2D = {
      x: jointPt.x + dir.x * startTrim,
      y: jointPt.y + dir.y * startTrim,
    };
    const nextJointPt: Point2D = {
      x: jointPt.x + dir.x * fullLen,
      y: jointPt.y + dir.y * fullLen,
    };
    const straightEnd: Point2D = {
      x: nextJointPt.x - dir.x * endTrim,
      y: nextJointPt.y - dir.y * endTrim,
    };
    const straightLen = Math.hypot(straightEnd.x - straightStart.x, straightEnd.y - straightStart.y);

    flanges.push({
      flangeIndex: origSegIdx,
      lengthMm: straightLen,
      start: straightStart,
      end: straightEnd,
      dir,
      normal,
      startTrimMm: startTrim,
      polygon: makeFlangePolygon(straightStart, straightEnd, normal.x, normal.y),
      isActiveFlange: oIdx === orientedActiveBendIdx + 1,
    });

    jointPt = nextJointPt;
    if (oIdx < numBends) {
      const bendAngleDeg = getOrientedBendAngleDeg(oIdx);
      const turnRad = bendAngleDeg * DEG_TO_RAD;
      const origBendIdx = flipHorizontal ? numSegs - 2 - oIdx : oIdx;
      const arc = createArc(
        origBendIdx,
        jointPt,
        currAngle,
        turnRad,
        setbacks[oIdx],
        effRCenters[oIdx],
        false
      );
      bendArcs.push(arc);
      currAngle += turnRad;
    }
  }

  // 2. Walk LEFT (-X side: from orientedActiveBendIdx down to 0)
  jointPt = { ...activeCenter };
  // Walking left: base direction is PI - halfThetaRad (up-left)
  currAngle = Math.PI - halfThetaRad;

  for (let oIdx = orientedActiveBendIdx; oIdx >= 0; oIdx--) {
    const origSegIdx = segIndices[oIdx];
    const fullLen = part.segmentLengthsMm[origSegIdx];
    const dir = { x: Math.cos(currAngle), y: Math.sin(currAngle) };
    // Consistent "top" normal when walking left: (+sin, -cos) -> (0, +1) when angle=PI
    const normal = { x: dir.y, y: -dir.x };

    const startTrim = setbacks[oIdx] ?? 0;
    const endTrim = oIdx > 0 ? (setbacks[oIdx - 1] ?? 0) : 0;

    const straightStart: Point2D = {
      x: jointPt.x + dir.x * startTrim,
      y: jointPt.y + dir.y * startTrim,
    };
    const nextJointPt: Point2D = {
      x: jointPt.x + dir.x * fullLen,
      y: jointPt.y + dir.y * fullLen,
    };
    const straightEnd: Point2D = {
      x: nextJointPt.x - dir.x * endTrim,
      y: nextJointPt.y - dir.y * endTrim,
    };
    const straightLen = Math.hypot(straightEnd.x - straightStart.x, straightEnd.y - straightStart.y);

    flanges.push({
      flangeIndex: origSegIdx,
      lengthMm: straightLen,
      start: straightStart,
      end: straightEnd,
      dir,
      normal,
      startTrimMm: startTrim,
      polygon: makeFlangePolygon(straightStart, straightEnd, normal.x, normal.y),
      isActiveFlange: oIdx === orientedActiveBendIdx,
    });

    jointPt = nextJointPt;
    if (oIdx > 0) {
      const bendPos = oIdx - 1;
      const bendAngleDeg = getOrientedBendAngleDeg(bendPos);
      // Walking left, a positive (+Y) bend turns CW (negative angle change)
      const turnRad = -bendAngleDeg * DEG_TO_RAD;
      const origBendIdx = flipHorizontal ? numSegs - 2 - bendPos : bendPos;
      const arc = createArc(
        origBendIdx,
        jointPt,
        currAngle,
        turnRad,
        setbacks[bendPos],
        effRCenters[bendPos],
        false
      );
      bendArcs.push(arc);
      currAngle += turnRad;
    }
  }

  // Active bend arc right at (0, centerApexY)
  const activeArc = createArc(
    activeBendIndex,
    activeCenter,
    -halfThetaRad,
    2 * halfThetaRad,
    activeSetback,
    activeRCenter,
    true
  );
  bendArcs.push(activeArc);

  // Backgauge X position: touches the farthest rear (-X) edge of the initial flat or rear bend outer arc
  const leftFlanges = flanges.filter((f) => f.end.x < -0.5 || f.start.x < -0.5);
  let minRearX = -25;
  for (const f of leftFlanges) {
    minRearX = Math.min(minRearX, f.start.x, f.end.x);
  }
  for (const arc of bendArcs) {
    for (const p of arc.outerPoints) {
      if (p.x < -0.5) minRearX = Math.min(minRearX, p.x);
    }
    for (const p of arc.innerPoints) {
      if (p.x < -0.5) minRearX = Math.min(minRearX, p.x);
    }
  }
  const gaugedX = Math.min(-12, minRearX - t * 0.5 - 0.4);
  const retractOffset = u > 0.16 ? 18 * Math.min(1, (u - 0.16) / 0.2) : 0;
  const backgaugeXMm = Number((gaugedX - retractOffset).toFixed(1));
  const backgaugeRMm = Number((t * 0.5 + 2).toFixed(1));

  // Sort flanges by flangeIndex for deterministic rendering & lookup
  flanges.sort((a, b) => a.flangeIndex - b.flangeIndex);

  return {
    stepOrderIndex,
    activeBendIndex,
    strokeProgress: u,
    phase,
    currentBendAngleDeg,
    targetBendAngleDeg: absTarget,
    overbendAngleDeg: springback.overbendAngleDeg,
    upsideDown,
    flipHorizontal,
    punchTipY,
    backgaugeXMm,
    backgaugeRMm,
    flanges,
    bendArcs,
    springback,
  };
}
