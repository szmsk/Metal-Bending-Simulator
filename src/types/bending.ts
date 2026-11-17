export interface SheetMaterial {
  id: string;
  name: string;
  code: string;
  /** Young's modulus E in MPa */
  elasticModulusMPa: number;
  /** Yield strength Re / Rp0.2 in MPa */
  yieldStrengthMPa: number;
  /** Ultimate tensile strength Rm in MPa */
  tensileStrengthMPa: number;
  /** Hollomon strength coefficient K in MPa */
  strengthCoeffK: number;
  /** Strain hardening exponent n */
  hardeningExponentN: number;
  /** Poisson's ratio */
  poissonRatio: number;
  /** Default K-Factor for neutral axis */
  defaultKFactor: number;
  /** PBR visual parameters */
  colorHex: number;
  metalness: number;
  roughness: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface PunchTool {
  id: string;
  name: string;
  code: string;
  type: 'straight' | 'gooseneck' | 'acute' | 'tall_gooseneck';
  tipAngleDeg: number;
  tipRadiusMm: number;
  heightMm: number;
  maxLoadKnPerM: number;
  /** 2D cross-section polygon in mm relative to punch tip (0,0), extending into +Y */
  profile2D: Point2D[];
  description: string;
}

export interface DieTool {
  id: string;
  name: string;
  code: string;
  vOpeningMm: number;
  vAngleDeg: number;
  shoulderRadiusMm: number;
  heightMm: number;
  widthMm: number;
  maxLoadKnPerM: number;
  minFlangeMm: number;
  /** 2D cross-section polygon in mm relative to top shoulder plane (y=0) */
  profile2D: Point2D[];
}

export interface BendDefinition {
  id: string;
  label: string;
  /** Signed bend angle in degrees (+ = upward in flat local frame, - = downward/reverse) */
  targetAngleDeg: number;
  /** Inside bend radius in mm (or 'auto' from V-die) */
  insideRadiusMm: number;
}

export interface PartDefinition {
  id: string;
  name: string;
  description: string;
  thicknessMm: number;
  widthMm: number;
  materialId: string;
  /** N+1 segment lengths in mm */
  segmentLengthsMm: number[];
  /** N bend definitions between adjacent segments */
  bends: BendDefinition[];
}

export interface BendStepConfig {
  bendIndex: number;
  /** Flip part horizontally 180 deg around Y (swaps operator side <-> backgauge side) */
  flipHorizontal: boolean;
}

export interface SpringbackAnalysis {
  bendIndex: number;
  targetAngleDeg: number;
  /** Calculated elastic springback angle Δα in degrees (always positive magnitude) */
  springbackDeg: number;
  /** Compensated overbend angle θ_overbend = |θ_target| + Δα */
  overbendAngleDeg: number;
  /** Resulting angle if springback is NOT compensated */
  uncompensatedAngleDeg: number;
  /** Effective inside bend radius after air bending */
  effectiveRadiusMm: number;
  /** Neutral axis K-factor */
  kFactor: number;
  /** Bend Allowance (BA) in mm */
  bendAllowanceMm: number;
  /** Bend Deduction (BD) in mm */
  bendDeductionMm: number;
  /** Bending force required in kN */
  bendingForceKn: number;
  /** Bending force per meter in t/m */
  forceTonsPerMeter: number;
  /** Ram bottom penetration depth into V-die (mm below y=0) */
  ramPenetrationMm: number;
  /** Recommended minimum V opening */
  recommendedVMm: number;
  /** Backgauge X position in mm (distance behind bend line) */
  backgaugeXMm: number;
  /** Minimum flange check warning */
  flangeTooShort: boolean;
}

export interface PressMachineSpec {
  id: string;
  manufacturer: string;
  model: string;
  bendingLengthMm: number;
  distanceBetweenColumnsMm: number;
  tonnageTons: number;
  maxForceKn: number;
  strokeMm: number;
  daylightMm: number;
  throatDepthMm: number;
  backgaugeXMaxMm: number;
  backgaugeXSpeedMmS: number;
  approachSpeedMmS: number;
  bendSpeedMmS: number;
  returnSpeedMmS: number;
  tableWidthMm: number;
  tableHeightMm: number;
  clampingSystem: string;
  cncController: string;
  hasCrowning: boolean;
}

export type CollisionTargetType = 'punch' | 'die' | 'table' | 'backgauge' | 'throat' | 'self';

export interface CollisionEvent {
  id: string;
  stepOrderIndex: number;
  bendIndex: number;
  bendLabel: string;
  severity: 'critical' | 'warning';
  type: CollisionTargetType;
  flangeIndex: number;
  /** Stroke normalized progress u in [0, 1] where deepest collision occurs */
  strokeProgress: number;
  /** Bend angle in degrees at moment of collision */
  angleAtCollisionDeg: number;
  /** Penetration depth in mm (positive = penetration, negative = near-miss clearance) */
  penetrationMm: number;
  /** Minimum clearance in mm (negative means penetration) */
  clearanceMm: number;
  /** Exact 2D contact point in press brake frame (mm) */
  contactPointMm: Point2D;
  message: string;
}

export interface StepSimulationReport {
  stepOrderIndex: number;
  bendIndex: number;
  bendLabel: string;
  flipHorizontal: boolean;
  /** Automatic upside-down flip needed when signed bend angle opposes previous side */
  upsideDown: boolean;
  springback: SpringbackAnalysis;
  collisions: CollisionEvent[];
  maxPenetrationMm: number;
  minClearanceMm: number;
  backgaugeXMm: number;
  backgaugeRMm: number;
  tonnageExceeded: boolean;
  backgaugeOutOfRange: boolean;
}

export interface SequenceCandidate {
  id: string;
  steps: BendStepConfig[];
  criticalCollisions: number;
  warningCount: number;
  flipCount: number;
  totalBackgaugeTravelMm: number;
  estimatedCycleSec: number;
  score: number;
  stepReports: StepSimulationReport[];
  isCurrent?: boolean;
}

export type WorkspaceTab = 'simulation' | 'springback' | 'tooling';
export type CameraPreset = 'iso' | 'side' | 'closeup' | 'top';
