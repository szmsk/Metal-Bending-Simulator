import {
  DieTool,
  PartDefinition,
  PunchTool,
  SheetMaterial,
  SpringbackAnalysis,
} from '../types/bending';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Converts internal deflection/turn angle (e.g. 53°) to IronCAD / CNC included angle (127°). */
export function turnToIncludedAngleDeg(turnAngleDeg: number): number {
  return Number(Math.max(5, Math.min(180, 180 - Math.abs(turnAngleDeg))).toFixed(2));
}

/** Converts IronCAD / CNC included angle (e.g. 127°) + direction sign (+1/-1) to internal signed turn angle. */
export function includedToTurnAngleDeg(includedAngleDeg: number, sign: 1 | -1 = 1): number {
  const turn = Math.max(5, Math.min(150, 180 - Math.abs(includedAngleDeg)));
  return Number((sign * turn).toFixed(2));
}

/**
 * Computes effective inside bend radius in air bending.
 * In air bending, the natural radius is approximately 16% of the V-die opening,
 * bounded below by the punch tip radius and slightly adjusted by material ductility.
 */
export function computeAirBendRadius(
  die: DieTool,
  punch: PunchTool,
  material: SheetMaterial,
  thicknessMm: number
): number {
  // Empirical air bending factor (~0.15 - 0.18 of V depending on tensile strength / yield ratio)
  const strengthFactor = 0.145 + 0.03 * Math.min(1.2, material.yieldStrengthMPa / 300);
  const naturalRadius = die.vOpeningMm * strengthFactor;
  const minPhysical = Math.max(punch.tipRadiusMm, thicknessMm * 0.5);
  return Math.max(minPhysical, naturalRadius);
}

/**
 * Computes dynamic K-Factor based on inside bend radius to thickness ratio (R_i / t)
 * and material properties (DIN 6935 / empirical sheet metal calibration).
 */
export function computeKFactor(
  insideRadiusMm: number,
  thicknessMm: number,
  baseKFactor: number
): number {
  const ratio = insideRadiusMm / Math.max(0.2, thicknessMm);
  // K shifts from ~0.33 for sharp bends toward 0.50 for large radius bends
  const geometricK = ratio < 1 ? 0.34 + 0.08 * ratio : Math.min(0.495, 0.42 + 0.05 * Math.log10(ratio));
  return Number((0.5 * baseKFactor + 0.5 * geometricK).toFixed(3));
}

/**
 * Advanced elastoplastic springback calculation combining:
 * 1. Gardiner's elastoplastic moment-curvature unloading formula
 * 2. Hollomon strain-hardening flow stress (sigma = sigma_y + K * eps^n)
 * 3. Air-bending V-die span elastic beam deflection contribution
 */
export function calculateSpringback(
  bendIndex: number,
  targetAngleDeg: number,
  flangeTowardBackgaugeMm: number,
  part: PartDefinition,
  material: SheetMaterial,
  punch: PunchTool,
  die: DieTool,
  customKFactor?: number
): SpringbackAnalysis {
  const t = Math.max(0.3, part.thicknessMm);
  const absAngle = Math.abs(targetAngleDeg);
  const alphaRad = absAngle * DEG_TO_RAD;

  const effectiveRadiusMm = computeAirBendRadius(die, punch, material, t);
  const kFactor = customKFactor ?? computeKFactor(effectiveRadiusMm, t, material.defaultKFactor);

  // Plane strain elastic modulus E' = E / (1 - nu^2)
  const ePrime = material.elasticModulusMPa / (1 - material.poissonRatio * material.poissonRatio);

  // Outer fiber engineering plastic strain at bend radius
  const strainOuter = t / (2 * effectiveRadiusMm + t);
  const effectiveStrain = Math.max(0.01, strainOuter * 0.65);

  // Hollomon work-hardened flow stress during bending
  const flowStressMPa =
    material.yieldStrengthMPa +
    0.42 * material.strengthCoeffK * Math.pow(effectiveStrain, material.hardeningExponentN);

  // Gardiner dimensionless parameter m = (sigma_eff * (R_i + t/2)) / (E' * t)
  const meanRadius = effectiveRadiusMm + t * 0.5;
  const u = (flowStressMPa * meanRadius) / (ePrime * t);

  // Air-bending V-span elastic curvature contribution calibrated to DIN 6935 press brake charts
  const spanMultiplier = 1 + 0.16 * Math.pow(die.vOpeningMm / t, 0.55);
  const gardinerDrop = Math.min(0.28, (3 * u - 4 * u * u * u) * spanMultiplier);

  // Total springback angle in degrees
  const springbackDeg = Math.max(
    0.2,
    Number((absAngle * gardinerDrop + 0.42 * (flowStressMPa / material.elasticModulusMPa) * 1000 * (absAngle / 90)).toFixed(2))
  );

  const overbendAngleDeg = Number((absAngle + springbackDeg).toFixed(2));
  const uncompensatedAngleDeg = Number(Math.max(0, absAngle - springbackDeg).toFixed(2));

  // Bend Allowance (BA) and Bend Deduction (BD)
  const bendAllowanceMm = Number((alphaRad * (effectiveRadiusMm + kFactor * t)).toFixed(3));
  const ossb = (effectiveRadiusMm + t) * Math.tan(alphaRad / 2);
  const bendDeductionMm = Number((2 * ossb - bendAllowanceMm).toFixed(3));

  // Air bending force F = (1.42 * Rm * t^2 * L) / (1000 * V) [kN]
  const bendingForceKn = Number(
    ((1.42 * material.tensileStrengthMPa * t * t * part.widthMm) / (1000 * die.vOpeningMm)).toFixed(1)
  );
  const forceTonsPerMeter = Number(
    (((1.42 * material.tensileStrengthMPa * t * t) / die.vOpeningMm) / 9.81).toFixed(1)
  );

  // Punch tip penetration depth below die shoulder plane (y=0) to reach overbendAngleDeg
  const halfOverbendRad = (overbendAngleDeg * 0.5) * DEG_TO_RAD;
  const halfDieSpan = die.vOpeningMm * 0.5 + die.shoulderRadiusMm * 0.5;
  const ramPenetrationMm = Number(
    (halfDieSpan * Math.tan(halfOverbendRad) + t * (1 / Math.cos(halfOverbendRad) - 1)).toFixed(2)
  );

  const recommendedVMm = Number((t <= 3 ? t * 8 : t * 10).toFixed(0));
  const flangeTooShort = flangeTowardBackgaugeMm < die.minFlangeMm;

  return {
    bendIndex,
    targetAngleDeg,
    springbackDeg,
    overbendAngleDeg,
    uncompensatedAngleDeg,
    effectiveRadiusMm: Number(effectiveRadiusMm.toFixed(2)),
    kFactor,
    bendAllowanceMm,
    bendDeductionMm,
    bendingForceKn,
    forceTonsPerMeter,
    ramPenetrationMm,
    recommendedVMm,
    backgaugeXMm: Number(flangeTowardBackgaugeMm.toFixed(1)),
    flangeTooShort,
  };
}

/**
 * Computes developed flat length of the entire sheet metal profile.
 */
export function calculateFlatDevelopedLength(
  part: PartDefinition,
  material: SheetMaterial,
  punch: PunchTool,
  die: DieTool
): {
  flatLengthMm: number;
  totalBendDeductionMm: number;
  bendPositionsFromStartMm: number[];
} {
  let sumSegments = 0;
  for (const len of part.segmentLengthsMm) {
    sumSegments += len;
  }

  let totalBD = 0;
  const bendPositionsFromStartMm: number[] = [];
  let runningPos = 0;

  for (let i = 0; i < part.bends.length; i++) {
    const bend = part.bends[i];
    const sb = calculateSpringback(
      i,
      bend.targetAngleDeg,
      part.segmentLengthsMm[i],
      part,
      material,
      punch,
      die
    );
    totalBD += sb.bendDeductionMm;
    runningPos += part.segmentLengthsMm[i] - sb.bendDeductionMm * 0.5;
    bendPositionsFromStartMm.push(Number(runningPos.toFixed(2)));
    runningPos -= sb.bendDeductionMm * 0.5;
  }

  return {
    flatLengthMm: Number((sumSegments - totalBD).toFixed(2)),
    totalBendDeductionMm: Number(totalBD.toFixed(2)),
    bendPositionsFromStartMm,
  };
}
