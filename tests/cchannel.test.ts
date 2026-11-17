import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MACHINE, DIE_TOOLS, MATERIALS, PART_PRESETS, PUNCH_TOOLS } from '../src/data/library';
import { checkToolCoverage, detectFrameCollisions3D } from '../src/engine/collision3d';
import { findFirstBlockingFrame, simulateFullSequenceCollisions } from '../src/engine/collisionEngine';
import { evaluateKinematics } from '../src/engine/kinematics';

const material = MATERIALS[0];
const c = PART_PRESETS.find(p => p.id === 'channel-c-50-80-50')!;
const steps = c.bends.map((_,bendIndex)=>({bendIndex,flipHorizontal:false}));
const die = DIE_TOOLS[0];

test('C50x80x50 jest dostępny jako osobny przykład, ale z wymiarami materiału do weryfikacji',()=>{
  assert.deepEqual(c.segmentLengthsMm,[50,80,50]);
  assert.equal(steps.length,2);
});

test('C50x80x50: przy wąskim stemplu ostrzegamy bez zatrzymania gięcia',()=>{
  const reports=simulateFullSequenceCollisions(c,material,PUNCH_TOOLS[0],die,steps,true,false);
  const risks=reports[1].collisions.filter(x=>x.severity === 'warning');
  assert.ok(risks.length>0);
  const near=risks.find(x=>x.flangeIndex===0 && x.type==='punch');
  assert.ok(near);
  assert.equal(near?.severity,'warning');
  assert.ok(near!.clearanceMm>0 && near!.clearanceMm<8);
  assert.ok(reports[1].checkedFrames>300);
  const evaluate=(u:number)=>evaluateKinematics(c,material,PUNCH_TOOLS[0],die,steps,1,u,true);
  const collisionAt=(frame:ReturnType<typeof evaluate>)=>detectFrameCollisions3D(frame,c,PUNCH_TOOLS[0],die,false,DEFAULT_MACHINE);
  assert.equal(findFirstBlockingFrame(evaluate,collisionAt,.68,.84),null);
});

test('C50x80x50: szerszy stempel wykrywa rzeczywiste przecięcie geometrii 3D',()=>{
  const reports=simulateFullSequenceCollisions(c,material,PUNCH_TOOLS[1],die,steps,true,false);
  assert.ok(reports[1].collisions.some(e=>e.type==='punch'&&e.severity==='critical'));
});

test('Zmiana marginesu może zmienić ostrzeżenie, ale nie samą geometrię stempla',()=>{
  const m={...DEFAULT_MACHINE,collisionGeometry:{...DEFAULT_MACHINE.collisionGeometry, minimumFreeClearanceMm:0}};
  const frame=evaluateKinematics(c,material,PUNCH_TOOLS[0],die,steps,1,.82,true);
  const risks=detectFrameCollisions3D(frame,c,PUNCH_TOOLS[0],die,false,m);
  assert.ok(!risks.some(e=>e.requiresHold));
});

test('Z przerwą w segmentach stempla nie wolno potwierdzać pokrycia giętej blachy',()=>{
  const m={...DEFAULT_MACHINE, collisionGeometry:{...DEFAULT_MACHINE.collisionGeometry,
    punchStationsZMm:[{startMm:-550,endMm:-30},{startMm:30,endMm:550}],
    dieStationsZMm:[{startMm:-550,endMm:550}],
  }};
  assert.deepEqual(checkToolCoverage(c,m),{punch:false,die:true});
  const reports=simulateFullSequenceCollisions(c,material,PUNCH_TOOLS[0],die,steps,true,false,undefined,20,m);
  assert.equal(reports[0].toolingCoversSheetWidth,false);
});

test('C50x80x50: zatrzymanie na pierwszym kontakcie szerokiego stempla',()=>{
  const evaluate=(u:number)=>evaluateKinematics(c,material,PUNCH_TOOLS[1],die,steps,1,u,true);
  const collisionAt=(frame:ReturnType<typeof evaluate>)=>detectFrameCollisions3D(frame,c,PUNCH_TOOLS[1],die,false,DEFAULT_MACHINE);
  const stop=findFirstBlockingFrame(evaluate,collisionAt,.68,.84);
  assert.ok(stop);
  assert.ok(stop!.frame.strokeProgress>.68 && stop!.frame.strokeProgress<.84);
  assert.ok(stop!.events.some(e=>e.severity==='critical' && e.type==='punch'));
  assert.ok(stop!.events.filter(e=>e.severity==='critical').every(e=>e.penetrationMm < 0.15));
  assert.ok(collisionAt(evaluate(.72)).some(e=>e.severity==='warning'));
  assert.ok(!collisionAt(evaluate(.72)).some(e=>e.severity==='critical'));
  const resumed=findFirstBlockingFrame(evaluate,collisionAt,stop!.frame.strokeProgress,stop!.frame.strokeProgress+.05);
  assert.ok(resumed);
  assert.ok(Math.abs(resumed!.frame.strokeProgress-stop!.frame.strokeProgress)<0.00001);
});

test('Z dala od przeszkody nie zatrzymujemy odtwarzania',()=>{
  const evaluate=(u:number)=>evaluateKinematics(c,material,PUNCH_TOOLS[0],die,steps,0,u,true);
  const collisionAt=(frame:ReturnType<typeof evaluate>)=>detectFrameCollisions3D(frame,c,PUNCH_TOOLS[0],die,false,DEFAULT_MACHINE);
  const stop=findFirstBlockingFrame(evaluate,collisionAt,.1,.16);
  assert.equal(stop,null);
});


test('wsteczne requiresHold nie może zatrzymywać na ostrzeżeniu', () => {
  const evaluate=(u:number)=>({strokeProgress:u} as ReturnType<typeof evaluateKinematics>);
  const warn=(frame:ReturnType<typeof evaluateKinematics>)=>[{severity:'warning' as const,requiresHold:true,strokeProgress:frame.strokeProgress}] as any;
  assert.equal(findFirstBlockingFrame(evaluate,warn,.1,.9),null);
});

test('dokładne wyszukanie pierwszego kontaktu między klatkami', () => {
  const evaluate=(u:number)=>({strokeProgress:u} as ReturnType<typeof evaluateKinematics>);
  const collision=(f:ReturnType<typeof evaluateKinematics>)=>[{severity:f.strokeProgress>=.631234?'critical' as const:'warning' as const}] as any;
  const stop=findFirstBlockingFrame(evaluate,collision,.6,.8);
  assert.ok(stop);
  assert.ok(Math.abs(stop!.frame.strokeProgress-.631234)<.000002);
});
