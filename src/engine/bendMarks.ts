import { BendStepConfig, PartDefinition } from '../types/bending';
import { KinematicFrame } from './kinematics';

export interface BendMark {
  bendIndex: number;
  xMm: number;
  yMm: number;
  active: boolean;
  completed: boolean;
}

/** Line-of-bend markers in the press XY frame, including unformed flat joints. */
export function getBendMarks(
  frame: KinematicFrame, part: PartDefinition, steps: BendStepConfig[], currentStepIdx: number
): BendMark[] {
  const marks: BendMark[] = [];
  for (let bendIdx=0; bendIdx<part.bends.length; bendIdx++) {
    const arc = frame.bendArcs.find(a=>a.bendIndex===bendIdx);
    let pt: {x:number;y:number} | null = null;
    if (arc && arc.innerPoints.length>0 && arc.outerPoints.length>0) {
      const middle=Math.floor(arc.innerPoints.length/2);
      const inner=arc.innerPoints[middle],outer=arc.outerPoints[middle];
      const dx=outer.x-inner.x,dy=outer.y-inner.y;
      const length=Math.hypot(dx,dy)||1;
      pt={x:outer.x+dx/length*0.25,y:outer.y+dy/length*0.25};
    } else {
      const left=frame.flanges.find(f=>f.flangeIndex===bendIdx);
      const right=frame.flanges.find(f=>f.flangeIndex===bendIdx+1);
      if(left && right) {
        const leftEnds=[left.start,left.end],rightEnds=[right.start,right.end];
        let min=Infinity,atL=left.start,atR=right.start;
        for(const a of leftEnds) for(const b of rightEnds) {
          const dist=Math.hypot(a.x-b.x,a.y-b.y);
          if (dist<min) {min=dist;atL=a;atR=b;}
        }
        pt={x:(atL.x+atR.x)/2+left.normal.x*(part.thicknessMm/2+0.3),
            y:(atL.y+atR.y)/2+left.normal.y*(part.thicknessMm/2+0.3)};
      }
    }
    if (!pt) continue;
    marks.push({bendIndex:bendIdx,xMm:pt.x,yMm:pt.y,
      active:bendIdx===frame.activeBendIndex,
      completed:steps.slice(0,currentStepIdx).some(x=>x.bendIndex===bendIdx)});
  }
  return marks;
}
