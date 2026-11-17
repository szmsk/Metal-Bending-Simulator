import { DEFAULT_MACHINE } from '../data/library';
import { getMachineZLayout, cFrameSectionMm } from './machineLayout';
import {
  CollisionEvent, CollisionTargetType, DieTool, PartDefinition, Point2D,
  PressMachineSpec, PunchTool,
} from '../types/bending';
import { KinematicFrame } from './kinematics';
import { intersectPrisms3D, outsideContactPocket, prism, Prism3D } from './prismatic3d';

type CollisionBody = Prism3D & { type: CollisionTargetType; formingContact?: boolean };
type SheetBody = Prism3D & { flangeIndex: number; isActive: boolean; bendsAt?: number[] };

function rectangle(xMin: number, yMin: number, xMax: number, yMax: number): Point2D[] {
  return [{x:xMin,y:yMin},{x:xMax,y:yMin},{x:xMax,y:yMax},{x:xMin,y:yMax}];
}

function settings(machine: PressMachineSpec) { return machine.collisionGeometry; }

/** Each solid has a finite depth in Z; machine columns live at the two ends, not at Z=0. */
export function buildMachineSolids3D(
  frame: KinematicFrame, part: PartDefinition,
  punch: PunchTool, die: DieTool, punchReversed: boolean,
  machine: PressMachineSpec = DEFAULT_MACHINE
): CollisionBody[] {
  const g = settings(machine);
  const partWidth = Math.max(1, part.widthMm);
  const toolSpan = Math.max(1, Math.min(machine.bendingLengthMm, g.toolLengthMm ?? Math.max(420, partWidth + 140)));
  const offset = g.toolOffsetZMm ?? 0;
  const defaultZ = [{ startMm: offset-toolSpan/2, endMm: offset+toolSpan/2 }];
  const punchStations = g.punchStationsZMm?.length ? g.punchStationsZMm : defaultZ;
  const dieStations = g.dieStationsZMm?.length ? g.dieStationsZMm : defaultZ;
  const body: CollisionBody[] = [];
  const add = (id: string, type: CollisionTargetType, shape: Point2D[], z0: number, z1: number, formingContact = false) => {
    if (z1-z0 <= 0.001 || shape.length < 3) return;
    body.push({ ...prism(id, shape, z0, z1), type, formingContact });
  };
  const punchProfile = punch.profile2D.map(p => ({x: punchReversed ? -p.x : p.x, y: p.y+frame.punchTipY}));
  punchStations.forEach((z,i) => add(`punch-${i}`, 'punch', punchProfile, z.startMm, z.endMm, true));
  dieStations.forEach((z,i) => add(`die-${i}`, 'die', die.profile2D, z.startMm, z.endMm, true));

  const halfLength = machine.bendingLengthMm/2;
  const machineLayout = getMachineZLayout(machine.bendingLengthMm, machine.distanceBetweenColumnsMm);
  const ramBase = frame.punchTipY+punch.heightMm;
  add('clamp', 'punch', rectangle(-g.clampHalfWidthMm,ramBase,g.clampHalfWidthMm,ramBase+24), -halfLength,halfLength);
  add('ram', 'punch',rectangle(-g.ramHalfWidthMm,ramBase+24,g.ramHalfWidthMm,ramBase+24+g.ramBodyHeightMm),-halfLength,halfLength);
  const tableTop = -die.heightMm;
  // These structural pieces visually terminate at the columns instead of cutting
  // through them. The same intervals are used in the rendered Three.js meshes.
  machineLayout.structuralRails.forEach((span, i) => {
    add(`die-holder-${i}`, 'table', rectangle(-g.dieHolderHalfWidthMm,tableTop-g.dieHolderHeightMm,g.dieHolderHalfWidthMm,tableTop),span.startMm,span.endMm);
    add(`bed-${i}`, 'table', rectangle(-g.bedHalfWidthMm,tableTop-g.dieHolderHeightMm-300,g.bedHalfWidthMm,tableTop-g.dieHolderHeightMm),span.startMm,span.endMm);
  });

  const fingerWidth = g.backgaugeFingerWidthMm ?? 22;
  const fingerSpread = g.backgaugeFingerSeparationMm ?? Math.min(3300,Math.max(80, partWidth*0.68));
  const bgX = frame.backgaugeXMm-1;
  const bgY = frame.backgaugeRMm-8;
  for (const sign of [-1,1]) {
    const z = sign*fingerSpread/2;
    add(`gauge-${sign}`,'backgauge',rectangle(bgX-g.backgaugeFingerDepthMm,bgY,bgX,bgY+g.backgaugeFingerHeightMm),z-fingerWidth/2,z+fingerWidth/2);
  }
  // Rear gauge bridge matches the 3D viewport's slender support rail (28 mm x 26 mm).
  add('gauge-bridge','backgauge',rectangle(frame.backgaugeXMm-56,frame.backgaugeRMm-13,frame.backgaugeXMm-28,frame.backgaugeRMm+13),
    -machine.distanceBetweenColumnsMm*0.475,machine.distanceBetweenColumnsMm*0.475);

  // Shared C-section profile: matched to the visible scene geometry.
  const throatX = -machine.throatDepthMm;
  const frameShape = cFrameSectionMm(machine.throatDepthMm);
  machineLayout.columns.forEach((span,i) => add(i===0?'left-column':'right-column','throat',frameShape,span.startMm,span.endMm));
  const header = machineLayout.topHeader;
  add('top-header','throat',rectangle(throatX-190,460,throatX+30,560),header.startMm,header.endMm);
  return body;
}

export function buildSheetSolids3D(frame: KinematicFrame, part: PartDefinition, machine: PressMachineSpec = DEFAULT_MACHINE): SheetBody[] {
  const zCenter = machine.collisionGeometry.partOffsetZMm ?? 0;
  const z0 = zCenter-part.widthMm/2, z1 = zCenter+part.widthMm/2;
  const solids: SheetBody[] = frame.flanges.map(f => ({
    ...prism(`flange-${f.flangeIndex}`, f.polygon,z0,z1),
    flangeIndex: f.flangeIndex, isActive: f.isActiveFlange,
  }));
  for (const arc of frame.bendArcs) {
    if (arc.innerPoints.length < 2 || arc.outerPoints.length < 2) continue;
    const shape = [...arc.innerPoints, ...[...arc.outerPoints].reverse()];
    solids.push({ ...prism(`arc-${arc.bendIndex}`,shape,z0,z1),
      flangeIndex: arc.bendIndex, isActive: arc.isActive, bendsAt: [arc.bendIndex, arc.bendIndex+1] });
  }
  return solids;
}

/** Tool spans must cover all Z coordinates of the requested bend line; otherwise
 * absence of a collision simply means part of the workpiece was not under the tool. */
export function checkToolCoverage(
  part: PartDefinition,
  machine: PressMachineSpec = DEFAULT_MACHINE
): { punch: boolean; die: boolean } {
  const g = machine.collisionGeometry;
  const length = Math.max(1, Math.min(machine.bendingLengthMm,
    g.toolLengthMm ?? Math.max(420, part.widthMm + 140)));
  const offset = g.toolOffsetZMm ?? 0;
  const fallback = [{ startMm: offset - length / 2, endMm: offset + length / 2 }];
  const z0 = (g.partOffsetZMm ?? 0) - part.widthMm / 2;
  const z1 = (g.partOffsetZMm ?? 0) + part.widthMm / 2;
  const covered = (segments: {startMm:number;endMm:number}[]) => {
    const sorted = [...segments].sort((a, b) => a.startMm - b.startMm);
    let cursor = z0;
    for (const segment of sorted) {
      if (segment.endMm <= cursor) continue;
      if (segment.startMm > cursor + 0.01) return false;
      cursor = Math.max(cursor, segment.endMm);
      if (cursor >= z1 - 0.01) return true;
    }
    return false;
  };
  return {
    punch: covered(g.punchStationsZMm?.length ? g.punchStationsZMm : fallback),
    die: covered(g.dieStationsZMm?.length ? g.dieStationsZMm : fallback),
  };
}

/**
 * Numerical touching tolerance for the *visual model*, in millimetres.
 * This is not a machine safety clearance. Do not stop at the larger
 * user-configurable diagnostic warning distance (e.g. 8 mm).
 */
export const CONTACT_TOLERANCE_MM = 0.01;

function label(type: CollisionTargetType, idx: number, obstacle: string) {
  const segment = `S${idx+1}`;
  const labels: Record<CollisionTargetType,string> = {
    punch:'stempel / mocowanie / belka',die:'matryca',table:'stół / obsada matrycy',
    backgauge:'zderzak / belka zderzaka',throat:'korpus boczny / górna belka',self:'samokolizja blachy',
  };
  return `${segment}: ${labels[type]} (${obstacle})`;
}

/**
 * Physical 3D-volume test for finite prismatic bodies. The X/Y profile is extruded
 * along the machine Z axis, so this supports actual width, station positioning and
 * gaps between tool segments. Other arbitrary 3D forms/rotations are not supported.
 */
export function detectFrameCollisions3D(
  frame: KinematicFrame, part: PartDefinition, punch: PunchTool, die: DieTool,
  punchReversed: boolean, machine: PressMachineSpec = DEFAULT_MACHINE,
  allowFormingContacts = true,
): CollisionEvent[] {
  const sheets = buildSheetSolids3D(frame,part,machine);
  const obstacles = buildMachineSolids3D(frame,part,punch,die,punchReversed,machine);
  const events: CollisionEvent[] = [];
  const add = (sheet: SheetBody, type: CollisionTargetType, obstacleId: string,
    result: ReturnType<typeof intersectPrisms3D>, warnThreshold: number, message?: string) => {
    // Stop at first non-forming *touch*, not after 0.20 mm penetration,
    // and never because a diagnostic clearance threshold was crossed.
    const critical = result.intersecting ||
      (result.clearanceMm >= 0 && result.clearanceMm <= CONTACT_TOLERANCE_MM);
    if (!critical && !(result.clearanceMm >= 0 && result.clearanceMm < warnThreshold)) return;
    events.push({
      id:`${frame.stepOrderIndex}-${sheet.id}-${obstacleId}-${critical?'hit':'near'}`,
      stepOrderIndex:frame.stepOrderIndex,
      bendIndex:frame.activeBendIndex,
      bendLabel:part.bends[frame.activeBendIndex].label,
      severity:critical?'critical':'warning',type,
      flangeIndex:sheet.flangeIndex,strokeProgress:frame.strokeProgress,
      angleAtCollisionDeg:Number(frame.currentBendAngleDeg.toFixed(1)),
      penetrationMm:Number((critical?result.penetrationMm:0).toFixed(2)),
      clearanceMm:Number(result.clearanceMm.toFixed(2)),
      contactPointMm:{x:result.point.x,y:result.point.y},
      contactPoint3Dmm:result.point,
      overlapWidthMm:Number(result.overlapWidthMm.toFixed(2)),
      message: critical
        ? `${result.intersecting ? 'Przecięcie modelu' : 'Kontakt materiału'} 3D: ${label(type,sheet.flangeIndex,obstacleId)}`
        : (message ?? `Mały prześwit 3D: ${label(type,sheet.flangeIndex,obstacleId)}`),
    });
  };
  for (const sheet of sheets) {
    for (const obstacle of obstacles) {
      // Forming contact is the only permitted intersection during bending.
      // All support structures, gauge fingers, frame and other flanges remain fully checked.
      const isContact = allowFormingContacts && sheet.isActive && obstacle.formingContact;
      let profiles = [sheet.section];
      if (isContact) {
        const xEdge = die.vOpeningMm/2 + die.shoulderRadiusMm + part.thicknessMm;
        const yBottom = -Math.max(die.vOpeningMm, 35);
        const yTop = part.thicknessMm + 3;
        profiles = outsideContactPocket(sheet.section,-xEdge,xEdge,yBottom,yTop);
      }
      for (const [index,poly] of profiles.entries()) {
        const clipped = {...sheet, section:poly, id:`${sheet.id}-${index}`};
        const result = intersectPrisms3D(clipped,obstacle);
        // The previous (already bent) wall of a C profile can approach the
        // punch even when a schematic 12.5 mm straight tool misses it. Warn
        // against assuming clearance is confirmed without measured tooling.
        const previousFlange = !sheet.isActive && frame.stepOrderIndex > 0;
        const isUpperTool = obstacle.type === 'punch';
        const diagnosticMargin = Math.max(0, Math.min(30,
          machine.collisionGeometry.minimumFreeClearanceMm ?? 8));
        const risk = previousFlange && isUpperTool && !isContact;
        const threshold = risk ? diagnosticMargin : obstacle.type==='backgauge'?1.5:2.5;
        if (isContact && !result.intersecting && result.clearanceMm < threshold) continue;
        if (allowFormingContacts && obstacle.type==='backgauge' && frame.strokeProgress<=0.16 && !result.intersecting) continue;
        const uncertain = risk && !result.intersecting && result.clearanceMm > 0 && result.clearanceMm < diagnosticMargin;
        add(clipped,obstacle.type,obstacle.id,result,threshold,
          uncertain
            ? `Mały prześwit: ${label(obstacle.type, sheet.flangeIndex, obstacle.id)}. Model: ${result.clearanceMm.toFixed(2)} mm, margines diagnostyczny: ${diagnosticMargin.toFixed(1)} mm. Gięcie trwa do kontaktu; sprawdź rzeczywistą geometrię stempla i uchwytu.`
            : undefined);
      }
    }
  }
  // Sheet-on-sheet intersections, including completed arcs against unrelated flanges.
  // Neighbouring flanges/fillets are physically joined; they are not self-collisions.
  for (let i=0; i<sheets.length; i++) {
    for (let j=i+1; j<sheets.length; j++) {
      const a=sheets[i], b=sheets[j];
      const nearby = Math.abs(a.flangeIndex-b.flangeIndex)<=1;
      if (nearby) continue;
      const contact = intersectPrisms3D(a,b);
      if (contact.intersecting || contact.clearanceMm <= CONTACT_TOLERANCE_MM) {
        add(a,'self',b.id,contact,0,`Samokolizja 3D: ${a.id} ↔ ${b.id}`);
      }
    }
  }
  return events;
}
