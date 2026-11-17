import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AlertTriangle,
  CornerUpLeft,
  Camera,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';

import {
  BendStepConfig,
  CollisionEvent,
  DieTool,
  PartDefinition,
  PressMachineSpec,
  PunchTool,
  SheetMaterial,
} from '../types/bending';
import { evaluateKinematics, KinematicFrame } from '../engine/kinematics';
import { getBendMarks } from '../engine/bendMarks';
import { absoluteMainCamera, isMainCameraView, MAIN_CAMERA_STORAGE_KEY, MainCameraView, REFERENCE_MAIN_CAMERA, relativeMainCamera } from '../engine/mainCameraView';
import { detectFrameCollisions, findFirstBlockingFrame } from '../engine/collisionEngine';
import { createFrameLoop } from '../engine/frameLoop';
import { cFrameSectionMm, FRAME_ACCENT_Y_SEGMENTS_MM, FRAME_FRONT_FACE_X_MM, getMachineZLayout } from '../engine/machineLayout';
import { CAMERA_SENSITIVITY_KEY, DEFAULT_CAMERA_SENSITIVITY, cameraControlSpeeds, clampCameraSensitivity } from '../engine/cameraControls';

import { turnToIncludedAngleDeg } from '../engine/bendingMath';

const SCALE = 0.1; // 1 Three.js unit = 10 mm

// Pre-allocated math helpers outside loop (zero GC)
const _targetCamPos = new THREE.Vector3();
const _targetControlsTarget = new THREE.Vector3();

interface PressBrakeViewportProps {
  part: PartDefinition;
  material: SheetMaterial;
  punch: PunchTool;
  die: DieTool;
  machine: PressMachineSpec;
  steps: BendStepConfig[];
  currentStepIdx: number;
  strokeProgress: number;
  isPlaying: boolean;
  playbackSpeed: number;
  compensateSpringback: boolean;
  punchReversed: boolean;
  customKFactor?: number;
  onStepChange: (stepIdx: number) => void;
  onStrokeChange: (u: number) => void;
  onTogglePlay: () => void;
  onStopPlay: () => void;
  onResetSim: () => void;
}

// The old [34, 18, 44] isometric "home" was too distant and at the wrong
// angle for the near-frontal bending close-up shown in the reference image.
function readMainCameraView(): MainCameraView {
  try {
    const raw = window.localStorage.getItem(MAIN_CAMERA_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isMainCameraView(parsed)) return parsed;
    }
  } catch { /* private browsing or invalid saved data */ }
  return REFERENCE_MAIN_CAMERA;
}

function createRulerTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#64748b';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';

  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * 1024;
    const isMajor = i % 5 === 0;
    ctx.lineWidth = isMajor ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x, isMajor ? 72 : 96);
    ctx.stroke();

    if (isMajor && i > 0 && i < 40) {
      const mmLabel = (i - 20) * 20;
      ctx.fillText(`${mmLabel}`, x, 54);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeExtrudedProfileGeometry(points: { x: number; y: number }[], lengthZ: number, mirrorX = false): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    const firstX = (mirrorX ? -points[0].x : points[0].x) * SCALE;
    const firstY = points[0].y * SCALE;
    shape.moveTo(firstX, firstY);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo((mirrorX ? -points[i].x : points[i].x) * SCALE, points[i].y * SCALE);
    }
    shape.closePath();
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: lengthZ,
    // Do not round the collision outlines in display: visible tool geometry must match
    // the exact prismatic solids tested by collision3d.ts.
    bevelEnabled: false,
  });
  geo.translate(0, 0, -lengthZ * 0.5);
  geo.computeVertexNormals();
  return geo;
}

function disposeGroupMeshes(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else if (mat) {
        mat.dispose();
      }
    });
  }
}

export const PressBrakeViewport: React.FC<PressBrakeViewportProps> = ({
  part,
  material,
  punch,
  die,
  machine,
  steps,
  currentStepIdx,
  strokeProgress,
  isPlaying,
  playbackSpeed,
  compensateSpringback,
  punchReversed,
  customKFactor,
  onStepChange,
  onStrokeChange,
  onTogglePlay,
  onStopPlay,
  onResetSim,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraPanelOpen, setCameraPanelOpen] = useState(false);
  const [cameraSensitivity, setCameraSensitivity] = useState(() => {
    try { return clampCameraSensitivity(Number(window.localStorage.getItem(CAMERA_SENSITIVITY_KEY) ?? DEFAULT_CAMERA_SENSITIVITY)); }
    catch { return DEFAULT_CAMERA_SENSITIVITY; }
  });
  const [contextLost, setContextLost] = useState(false);
  const [collisionPaused, setCollisionPaused] = useState(false);
  const [viewSaved, setViewSaved] = useState(() => {
    try { return isMainCameraView(JSON.parse(window.localStorage.getItem(MAIN_CAMERA_STORAGE_KEY) ?? 'null')); }
    catch { return false; }
  });

  // Live kinematic & collision readout for HUD
  const currentFrame: KinematicFrame = evaluateKinematics(
    part,
    material,
    punch,
    die,
    steps,
    currentStepIdx,
    strokeProgress,
    compensateSpringback,
    customKFactor
  );
  const liveCollisions: CollisionEvent[] = detectFrameCollisions(
    currentFrame,
    part,
    punch,
    die,
    punchReversed,
    machine
  );
  const criticalEvents = liveCollisions.filter((c) => c.severity === 'critical');
  const warningEvents = liveCollisions.filter((c) => c.severity === 'warning');
  const tonnageExceeded = currentFrame.springback.bendingForceKn > machine.maxForceKn;
  const backgaugeOutOfRange =
    currentFrame.strokeProgress <= 0.18 &&
    Math.abs(currentFrame.backgaugeXMm) > machine.backgaugeXMaxMm;

  // Mutable refs for Three.js loop access without tearing down canvas
  const stateRef = useRef({
    part,
    material,
    punch,
    die,
    machine,
    steps,
    currentStepIdx,
    strokeProgress,
    isPlaying,
    playbackSpeed,
    compensateSpringback,
    punchReversed,
    customKFactor,
    onStepChange,
    onStrokeChange,
    onTogglePlay,
    onStopPlay,
  });

  stateRef.current = {
    part,
    material,
    punch,
    die,
    machine,
    steps,
    currentStepIdx,
    strokeProgress,
    isPlaying,
    playbackSpeed,
    compensateSpringback,
    punchReversed,
    customKFactor,
    onStepChange,
    onStrokeChange,
    onTogglePlay,
    onStopPlay,
  };

  const sceneRefs = useRef<{
    requestRender: () => void;
    rebuildTooling: () => void;
    updateDynamicFrame: () => void;
    restoreMainView: () => void;
    saveMainView: () => void;
    setCameraSensitivity: (value: number) => void;
  } | null>(null);

  // Initialize Three.js WebGL scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1017);
    scene.fog = new THREE.FogExp2(0x0b1017, 0.0014);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.2,
      1600
    );
    // Set the default camera relative to the +Z face of the current sheet.
    // Otherwise a wide sheet can be closer to the viewer than the camera.
    let returnCameraView = readMainCameraView();
    const startingView = absoluteMainCamera(returnCameraView, stateRef.current.part.widthMm);
    camera.position.set(...startingView.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    // CAD navigation: deliberately slow, screen-aligned pan and short inertia.
    // Zoom follows the target, never jumps toward an arbitrary mesh under cursor.
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = false;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    const setCameraSensitivity = (value: number) => {
      const speeds = cameraControlSpeeds(value);
      controls.rotateSpeed = speeds.rotateSpeed;
      controls.panSpeed = speeds.panSpeed;
      controls.zoomSpeed = speeds.zoomSpeed;
      controls.dampingFactor = speeds.dampingFactor;
    };
    setCameraSensitivity(cameraSensitivity);
    controls.minDistance = 7;
    controls.maxDistance = 620;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.target.set(...startingView.target);
    controls.update();
    controls.saveState();

    // 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x1e293b, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.9);
    keyLight.position.set(36, 48, 42);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.left = -120;
    keyLight.shadow.camera.right = 120;
    keyLight.shadow.camera.top = 60;
    keyLight.shadow.camera.bottom = -60;
    keyLight.shadow.camera.near = 4;
    keyLight.shadow.camera.far = 220;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.9);
    rimLight.position.set(-40, 28, -45);
    scene.add(rimLight);

    // Industrial Floor & Grid
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f1722,
      roughness: 0.85,
      metalness: 0.15,
    });
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -45.0;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const gridHelper = new THREE.GridHelper(640, 64, 0x243447, 0x17212f);
    gridHelper.position.y = -44.96;
    scene.add(gridHelper);

    // Ermaksan Power-Bend Falcon 4100-175 Static Machine Frame (1 unit = 10 mm)
    const machineGroup = new THREE.Group();
    scene.add(machineGroup);

    const frameDarkMat = new THREE.MeshStandardMaterial({
      color: 0x1b2430,
      roughness: 0.55,
      metalness: 0.45,
    });
    const ermaksanAccentMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.35,
      metalness: 0.4,
    });
    const steelTrimMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.35,
      metalness: 0.82,
    });
    const accentAmberMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.35,
      metalness: 0.65,
    });

    const beamLen = machine.bendingLengthMm * SCALE;
    const halfCols = (machine.distanceBetweenColumnsMm * 0.5) * SCALE;
    const throatX = -machine.throatDepthMm * SCALE;
    const layout = getMachineZLayout(machine.bendingLengthMm, machine.distanceBetweenColumnsMm);

    // Both long rails are built as independent, non-overlapping sections.
    // A 2 mm assembly clearance at the housings prevents coincident depth faces
    // and the visible flickering/streaks that appeared at the ends of the machine.
    const makeRails = (material: THREE.Material, initialHeight: number) => layout.structuralRails.map(span => {
      const len = (span.endMm - span.startMm) * SCALE;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(12, initialHeight, len), material);
      mesh.position.z = (span.startMm + span.endMm) * SCALE / 2;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      machineGroup.add(mesh);
      return mesh;
    });
    const lowerBeds = makeRails(frameDarkMat, 30);
    const dieHolders = makeRails(steelTrimMat, 2.5);

    // The C profile uses the same outline as the prism collision model.
    // Bevel-free sides avoid coplanar/overlapping bevel faces at the joints.
    const cFrameShape = new THREE.Shape();
    const frameSection = cFrameSectionMm(machine.throatDepthMm);
    cFrameShape.moveTo(frameSection[0].x * SCALE, frameSection[0].y * SCALE);
    for (const point of frameSection.slice(1)) cFrameShape.lineTo(point.x * SCALE, point.y * SCALE);
    cFrameShape.closePath();
    const cFrameGeo = new THREE.ExtrudeGeometry(cFrameShape, {
      depth: 8,
      bevelEnabled: false,
    });
    cFrameGeo.translate(0, 0, -4);

    for (const span of layout.columns) {
      const centerZ = (span.startMm + span.endMm) * SCALE / 2;
      const shell = new THREE.Mesh(cFrameGeo, frameDarkMat);
      shell.position.z = centerZ;
      shell.castShadow = true;
      shell.receiveShadow = true;
      machineGroup.add(shell);

      // Accent panels belong only on the UPPER and LOWER arms of the C housing.
      // The throat opening between these arms must remain completely free.
      // Offset > 0 from the housing face avoids z-fighting with the shell.
      for (const seg of FRAME_ACCENT_Y_SEGMENTS_MM) {
        const height = (seg.endMm - seg.startMm) * SCALE;
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.20, height, 7.4), ermaksanAccentMat
        );
        panel.position.set(
          (FRAME_FRONT_FACE_X_MM + 2.5) * SCALE,
          (seg.startMm + seg.endMm) * SCALE / 2,
          centerZ
        );
        machineGroup.add(panel);
      }
    }

    // The top support stops just before the side housings, not inside them.
    const headerSpan = layout.topHeader;
    const topHeader = new THREE.Mesh(
      new THREE.BoxGeometry(22, 10, (headerSpan.endMm - headerSpan.startMm) * SCALE),
      frameDarkMat
    );
    topHeader.position.set(throatX - 8, 51, (headerSpan.startMm + headerSpan.endMm) * SCALE / 2);
    topHeader.castShadow = true;
    machineGroup.add(topHeader);

    // Instanced Clamping Bolts along 4100mm lower die rail
    const boltGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.5, 10);
    boltGeo.rotateZ(Math.PI / 2);
    const boltCount = 42;
    const boltInst = new THREE.InstancedMesh(boltGeo, accentAmberMat, boltCount);
    const dummy = new THREE.Object3D();
    let visibleBolts = 0;
    for (let i = 0; i < boltCount; i++) {
      const z = -beamLen * 0.48 + (i / (boltCount - 1)) * (beamLen * 0.96);
      const mm = z / SCALE;
      if (!layout.structuralRails.some(span => mm >= span.startMm && mm <= span.endMm)) continue;
      dummy.position.set(machine.tableWidthMm * SCALE * 0.5 + 0.1, -7.2, z);
      dummy.updateMatrix();
      boltInst.setMatrixAt(visibleBolts++, dummy.matrix);
    }
    boltInst.count = visibleBolts;
    boltInst.instanceMatrix.needsUpdate = true;
    boltInst.computeBoundingSphere();
    machineGroup.add(boltInst);

    // Upper Ram Beam Group (4100 mm beam moving with punchTipY)
    const ramGroup = new THREE.Group();
    scene.add(ramGroup);

    const ramBody = new THREE.Mesh(new THREE.BoxGeometry(6.8, 22, beamLen), frameDarkMat);
    ramBody.position.set(0, 13.0, 0);
    ramBody.castShadow = true;
    ramGroup.add(ramBody);

    const rulerTex = createRulerTexture(renderer.capabilities.getMaxAnisotropy());
    const rulerMat = new THREE.MeshStandardMaterial({
      map: rulerTex,
      roughness: 0.4,
      metalness: 0.5,
    });
    const rulerStrip = new THREE.Mesh(new THREE.PlaneGeometry(beamLen * 0.92, 1.8), rulerMat);
    rulerStrip.rotation.y = Math.PI / 2;
    rulerStrip.position.set(3.43, 4.5, 0);
    ramGroup.add(rulerStrip);

    // Promecam Quick-Clamp Bar on Ram
    const clampBar = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.4, beamLen), steelTrimMat);
    clampBar.position.set(0, 1.2, 0);
    ramGroup.add(clampBar);

    // Tooling Materials
    const punchMat = new THREE.MeshPhysicalMaterial({
      color: 0x3b495e,
      metalness: 0.9,
      roughness: 0.24,
      clearcoat: 0.2,
      transparent: false,
      opacity: 1,
    });
    const dieMat = new THREE.MeshPhysicalMaterial({
      color: 0x334155,
      metalness: 0.88,
      roughness: 0.28,
      transparent: false,
      opacity: 1,
    });
    const backgaugeMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.5,
      roughness: 0.35,
    });

    // Dynamic Tooling Groups
    const punchToolGroup = new THREE.Group();
    ramGroup.add(punchToolGroup);

    const dieToolGroup = new THREE.Group();
    scene.add(dieToolGroup);

    // CNC Backgauge Group (800 mm X travel across 3600 mm gantry)
    const backgaugeGroup = new THREE.Group();
    scene.add(backgaugeGroup);

    const bgBridge = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 2.6, halfCols * 1.9),
      steelTrimMat
    );
    bgBridge.position.set(-4.2, 0, 0);
    backgaugeGroup.add(bgBridge);

    const bgFingerGeo = new THREE.BoxGeometry(4.8, 2.0, 2.2);
    const bgFingerL = new THREE.Mesh(bgFingerGeo, backgaugeMat);
    bgFingerL.position.set(-2.4, 0, -9);
    bgFingerL.castShadow = true;
    backgaugeGroup.add(bgFingerL);

    const bgFingerR = new THREE.Mesh(bgFingerGeo, backgaugeMat);
    bgFingerR.position.set(-2.4, 0, 9);
    bgFingerR.castShadow = true;
    backgaugeGroup.add(bgFingerR);

    // Sheet Metal Part Group
    const sheetGroup = new THREE.Group();
    scene.add(sheetGroup);

    // Collision Markers Group
    const collisionMarkersGroup = new THREE.Group();
    scene.add(collisionMarkersGroup);

    const rebuildTooling = () => {
      const st = stateRef.current;
      disposeGroupMeshes(punchToolGroup);
      disposeGroupMeshes(dieToolGroup);

      // Finite 3D tool stations, using the SAME Z intervals as the collision engine.
      const g = st.machine.collisionGeometry;
      const spanMm = Math.max(1,Math.min(st.machine.bendingLengthMm, g.toolLengthMm ?? Math.max(420, st.part.widthMm + 140)));
      const zOffset = g.toolOffsetZMm ?? 0;
      const fallback = [{startMm:zOffset-spanMm/2,endMm:zOffset+spanMm/2}];
      const punchStations = g.punchStationsZMm?.length ? g.punchStationsZMm : fallback;
      const dieStations = g.dieStationsZMm?.length ? g.dieStationsZMm : fallback;
      const addStations = (
        group: THREE.Group, profile: {x:number;y:number}[],
        stations: {startMm:number;endMm:number}[], mirror: boolean, toolMaterial: THREE.Material
      ) => {
        for (const stn of stations) {
          if (stn.endMm<=stn.startMm) continue;
          const geo = makeExtrudedProfileGeometry(profile,(stn.endMm-stn.startMm)*SCALE,mirror);
          const z = (stn.startMm+stn.endMm)*0.5*SCALE;
          const mesh = new THREE.Mesh(geo,toolMaterial);
          mesh.position.z=z;
          mesh.castShadow=true;
          mesh.receiveShadow=true;
          group.add(mesh);
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo,25),
            new THREE.LineBasicMaterial({ color:0x94a3b8,transparent:true,opacity:0.45 }));
          edges.position.z=z;
          group.add(edges);
        }
      };
      addStations(punchToolGroup,st.punch.profile2D,punchStations,st.punchReversed,punchMat);
      addStations(dieToolGroup,st.die.profile2D,dieStations,false,dieMat);

      // Synchronize rendered support solids with exact detection cross sections.
      const oldClamp = clampBar.geometry;
      clampBar.geometry = new THREE.BoxGeometry(g.clampHalfWidthMm * 2 * SCALE, 24 * SCALE, beamLen);
      oldClamp.dispose();
      const oldRam = ramBody.geometry;
      ramBody.geometry = new THREE.BoxGeometry(g.ramHalfWidthMm * 2 * SCALE, g.ramBodyHeightMm * SCALE, beamLen);
      oldRam.dispose();
      for (let i = 0; i < layout.structuralRails.length; i++) {
        const span = layout.structuralRails[i];
        const len = (span.endMm - span.startMm) * SCALE;
        const oldHolder = dieHolders[i].geometry;
        dieHolders[i].geometry = new THREE.BoxGeometry(g.dieHolderHalfWidthMm * 2 * SCALE, g.dieHolderHeightMm * SCALE, len);
        oldHolder.dispose();
        const oldBed = lowerBeds[i].geometry;
        lowerBeds[i].geometry = new THREE.BoxGeometry(g.bedHalfWidthMm * 2 * SCALE, 300 * SCALE, len);
        oldBed.dispose();
      }
      const pHeightUnits = st.punch.heightMm * SCALE;
      clampBar.position.y = pHeightUnits + 12 * SCALE;
      ramBody.position.y = pHeightUnits + (24 + g.ramBodyHeightMm / 2) * SCALE;
      rulerStrip.position.y = pHeightUnits + 55 * SCALE;

      const oldFingerL = bgFingerL.geometry, oldFingerR = bgFingerR.geometry;
      bgFingerL.geometry = new THREE.BoxGeometry(g.backgaugeFingerDepthMm * SCALE,
        g.backgaugeFingerHeightMm * SCALE, (g.backgaugeFingerWidthMm ?? 22) * SCALE);
      bgFingerR.geometry = new THREE.BoxGeometry(g.backgaugeFingerDepthMm * SCALE,
        g.backgaugeFingerHeightMm * SCALE, (g.backgaugeFingerWidthMm ?? 22) * SCALE);
      oldFingerL.dispose();
      if (oldFingerR !== oldFingerL) oldFingerR.dispose();
      bgFingerL.position.x = -((g.backgaugeFingerDepthMm / 2) + 1) * SCALE;
      bgFingerR.position.x = -((g.backgaugeFingerDepthMm / 2) + 1) * SCALE;
      bgFingerL.position.y = (-8 + g.backgaugeFingerHeightMm / 2) * SCALE;
      bgFingerR.position.y = (-8 + g.backgaugeFingerHeightMm / 2) * SCALE;

      // Adjust die holder & lower bed height to match die height
      const dHeightUnits = st.die.heightMm * SCALE;
      for (const dieHolder of dieHolders) dieHolder.position.y = -dHeightUnits - (g.dieHolderHeightMm / 2) * SCALE;
      for (const lowerBed of lowerBeds) lowerBed.position.y = -dHeightUnits - (g.dieHolderHeightMm + 150) * SCALE;
      boltInst.position.y = -dHeightUnits + 5.95;
    };

    const updateDynamicFrame = () => {
      const st = stateRef.current;
      const frame = evaluateKinematics(
        st.part,
        st.material,
        st.punch,
        st.die,
        st.steps,
        st.currentStepIdx,
        st.strokeProgress,
        st.compensateSpringback,
        st.customKFactor
      );
      const collisions = detectFrameCollisions(
        frame,
        st.part,
        st.punch,
        st.die,
        st.punchReversed,
        st.machine
      );

      // Tooling solid material defaults

      // Collision color highlights on tooling
      const hasPunchHit = collisions.some((c) => c.severity === 'critical' && c.type === 'punch');
      const hasDieHit = collisions.some(
        (c) => c.severity === 'critical' && (c.type === 'die' || c.type === 'table')
      );
      const hasBgHit = collisions.some((c) => c.severity === 'critical' && c.type === 'backgauge');

      punchMat.emissive.setHex(hasPunchHit ? 0xdc2626 : 0x000000);
      punchMat.emissiveIntensity = hasPunchHit ? 0.75 : 0;
      dieMat.emissive.setHex(hasDieHit ? 0xdc2626 : 0x000000);
      dieMat.emissiveIntensity = hasDieHit ? 0.75 : 0;
      backgaugeMat.emissive.setHex(hasBgHit ? 0xdc2626 : 0x000000);
      backgaugeMat.emissiveIntensity = hasBgHit ? 0.85 : 0;

      // Update Ram & Backgauge Positions
      ramGroup.position.y = frame.punchTipY * SCALE;
      backgaugeGroup.position.set(frame.backgaugeXMm * SCALE, frame.backgaugeRMm * SCALE, 0);
      const separation = st.machine.collisionGeometry.backgaugeFingerSeparationMm ?? Math.min(3300,Math.max(80,st.part.widthMm*0.68));
      const zSpread = separation*0.5*SCALE;
      bgFingerL.position.z = -zSpread;
      bgFingerR.position.z = zSpread;
      sheetGroup.position.z = (st.machine.collisionGeometry.partOffsetZMm ?? 0) * SCALE;

      // Rebuild Sheet Metal 3D Geometry cleanly
      disposeGroupMeshes(sheetGroup);
      const partWidthUnits = st.part.widthMm * SCALE;

      const normalSheetMat = new THREE.MeshPhysicalMaterial({
        color: st.material.colorHex,
        metalness: st.material.metalness,
        roughness: st.material.roughness,
        clearcoat: 0.12,
      });
      const clashSheetMat = new THREE.MeshPhysicalMaterial({
        color: 0xef4444,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.65,
        metalness: 0.45,
        roughness: 0.35,
      });
      const warnSheetMat = new THREE.MeshPhysicalMaterial({
        color: 0xf59e0b,
        emissive: 0xb45309,
        emissiveIntensity: 0.4,
        metalness: 0.55,
        roughness: 0.35,
      });

      const halfW = partWidthUnits * 0.5;
      const linePositions: number[] = [];
      const pushEdge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        linePositions.push(ax, ay, az, bx, by, bz);
      };

      const numFlanges = frame.flanges.length;
      for (const flange of frame.flanges) {
        const isCrit = collisions.some(
          (c) => c.severity === 'critical' && c.flangeIndex === flange.flangeIndex
        );
        const isWarn =
          !isCrit &&
          collisions.some(
            (c) => c.severity === 'warning' && c.flangeIndex === flange.flangeIndex
          );

        const shape = new THREE.Shape();
        shape.moveTo(flange.polygon[0].x * SCALE, flange.polygon[0].y * SCALE);
        for (let i = 1; i < flange.polygon.length; i++) {
          shape.lineTo(flange.polygon[i].x * SCALE, flange.polygon[i].y * SCALE);
        }
        shape.closePath();

        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: partWidthUnits,
          bevelEnabled: false,
        });
        geo.translate(0, 0, -halfW);
        geo.computeVertexNormals();

        const meshMat = isCrit ? clashSheetMat.clone() : isWarn ? warnSheetMat.clone() : normalSheetMat.clone();
        const mesh = new THREE.Mesh(geo, meshMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        sheetGroup.add(mesh);

        // Longitudinal sheet edges on front (+Z) and back (-Z) faces
        const p = flange.polygon;
        pushEdge(p[0].x * SCALE, p[0].y * SCALE, halfW, p[1].x * SCALE, p[1].y * SCALE, halfW);
        pushEdge(p[0].x * SCALE, p[0].y * SCALE, -halfW, p[1].x * SCALE, p[1].y * SCALE, -halfW);
        pushEdge(p[2].x * SCALE, p[2].y * SCALE, halfW, p[3].x * SCALE, p[3].y * SCALE, halfW);
        pushEdge(p[2].x * SCALE, p[2].y * SCALE, -halfW, p[3].x * SCALE, p[3].y * SCALE, -halfW);

        // Only draw end-cap edges on the true outer free ends of the sheet (not at internal bend tangents)
        if (flange.flangeIndex === 0 || flange.flangeIndex === numFlanges - 1) {
          pushEdge(p[1].x * SCALE, p[1].y * SCALE, halfW, p[2].x * SCALE, p[2].y * SCALE, halfW);
          pushEdge(p[1].x * SCALE, p[1].y * SCALE, -halfW, p[2].x * SCALE, p[2].y * SCALE, -halfW);
          pushEdge(p[1].x * SCALE, p[1].y * SCALE, -halfW, p[1].x * SCALE, p[1].y * SCALE, halfW);
          pushEdge(p[2].x * SCALE, p[2].y * SCALE, -halfW, p[2].x * SCALE, p[2].y * SCALE, halfW);
        }
      }

      // Render smooth curved bend fillets with creased cylindrical normals
      for (const arc of frame.bendArcs) {
        if (arc.innerPoints.length < 2 || arc.outerPoints.length < 2) continue;
        const arcShape = new THREE.Shape();
        arcShape.moveTo(arc.innerPoints[0].x * SCALE, arc.innerPoints[0].y * SCALE);
        for (let i = 1; i < arc.innerPoints.length; i++) {
          arcShape.lineTo(arc.innerPoints[i].x * SCALE, arc.innerPoints[i].y * SCALE);
        }
        for (let i = arc.outerPoints.length - 1; i >= 0; i--) {
          arcShape.lineTo(arc.outerPoints[i].x * SCALE, arc.outerPoints[i].y * SCALE);
        }
        arcShape.closePath();

        const rawArcGeo = new THREE.ExtrudeGeometry(arcShape, {
          depth: partWidthUnits,
          bevelEnabled: false,
        });
        rawArcGeo.translate(0, 0, -halfW);
        const arcGeo = toCreasedNormals(rawArcGeo, Math.PI / 4);
        rawArcGeo.dispose();

        const arcMesh = new THREE.Mesh(
          arcGeo,
          arc.isActive
            ? new THREE.MeshPhysicalMaterial({
                color: 0x38bdf8,
                emissive: 0x0284c7,
                emissiveIntensity: 0.35,
                metalness: 0.75,
                roughness: 0.22,
              })
            : normalSheetMat.clone()
        );
        arcMesh.castShadow = true;
        arcMesh.receiveShadow = true;
        sheetGroup.add(arcMesh);

        // Smooth curved silhouette edges along front (+Z) and back (-Z) faces
        for (let i = 0; i < arc.innerPoints.length - 1; i++) {
          const a0 = arc.innerPoints[i];
          const a1 = arc.innerPoints[i + 1];
          const b0 = arc.outerPoints[i];
          const b1 = arc.outerPoints[i + 1];
          pushEdge(a0.x * SCALE, a0.y * SCALE, halfW, a1.x * SCALE, a1.y * SCALE, halfW);
          pushEdge(a0.x * SCALE, a0.y * SCALE, -halfW, a1.x * SCALE, a1.y * SCALE, -halfW);
          pushEdge(b0.x * SCALE, b0.y * SCALE, halfW, b1.x * SCALE, b1.y * SCALE, halfW);
          pushEdge(b0.x * SCALE, b0.y * SCALE, -halfW, b1.x * SCALE, b1.y * SCALE, -halfW);
        }
      }

      // All planned bending axes, including untouched flat sheet joints.
      for (const mark of getBendMarks(frame, st.part, st.steps, st.currentStepIdx)) {
        const z1=-halfW*0.985,z2=halfW*0.985;
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mark.xMm*SCALE,mark.yMm*SCALE,z1),
          new THREE.Vector3(mark.xMm*SCALE,mark.yMm*SCALE,z2),
        ]);
        const lineMat = new THREE.LineDashedMaterial({
          color:mark.active?0x38bdf8:mark.completed?0xf59e0b:0x1e40af,
          dashSize:0.9,gapSize:0.5,depthTest:false,transparent:true,
          opacity:mark.active?1:0.96,
        });
        const line = new THREE.Line(lineGeo,lineMat);
        line.computeLineDistances();
        line.renderOrder=30;
        sheetGroup.add(line);
      }

      if (linePositions.length > 0) {
        const outlineGeo = new THREE.BufferGeometry();
        outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        const outlineMat = new THREE.LineBasicMaterial({
          color: 0x0f172a,
          transparent: true,
          opacity: 0.55,
        });
        sheetGroup.add(new THREE.LineSegments(outlineGeo, outlineMat));
      }

      normalSheetMat.dispose();
      clashSheetMat.dispose();
      warnSheetMat.dispose();

      // Render 3D Collision Contact Markers
      disposeGroupMeshes(collisionMarkersGroup);
      for (const ev of collisions) {
        if (ev.severity !== 'critical') continue;
        const cx = ev.contactPointMm.x * SCALE;
        const cy = ev.contactPointMm.y * SCALE;

        const markerMat = new THREE.MeshBasicMaterial({
          color: 0xff2e2e,
          transparent: true,
          opacity: 0.9,
        });
        const wireMat = new THREE.MeshBasicMaterial({
          color: 0xfca5a5,
          wireframe: true,
        });

        // Line-of-contact bar along Z + end spheres
        const contactZ=(ev.contactPoint3Dmm?.z ?? 0)*SCALE;
        const overlapLen=Math.max(0.6,(ev.overlapWidthMm ?? 10)*SCALE);
        const barGeo = new THREE.CylinderGeometry(0.16, 0.16, overlapLen, 10);
        barGeo.rotateX(Math.PI / 2);
        const barMesh = new THREE.Mesh(barGeo, markerMat);
        barMesh.position.set(cx, cy, contactZ);
        collisionMarkersGroup.add(barMesh);

        const sphereGeo = new THREE.SphereGeometry(0.85, 16, 12);
        const sphereFront = new THREE.Mesh(sphereGeo, wireMat);
        sphereFront.position.set(cx, cy, contactZ + overlapLen*0.5);
        collisionMarkersGroup.add(sphereFront);

        const sphereBack = new THREE.Mesh(sphereGeo.clone(), wireMat.clone());
        sphereBack.position.set(cx, cy, contactZ - overlapLen*0.5);
        collisionMarkersGroup.add(sphereBack);
      }
    };

    rebuildTooling();
    updateDynamicFrame();

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Camera transition state
    let camTransitioning = false;
    controls.addEventListener('start', () => {
      camTransitioning = false;
    });

    // No renderBusy latch and no separate playback RAF that cancels camera frames.
    // In software rendering mode we only throttle the number of canvas draws.
    let pausedByCollision = false;
    const frameLoop = createFrameLoop((delta) => {
      const st = stateRef.current;

      if (camTransitioning) {
        const dampFactor = 1 - Math.exp(-7.5 * delta);
        camera.position.lerp(_targetCamPos, dampFactor);
        controls.target.lerp(_targetControlsTarget, dampFactor);
        if (
          camera.position.distanceTo(_targetCamPos) < 0.08 &&
          controls.target.distanceTo(_targetControlsTarget) < 0.05
        ) {
          camera.position.copy(_targetCamPos);
          controls.target.copy(_targetControlsTarget);
          camTransitioning = false;
        }
      }

      if (st.isPlaying && !pausedByCollision) {
        const nextU = st.strokeProgress + delta * 0.38 * st.playbackSpeed;
        const clampedU = Math.min(1.0, nextU);
        const stop = findFirstBlockingFrame(
          (u) => evaluateKinematics(
            st.part, st.material, st.punch, st.die, st.steps,
            st.currentStepIdx, u, st.compensateSpringback, st.customKFactor
          ),
          (frame) => detectFrameCollisions(
            frame, st.part, st.punch, st.die, st.punchReversed, st.machine
          ),
          st.strokeProgress,
          clampedU,
        );

        if (stop) {
          // Freeze ONLY at actual contact with a machine/tool surface.
          // Diagnostic near-clearance warnings do not stop the animation.
          // The renderer and OrbitControls must keep working normally.
          pausedByCollision = true;
          setCollisionPaused(true);
          st.onStrokeChange(stop.frame.strokeProgress);
          st.onStopPlay();
        } else if (nextU >= 1.0) {
          if (st.currentStepIdx < st.steps.length - 1) {
            st.onStepChange(st.currentStepIdx + 1);
            st.onStrokeChange(0);
          } else {
            st.onStrokeChange(1.0);
            st.onStopPlay();
          }
        } else {
          st.onStrokeChange(nextU);
        }
      }

      // OrbitControls is updated on every requested frame, including while
      // bending is paused by collision. Its `change` event requests more frames
      // as needed for drag, zoom, pan and damping.
      controls.update();
      renderer.render(scene, camera);
      return (st.isPlaying && !pausedByCollision) || camTransitioning;
    }, {
      requestFrame: isSoftwareGl
        ? (callback) => window.setTimeout(() => callback(performance.now()), 32)
        : (callback) => requestAnimationFrame(callback),
      cancelFrame: isSoftwareGl
        ? (id) => window.clearTimeout(id)
        : (id) => cancelAnimationFrame(id),
    });

    const requestRender = () => frameLoop.invalidate();
    const startActiveLoop = () => {
      pausedByCollision = false;
      setCollisionPaused(false);
      frameLoop.beginAnimation();
    };

    controls.addEventListener('change', requestRender);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', onResize);

    sceneRefs.current = {
      requestRender,
      rebuildTooling,
      updateDynamicFrame,
      setCameraSensitivity,
      restoreMainView: () => {
        camTransitioning = false;
        const home = absoluteMainCamera(returnCameraView, stateRef.current.part.widthMm);
        const dampingWasEnabled = controls.enableDamping;
        // Cancel accumulated OrbitControls movement; otherwise a drag can
        // continue rotating the camera immediately after pressing "Powrót".
        controls.enableDamping = false;
        camera.position.set(...home.pos);
        controls.target.set(...home.target);
        camera.up.set(0, 1, 0);
        controls.saveState();
        controls.reset();
        controls.update();
        controls.enableDamping = dampingWasEnabled;
        requestRender();
      },
      saveMainView: () => {
        camTransitioning = false;
        controls.update();
        const width = stateRef.current.part.widthMm;
        const currentWorld: MainCameraView = {
          pos: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        };
        const relative = relativeMainCamera(currentWorld, width);
        if (!isMainCameraView(relative)) return;
        returnCameraView = relative;
        controls.saveState();
        try {
          window.localStorage.setItem(MAIN_CAMERA_STORAGE_KEY, JSON.stringify(relative));
        } catch { /* browser storage may be disabled */ }
      },
    };

    // Initial render
    requestRender();

    // Start continuous loop whenever playing
    (sceneRefs.current as any).startActiveLoop = startActiveLoop;

    return () => {
      frameLoop.dispose();
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      rulerTex.dispose();
      disposeGroupMeshes(machineGroup);
      disposeGroupMeshes(punchToolGroup);
      disposeGroupMeshes(dieToolGroup);
      disposeGroupMeshes(sheetGroup);
      disposeGroupMeshes(collisionMarkersGroup);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // React updates only the control speeds, without recreating the Three.js scene.
  useEffect(() => {
    sceneRefs.current?.setCameraSensitivity(cameraSensitivity);
    try { window.localStorage.setItem(CAMERA_SENSITIVITY_KEY, String(cameraSensitivity)); }
    catch { /* localStorage may be unavailable */ }
  }, [cameraSensitivity]);

  // Rebuild tooling meshes when punch, die, punchReversed, or part width changes
  useEffect(() => {
    if (!sceneRefs.current) return;
    sceneRefs.current.rebuildTooling();
    sceneRefs.current.updateDynamicFrame();
    sceneRefs.current.requestRender();
  }, [punch, die, punchReversed, part.widthMm, machine]);

  // Update dynamic sheet deformation & collisions whenever kinematic state changes
  useEffect(() => {
    if (!sceneRefs.current) return;
    sceneRefs.current.updateDynamicFrame();
    sceneRefs.current.requestRender();
  }, [
    part,
    material,
    steps,
    currentStepIdx,
    strokeProgress,
    compensateSpringback,
    customKFactor,
    machine,
  ]);

  // An edited workpiece/tool or selected step is a new situation, not the
  // original collision stop. Manual stroke scrubbing is handled below.
  useEffect(() => {
    setCollisionPaused(false);
  }, [part, machine, punch, die, punchReversed, steps, currentStepIdx]);

  // Trigger active playback loop when isPlaying turns true
  useEffect(() => {
    if (isPlaying && sceneRefs.current && (sceneRefs.current as any).startActiveLoop) {
      (sceneRefs.current as any).startActiveLoop();
    }
  }, [isPlaying]);

  const activeBend = part.bends[currentFrame.activeBendIndex];
  const restoreBendingView = () => {
    setCollisionPaused(false);
    onStopPlay();
    onStrokeChange(0.80); // Almost full bend: best visibility before springback.
    sceneRefs.current?.restoreMainView();
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0B1017] select-none">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={mountRef} className="w-full h-full" />

      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B1017]/95 text-slate-200">
          <div className="text-center space-y-2">
            <p className="text-sm font-semibold">Utracono kontekst WebGL 3D</p>
            <p className="text-xs text-slate-400">Trwa przywracanie silnika renderującego...</p>
          </div>
        </div>
      )}

      {/* Return to near-frontal bend close-up at 80%. Save a precise user-adjusted
          view if the default approximation differs from the physical screenshot. */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setCameraPanelOpen(p => !p)}
            title="Ustawienia poruszania kamerą 3D"
            aria-expanded={cameraPanelOpen}
            className="flex items-center gap-1.5 rounded-md border border-slate-600/70 bg-[#142131]/95 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700/95 shadow-lg cursor-pointer"
          ><SlidersHorizontal className="w-4 h-4" /><span className="hidden sm:inline">Kamera</span></button>
          {cameraPanelOpen && (
            <div className="absolute right-0 top-11 w-72 rounded-lg border border-slate-600 bg-[#111b28]/98 p-3 shadow-2xl text-slate-200">
              <label htmlFor="camera-sensitivity" className="mb-1 flex justify-between text-xs font-medium">
                <span>Czułość kamery</span><span className="font-mono text-sky-300">{cameraSensitivity}%</span>
              </label>
              <input id="camera-sensitivity" aria-label="Czułość kamery" type="range" min={20} max={100} step={5}
                value={cameraSensitivity}
                onChange={(e) => setCameraSensitivity(clampCameraSensitivity(Number(e.target.value)))}
                className="w-full accent-sky-500 cursor-pointer" />
              <div className="mt-2 space-y-1 text-[11px] leading-5 text-slate-400">
                <p>Lewy przycisk myszy: obrót</p>
                <p>Prawy przycisk: przesuwanie widoku</p>
                <p>Kółko: płynne przybliżanie / oddalanie</p>
              </div>
              <button type="button" className="mt-3 text-[11px] text-sky-300 hover:text-white"
                onClick={() => setCameraSensitivity(DEFAULT_CAMERA_SENSITIVITY)}>Przywróć domyślną czułość</button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => { sceneRefs.current?.saveMainView(); setViewSaved(true); }}
          title="Zapisz obecne ustawienie kamery jako docelowy widok przycisku Powrót"
          aria-label="Zapisz aktualny widok kamery"
          className="flex items-center gap-1.5 rounded-md border border-slate-600/70 bg-[#142131]/95 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700/95 shadow-lg cursor-pointer"
        ><Camera className="w-4 h-4" /><span className="hidden sm:inline">{viewSaved ? 'Widok zapisany' : 'Zapisz widok'}</span></button>
        <button
          type="button"
          onClick={restoreBendingView}
          title="Powrót do bliskiego widoku gięcia (80% skoku)"
          className="flex items-center gap-2 rounded-md border border-sky-500/60 bg-[#142131]/95 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-800/95 shadow-lg cursor-pointer"
        ><CornerUpLeft className="w-4 h-4" />Powrót</button>
      </div>

      {/* Top-Left Compact Telemetry Overlay (Clean CAD Readout, No Pills) */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-1.5">
        <div className="bg-[#121923]/92 border border-slate-700/70 rounded-md px-3 py-2 pointer-events-auto shadow-lg">
          <div className="text-[11px] font-medium text-sky-400 mb-0.5">
            {machine.manufacturer} {machine.model} · {machine.tonnageTons} t / {machine.bendingLengthMm} mm
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-slate-100">
              Krok {currentStepIdx + 1}/{steps.length}: {activeBend.label}
            </span>
            <span className="text-slate-500">·</span>
            <span className="font-mono tabular-nums text-sky-400">
              Kąt: {turnToIncludedAngleDeg(currentFrame.currentBendAngleDeg).toFixed(1)}°
            </span>
            <span className="text-slate-500">/</span>
            <span className="font-mono tabular-nums text-slate-300">
              Cel: {turnToIncludedAngleDeg(currentFrame.targetBendAngleDeg).toFixed(1)}°
            </span>
            <span className="text-slate-500">·</span>
            <span className="font-mono tabular-nums text-amber-400">
              Δα: +{currentFrame.springback.springbackDeg.toFixed(2)}°
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 font-mono tabular-nums">
            <span>
              Faza:{' '}
              <strong className="text-slate-200 font-medium">
                {currentFrame.phase === 'approach'
                  ? 'Dojazd'
                  : currentFrame.phase === 'bending'
                    ? 'Zaginanie (przeregulowanie)'
                    : 'Powrót sprężysty'}
              </strong>
            </span>
            <span>·</span>
            <span>Zderzak X: {currentFrame.backgaugeXMm.toFixed(1)} mm</span>
            <span>·</span>
            <span>
              Orientacja: {currentFrame.flipHorizontal ? 'Obrót 180°' : 'Standard'}
              {currentFrame.upsideDown ? ' + Odwrócenie góra/dół' : ''}
            </span>
          </div>
        </div>

        {/* Live Collision Banner right below telemetry if active */}
        {criticalEvents.length > 0 ? (
          <div className="bg-red-950/95 border border-red-500/70 rounded-md px-3 py-2 pointer-events-auto flex items-start gap-2.5 max-w-md shadow-lg">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-red-200">
                Kontakt z przeszkodą ({criticalEvents.length}) · Penetracja modelu:{' '}
                <span className="font-mono tabular-nums">
                  {Math.max(...criticalEvents.map((c) => c.penetrationMm)).toFixed(2)} mm
                </span>
              </div>
              <div className="text-red-300/90 mt-0.5">{criticalEvents[0].message}</div>
            </div>
          </div>
        ) : tonnageExceeded ? (
          <div className="bg-red-950/95 border border-red-500/70 rounded-md px-3 py-2 pointer-events-auto flex items-start gap-2.5 max-w-md shadow-lg">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-red-200">
                Przekroczony nacisk prasy ({currentFrame.springback.bendingForceKn} kN &gt; {machine.maxForceKn} kN)
              </div>
              <div className="text-red-300/90 mt-0.5">
                Wymagana siła gięcia przekracza maksymalny tonaż prasy {machine.model}.
              </div>
            </div>
          </div>
        ) : backgaugeOutOfRange ? (
          <div className="bg-red-950/95 border border-red-500/70 rounded-md px-3 py-2 pointer-events-auto flex items-start gap-2.5 max-w-md shadow-lg">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-red-200">
                Poza zakresem zderzaka X ({Math.abs(currentFrame.backgaugeXMm).toFixed(1)} mm &gt; {machine.backgaugeXMaxMm} mm)
              </div>
              <div className="text-red-300/90 mt-0.5">
                Ramię tylne wykracza poza maksymalny wysięg osi X.
              </div>
            </div>
          </div>
        ) : warningEvents.length > 0 ? (
          <div className="bg-amber-950/90 border border-amber-500/60 rounded-md px-3 py-1.5 pointer-events-auto flex items-center gap-2 max-w-md shadow-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-200">{warningEvents[0].message}</span>
          </div>
        ) : (
          <div className="bg-slate-900/90 border border-slate-600/50 rounded-md px-3 py-1.5 pointer-events-auto flex items-center gap-2 w-fit shadow-md">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-xs text-slate-200">Kolizji nie wykryto w tej klatce. Wykonalność niepotwierdzona*</span>
          </div>
        )}
      </div>

      {collisionPaused && !isPlaying && (
        <div className="absolute left-3 top-[165px] z-10 pointer-events-none rounded-md border border-amber-600/60 bg-amber-950/90 px-3 py-2 text-xs text-amber-100 shadow-lg max-w-[340px]">
          Gięcie zatrzymane na pierwszym kontakcie materiału z modelem maszyny. Kamera pozostaje aktywna. Ostrzeżenia o małym prześwicie nie zatrzymują symulacji.
        </div>
      )}

      <div className="absolute top-[132px] left-3 z-10 pointer-events-none text-[10px] text-slate-400 bg-[#0b1017]/80 rounded px-2 py-1 max-w-[340px]">
        * Model brył o stałym przekroju wzdłuż Z. Obrysy narzędzi i korpusu muszą być zmierzone.
      </div>

      {/* Collapsible Bottom Simulation Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-[min(780px,94%)] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="px-3 py-0.5 text-[11px] font-medium text-slate-300 bg-[#121923]/95 border border-b-0 border-slate-700/80 rounded-t-md hover:text-white cursor-pointer"
        >
          {dockCollapsed ? '▴ Pokaż sterowanie suwakiem' : '▾ Ukryj sterowanie'}
        </button>

        {!dockCollapsed && (
          <div className="w-full bg-[#121923]/95 border border-slate-700/80 rounded-lg px-4 py-2.5 shadow-xl flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {/* Step & Play Controls */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setCollisionPaused(false);
                    onStopPlay();
                    onStepChange(Math.max(0, currentStepIdx - 1));
                    onStrokeChange(0);
                  }}
                  disabled={currentStepIdx === 0}
                  title="Poprzednie gięcie"
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlaying ? 'Pauza' : 'Symuluj'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCollisionPaused(false);
                    onStopPlay();
                    onStepChange(Math.min(steps.length - 1, currentStepIdx + 1));
                    onStrokeChange(0);
                  }}
                  disabled={currentStepIdx === steps.length - 1}
                  title="Następne gięcie"
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => { setCollisionPaused(false); onResetSim(); }}
                  title="Resetuj cykl do kroku 1"
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Stroke Scrub Slider with Springback Marker */}
              <div className="flex-1 flex flex-col gap-1">
                <div className="relative flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.005}
                    value={strokeProgress}
                    onChange={(e) => {
                      setCollisionPaused(false);
                      onStopPlay();
                      onStrokeChange(parseFloat(e.target.value));
                    }}
                    aria-label="Postęp skoku suwaka prasy"
                    className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                  />
                  {/* Marker at u=0.82 where Springback release starts */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-amber-400 pointer-events-none"
                    style={{ left: '82%' }}
                    title="Punkt zwrotny: początek powrotu sprężystego (82%)"
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-400">
                  <span>0% Dojazd</span>
                  <span>16% Kontakt</span>
                  <span className="text-amber-400">82% Przeregulowanie → Sprężynowanie</span>
                  <span>100% Koniec</span>
                </div>
              </div>

              {/* Live Stroke Readout */}
              <div className="text-right shrink-0 w-16 font-mono tabular-nums text-xs text-slate-200">
                {(strokeProgress * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
