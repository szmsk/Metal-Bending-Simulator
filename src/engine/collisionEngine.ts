import { DEFAULT_MACHINE } from '../data/library';
import { BendStepConfig, CollisionEvent, DieTool, PartDefinition, PressMachineSpec, PunchTool, SheetMaterial, StepSimulationReport } from '../types/bending';
import { evaluateKinematics, KinematicFrame } from './kinematics';
import { checkToolCoverage, detectFrameCollisions3D } from './collision3d';
export { testPolygonIntersection } from './polygon2d';
/** Compatibility entrypoint used by the viewport and reports. Uses finite 3D solids. */
export const detectFrameCollisions = detectFrameCollisions3D;

/** Largest observed geometric displacement between two stroke samples (mm). */
function frameMotionMm(a: KinematicFrame, b: KinematicFrame): number {
  let maximum = Math.max(
    Math.abs(a.punchTipY - b.punchTipY),
    Math.abs(a.backgaugeXMm - b.backgaugeXMm),
    Math.abs(a.backgaugeRMm - b.backgaugeRMm)
  );
  // Reparameterize arcs by normalized arclength. Their tessellation can change
  // from 12 to 13 vertices mid-stroke; comparing vertex indices would report
  // phantom jumps and falsely mark converged sampling as incomplete.
  const arcAt = (pts: {x:number;y:number}[], t: number) => {
    if (!pts.length) return null;
    const pos = t * (pts.length - 1);
    const lo = Math.floor(pos), hi = Math.min(pts.length - 1, lo + 1);
    const f = pos - lo;
    return {x:pts[lo].x*(1-f)+pts[hi].x*f,y:pts[lo].y*(1-f)+pts[hi].y*f};
  };
  for (let i = 0; i < Math.min(a.bendArcs.length, b.bendArcs.length); i++) {
    for (const side of ['innerPoints','outerPoints'] as const) {
      for (let j = 0; j <= 8; j++) {
        const pointA = arcAt(a.bendArcs[i][side], j/8);
        const pointB = arcAt(b.bendArcs[i][side], j/8);
        if (pointA && pointB)
          maximum = Math.max(maximum, Math.hypot(pointA.x-pointB.x,pointA.y-pointB.y));
      }
    }
  }
  for (let i = 0; i < a.flanges.length; i++) {
    const pa = a.flanges[i].polygon, pb = b.flanges[i].polygon;
    for (let j = 0; j < Math.min(pa.length, pb.length); j++) {
      maximum = Math.max(maximum, Math.hypot(pa[j].x - pb[j].x, pa[j].y - pb[j].y));
    }
  }
  return maximum;
}

/**
 * Adaptively samples each stroke phase. This catches much narrower transient
 * contacts than a fixed 20-frame evaluation. It is still discrete sampling,
 * NOT mathematically guaranteed continuous collision detection.
 */
export function sampleBendStroke(
  evaluate: (u: number) => KinematicFrame,
  initialCount = 20,
  maxMotionMm = 0.8,
  maxAngleDeg = 0.65
): { frames: KinematicFrame[]; converged: boolean } {
  const knots = new Set<number>([0, 0.16, 0.82, 1]);
  for (let i = 0; i <= Math.max(4, initialCount); i++) {
    knots.add(i / Math.max(4, initialCount));
  }
  const ordered = [...knots].sort((a, b) => a - b);
  const frames: KinematicFrame[] = [evaluate(ordered[0])];
  let converged = true;
  const refine = (start: KinematicFrame, finish: KinematicFrame, depth: number) => {
    const motion = frameMotionMm(start, finish);
    const angle = Math.abs(start.currentBendAngleDeg - finish.currentBendAngleDeg);
    if (motion > maxMotionMm || angle > maxAngleDeg) {
      if (depth >= 11) {
        converged = false;
      } else {
        const middle = evaluate((start.strokeProgress + finish.strokeProgress) / 2);
        refine(start, middle, depth + 1);
        refine(middle, finish, depth + 1);
        return;
      }
    }
    frames.push(finish);
  };
  for (let i = 1; i < ordered.length; i++) {
    refine(frames[frames.length - 1], evaluate(ordered[i]), 0);
  }
  return { frames, converged };
}

/**
 * Simulates the hand-ordered sequence using 3D prismatic solids at adaptive stroke steps.
 * Does not model arbitrary imported CAD meshes or certify the press configuration.
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
  sampleCount = 20,
  machine: PressMachineSpec = DEFAULT_MACHINE
): StepSimulationReport[] {
  const reports: StepSimulationReport[] = [];
  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const evaluate = (u: number) => evaluateKinematics(
      part, material, punch, die, steps, stepIdx, u, compensateSpringback, customKFactor
    );
    const { frames, converged } = sampleBendStroke(evaluate, sampleCount);
    const worstMap = new Map<string, CollisionEvent>();
    let maxPenetrationMm = 0;
    let minClearanceMm = Infinity;
    for (const frame of frames) {
      for (const ev of detectFrameCollisions(frame, part, punch, die, punchReversed, machine)) {
        maxPenetrationMm = Math.max(maxPenetrationMm, ev.penetrationMm);
        minClearanceMm = Math.min(minClearanceMm, ev.clearanceMm);
        const key = `${ev.flangeIndex}-${ev.type}-${ev.severity}-${ev.type === 'self' ? ev.message : ''}`;
        const prev = worstMap.get(key);
        if (!prev || ev.penetrationMm > prev.penetrationMm ||
          (ev.severity === 'warning' && ev.clearanceMm < prev.clearanceMm)) worstMap.set(key, ev);
      }
    }
    const all = [...worstMap.values()];
    const collisions = all.filter((ev) => ev.severity !== 'warning' || !all.some((hit) =>
      hit.severity === 'critical' && hit.type === ev.type && hit.flangeIndex === ev.flangeIndex
    )).sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.penetrationMm - a.penetrationMm;
    });
    const first = frames[0], last = frames[frames.length - 1];
    const coverage = checkToolCoverage(part, machine);
    const loadPerMeterKn = last.springback.bendingForceKn / Math.max(0.001, part.widthMm / 1000);
    reports.push({
      stepOrderIndex: stepIdx,
      bendIndex: last.activeBendIndex,
      bendLabel: part.bends[last.activeBendIndex].label,
      flipHorizontal: last.flipHorizontal,
      upsideDown: last.upsideDown,
      springback: last.springback,
      collisions,
      maxPenetrationMm: Number(maxPenetrationMm.toFixed(2)),
      minClearanceMm: minClearanceMm === Infinity ? 25 : Number(minClearanceMm.toFixed(2)),
      backgaugeXMm: first.backgaugeXMm,
      backgaugeRMm: first.backgaugeRMm,
      tonnageExceeded: last.springback.bendingForceKn > machine.maxForceKn,
      toolLoadExceeded: loadPerMeterKn > Math.min(punch.maxLoadKnPerM, die.maxLoadKnPerM),
      bendingLengthExceeded: part.widthMm > machine.bendingLengthMm,
      backgaugeOutOfRange: Math.abs(first.backgaugeXMm) > machine.backgaugeXMaxMm,
      checkedFrames: frames.length,
      samplingConverged: converged,
      toolingCoversSheetWidth: coverage.punch && coverage.die,
    });
  }
  return reports;
}

/**
 * Find the first physical contact (or penetration) with an unintended obstacle.
 * Diagnostic clearance warnings are deliberately ignored: the animation must
 * continue through 8 mm / 5 mm / 1 mm clearance until the metal touches.
 * Substeps + bisection find the contact frame to visual-model precision.
 * This is sampled collision detection, NOT certified continuous collision detection.
 */
export function findFirstBlockingFrame(
  evaluate: (u: number) => KinematicFrame,
  collisionAt: (frame: KinematicFrame) => CollisionEvent[],
  fromU: number,
  toU: number,
  maxStepU = 0.003,
): { frame: KinematicFrame; events: CollisionEvent[] } | null {
  const a = Math.max(0, Math.min(1, fromU));
  const b = Math.max(a, Math.min(1, toU));
  const steps = Math.max(1, Math.ceil((b - a) / Math.max(0.0005, maxStepU)));
  const isContact = (events: CollisionEvent[]) => events.some(e => e.severity === 'critical');
  const isNear = (events: CollisionEvent[]) => events.some(e =>
    e.severity === 'warning' && Number.isFinite(e.clearanceMm) && e.clearanceMm <= 1.0);
  const inspect = (u: number) => {
    const frame = evaluate(u);
    return { frame, events: collisionAt(frame) };
  };
  const refineTouch = (safeU: number, touchingU: number,
    initiallyTouching: ReturnType<typeof inspect>) => {
    let lo = safeU;
    let hi = touchingU;
    let hit = initiallyTouching;
    for (let j = 0; j < 14; j++) {
      const middle = (lo + hi) / 2;
      const trial = inspect(middle);
      if (isContact(trial.events)) {
        hit = trial;
        hi = middle;
      } else {
        lo = middle;
      }
    }
    return hit;
  };

  // Already at contact? Re-pressing Play must not penetrate the obstacle.
  let prior = inspect(a);
  if (isContact(prior.events)) return prior;
  for (let i = 1; i <= steps; i++) {
    const endU = a + (b-a)*i/steps;
    const next = inspect(endU);
    const middleU = (prior.frame.strokeProgress + endU)/2;
    const middle = inspect(middleU);
    // A contact can briefly appear and disappear as a bend rotates past a corner.
    // Do not assume that a positive end frame means the intervening motion was clear.
    const closeToObstacle = isNear(prior.events) || isNear(middle.events) || isNear(next.events) ||
      isContact(middle.events) || isContact(next.events);
    const subdiv = closeToObstacle ? 16 : 2;
    let safeU = prior.frame.strokeProgress;
    for (let j = 1; j <= subdiv; j++) {
      const u = prior.frame.strokeProgress + (endU-prior.frame.strokeProgress)*j/subdiv;
      const sample = subdiv === 2 && j === 1 ? middle : j === subdiv ? next : inspect(u);
      if (isContact(sample.events)) {
        return refineTouch(safeU, u, sample);
      }
      safeU = u;
    }
    prior = next;
  }
  return null;
}
