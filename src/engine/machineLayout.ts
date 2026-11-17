/**
 * Shared geometric layout of the illustrative Ermaksan C-frame.
 * Measurements in mm; +Z is toward the right end of the press.
 * Keep visible solids and the prism collision model on the same Z intervals.
 * This is a simplified machine shell, NOT a measured CAD model.
 */
export interface MachineZInterval { startMm: number; endMm: number }

export interface MachineZLayout {
  columns: MachineZInterval[];
  /** Structural pieces stop just short of the housings, avoiding z-fighting. */
  structuralRails: MachineZInterval[];
  topHeader: MachineZInterval;
}

export const FRAME_COLUMN_THICKNESS_MM = 80;
export const FRAME_JOINT_CLEARANCE_MM = 2;
export const FRAME_FRONT_FACE_X_MM = 100;

export function getMachineZLayout(bendingLengthMm: number, distanceBetweenColumnsMm: number): MachineZLayout {
  const halfGap = distanceBetweenColumnsMm / 2;
  const halfBed = bendingLengthMm / 2 + 20;
  const columnWidth = FRAME_COLUMN_THICKNESS_MM;
  const seam = FRAME_JOINT_CLEARANCE_MM;
  const columns = [
    {startMm: -halfGap - columnWidth, endMm: -halfGap},
    {startMm: halfGap, endMm: halfGap + columnWidth},
  ];
  const structuralRails = [
    {startMm: -halfBed, endMm: -halfGap - columnWidth - seam},
    {startMm: -halfGap + seam, endMm: halfGap - seam},
    {startMm: halfGap + columnWidth + seam, endMm: halfBed},
  ].filter(s => s.endMm > s.startMm);
  return {
    columns,
    structuralRails,
    topHeader: {startMm: -halfGap + seam, endMm: halfGap - seam},
  };
}

/** A real C opening must remain empty: no decorative strut through -80..300 mm. */
export const FRAME_ACCENT_Y_SEGMENTS_MM = [
  {startMm: -440, endMm: -90},
  {startMm: 310, endMm: 550},
] as const;

export function cFrameSectionMm(throatDepthMm: number): {x:number;y:number}[] {
  const throatX = -throatDepthMm;
  return [
    {x:throatX-320,y:-450}, {x:100,y:-450}, {x:100,y:-80},
    {x:throatX+40,y:-80}, {x:throatX,y:-40}, {x:throatX,y:260},
    {x:throatX+60,y:300}, {x:100,y:300}, {x:100,y:560},
    {x:throatX-320,y:560},
  ];
}
