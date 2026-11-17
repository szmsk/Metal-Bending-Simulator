import {
  DieTool,
  PartDefinition,
  Point2D,
  PressMachineSpec,
  PunchTool,
  SheetMaterial,
} from '../types/bending';

export const PRESS_MACHINES: PressMachineSpec[] = [
  {
    id: 'ermaksan-falcon-4100-175',
    manufacturer: 'Ermaksan',
    model: 'Power-Bend Falcon 4100-175',
    bendingLengthMm: 4100,
    distanceBetweenColumnsMm: 3600,
    tonnageTons: 175,
    maxForceKn: 1717,
    strokeMm: 275,
    daylightMm: 550,
    throatDepthMm: 410,
    backgaugeXMaxMm: 800,
    backgaugeXSpeedMmS: 500,
    approachSpeedMmS: 180,
    bendSpeedMmS: 10,
    returnSpeedMmS: 135,
    tableWidthMm: 90,
    tableHeightMm: 900,
    clampingSystem: 'Promecam / Europejski (szybkomocujący)',
    cncController: 'Delem DA-66T / ESA S640 (Y1, Y2, X, R + Crowning)',
    hasCrowning: true,
    // Illustrative cross-section envelopes, NOT measured on the customer's press.
    collisionGeometry: {
      clampHalfWidthMm: 23,
      ramHalfWidthMm: 34,
      ramBodyHeightMm: 260,
      dieHolderHalfWidthMm: 45,
      dieHolderHeightMm: 25,
      bedHalfWidthMm: 60,
      backgaugeFingerDepthMm: 45,
      backgaugeFingerHeightMm: 18,
      // Diagnostic only. Check gaps smaller than this against an unmeasured tool contour.
      minimumFreeClearanceMm: 8,
    },
  },
];

export const DEFAULT_MACHINE = PRESS_MACHINES[0];

export const MATERIALS: SheetMaterial[] = [
  {
    id: 'dc01',
    name: 'Stal czarna DC01 / S235JR',
    code: '1.0330',
    elasticModulusMPa: 210000,
    yieldStrengthMPa: 240,
    tensileStrengthMPa: 360,
    strengthCoeffK: 530,
    hardeningExponentN: 0.22,
    poissonRatio: 0.3,
    defaultKFactor: 0.42,
    colorHex: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.32,
  },
  {
    id: 's355mc',
    name: 'Stal konstrukcyjna S355MC',
    code: '1.0976',
    elasticModulusMPa: 210000,
    yieldStrengthMPa: 355,
    tensileStrengthMPa: 490,
    strengthCoeffK: 720,
    hardeningExponentN: 0.18,
    poissonRatio: 0.3,
    defaultKFactor: 0.44,
    colorHex: 0x7a8899,
    metalness: 0.88,
    roughness: 0.36,
  },
  {
    id: 'aisi304',
    name: 'Stal nierdzewna 1.4301 (304)',
    code: 'AISI 304',
    elasticModulusMPa: 193000,
    yieldStrengthMPa: 290,
    tensileStrengthMPa: 620,
    strengthCoeffK: 1275,
    hardeningExponentN: 0.45,
    poissonRatio: 0.29,
    defaultKFactor: 0.45,
    colorHex: 0xd0d9e4,
    metalness: 0.94,
    roughness: 0.18,
  },
  {
    id: 'alu5754',
    name: 'Aluminium EN AW-5754 H111',
    code: 'AlMg3',
    elasticModulusMPa: 70000,
    yieldStrengthMPa: 110,
    tensileStrengthMPa: 215,
    strengthCoeffK: 315,
    hardeningExponentN: 0.24,
    poissonRatio: 0.33,
    defaultKFactor: 0.40,
    colorHex: 0xe2e8f0,
    metalness: 0.9,
    roughness: 0.24,
  },
  {
    id: 'alu6061',
    name: 'Aluminium EN AW-6061 T6',
    code: 'AlMg1SiCu',
    elasticModulusMPa: 69000,
    yieldStrengthMPa: 275,
    tensileStrengthMPa: 310,
    strengthCoeffK: 410,
    hardeningExponentN: 0.08,
    poissonRatio: 0.33,
    defaultKFactor: 0.43,
    colorHex: 0xcbd5e1,
    metalness: 0.89,
    roughness: 0.26,
  },
  {
    id: 'copper',
    name: 'Miedź elektrolityczna Cu-ETP',
    code: 'CW004A',
    elasticModulusMPa: 115000,
    yieldStrengthMPa: 120,
    tensileStrengthMPa: 240,
    strengthCoeffK: 360,
    hardeningExponentN: 0.32,
    poissonRatio: 0.34,
    defaultKFactor: 0.38,
    colorHex: 0xd98a5f,
    metalness: 0.92,
    roughness: 0.22,
  },
];

/**
 * Helper to create a V-Die polygon in mm.
 * Top shoulder plane is y=0, centered at x=0.
 */
function buildVDieProfile(vOpening: number, vAngleDeg: number, width: number, height: number): Point2D[] {
  const halfV = vOpening / 2;
  const halfW = width / 2;
  const halfAngleRad = ((vAngleDeg / 2) * Math.PI) / 180;
  const vDepth = halfV / Math.tan(halfAngleRad);
  const shoulder = 1.5;

  return [
    { x: -halfW, y: 0 },
    { x: -halfV - shoulder, y: 0 },
    { x: -halfV, y: -0.6 },
    { x: 0, y: -vDepth },
    { x: halfV, y: -0.6 },
    { x: halfV + shoulder, y: 0 },
    { x: halfW, y: 0 },
    { x: halfW, y: -height },
    { x: -halfW, y: -height },
  ];
}

export const PUNCH_TOOLS: PunchTool[] = [
  {
    id: 'rolleri-ps-135-85-r08-fx',
    name: 'Rolleri PS.135.85.R08 (85°, R0,8)',
    code: 'PS.135.85.R08',
    type: 'straight',
    tipAngleDeg: 85,
    tipRadiusMm: 0.8,
    heightMm: 105,
    maxLoadKnPerM: 1000,
    description:
      'Rolleri PS.135.85.R08: H robocza 105 mm, całkowita 135 mm, 85°, R0,8; obciążenie katalogowe 1000 kN/m. Masa ok. 21,2 kg/m. Kształt w symulacji jest SZACOWANY, nie wczytany z DXF. Wariant segmentacji FX nie jest potwierdzony na zdjęciu.',
    // Symmetric straight R1 punch: working height H=105mm (+30mm tang), 85° tip, R0.8, 25mm straight body
    profile2D: [
      { x: 0, y: 0 },
      { x: 0.8, y: 0.7 },
      { x: 9.5, y: 10.2 },
      { x: 12.5, y: 20 },
      { x: 12.5, y: 84 },
      { x: 13.0, y: 90 },
      { x: 13.0, y: 105 },
      { x: -13.0, y: 105 },
      { x: -13.0, y: 90 },
      { x: -12.5, y: 84 },
      { x: -12.5, y: 20 },
      { x: -9.5, y: 10.2 },
      { x: -0.8, y: 0.7 },
    ],
  },
  {
    id: 'rolleri-top-175-60-r5',
    name: 'Rolleri TOP.175.60.R5 (Prosty ciężki)',
    code: 'TOP.175.60.R5',
    type: 'straight',
    tipAngleDeg: 60,
    tipRadiusMm: 5.0,
    heightMm: 145,
    maxLoadKnPerM: 1600,
    description:
      'Rolleri TOP.175.60.R5: H robocza 145 mm, całkowita 175 mm, 60°, R5; obciążenie katalogowe 1600 kN/m. Masa ok. 41 kg/m (21,5 kg przy długości 525 mm). Kształt w symulacji jest SZACOWANY, nie wczytany z DXF.',
    // Heavy straight R1 punch: working height H=145mm (+30mm tang), 60° tip, R5 nose, 38mm heavy body
    profile2D: [
      { x: 0, y: 0 },
      { x: 2.6, y: 0.7 },
      { x: 4.3, y: 2.5 },
      { x: 19.0, y: 28 },
      { x: 19.0, y: 132 },
      { x: 13.5, y: 140 },
      { x: 13.5, y: 145 },
      { x: -13.5, y: 145 },
      { x: -13.5, y: 140 },
      { x: -19.0, y: 132 },
      { x: -19.0, y: 28 },
      { x: -4.3, y: 2.5 },
      { x: -2.6, y: 0.7 },
    ],
  },
];

// M.460.R: rzeczywista matryca czterorowkowa V16/22/35/50, 85°,
// promienie odpowiednio R2/R2/R2/R3, dopuszczalne obciążenie 800 kN/m.
// Cztery wpisy to UPROSZCZONE ustawienia jednego korpusu obróconego do aktywnego V.
// Kształt bocznych i dolnych rowków NIE został odtworzony z DXF, więc test
// kolizji z bokiem matrycy ma ograniczoną wiarygodność.
export const DIE_TOOLS: DieTool[] = [
  {
    id: 'die-v16',
    name: 'Rolleri M.460.R (4V) · V16 / 85°',
    code: 'M.460.R-V16',
    vOpeningMm: 16,
    vAngleDeg: 85,
    shoulderRadiusMm: 2.0,
    heightMm: 60,
    widthMm: 60,
    maxLoadKnPerM: 800,
    minFlangeMm: 11.5,
    profile2D: buildVDieProfile(16, 85, 60, 60),
  },
  {
    id: 'die-v22',
    name: 'Rolleri M.460.R (4V) · V22 / 85°',
    code: 'M.460.R-V22',
    vOpeningMm: 22,
    vAngleDeg: 85,
    shoulderRadiusMm: 2.0,
    heightMm: 60,
    widthMm: 60,
    maxLoadKnPerM: 800,
    minFlangeMm: 15.5,
    profile2D: buildVDieProfile(22, 85, 60, 60),
  },
  {
    id: 'die-v35',
    name: 'Rolleri M.460.R (4V) · V35 / 85°',
    code: 'M.460.R-V35',
    vOpeningMm: 35,
    vAngleDeg: 85,
    shoulderRadiusMm: 2.0,
    heightMm: 60,
    widthMm: 60,
    maxLoadKnPerM: 800,
    minFlangeMm: 24.5,
    profile2D: buildVDieProfile(35, 85, 60, 60),
  },
  {
    id: 'die-v50',
    name: 'Rolleri M.460.R (4V) · V50 / 85°',
    code: 'M.460.R-V50',
    vOpeningMm: 50,
    vAngleDeg: 85,
    shoulderRadiusMm: 3.0,
    heightMm: 60,
    widthMm: 60,
    maxLoadKnPerM: 800,
    minFlangeMm: 35.0,
    profile2D: buildVDieProfile(50, 85, 60, 60),
  },
  {
    id: 'die-v80',
    name: 'Matryca V80 / 85° (grube blachy 8–10 mm)',
    code: 'V80-85-HD',
    vOpeningMm: 80,
    vAngleDeg: 85,
    shoulderRadiusMm: 6.0,
    heightMm: 95,
    widthMm: 110,
    maxLoadKnPerM: 1200,
    minFlangeMm: 56.5,
    profile2D: buildVDieProfile(80, 85, 110, 95),
  },
];

export const PART_PRESETS: PartDefinition[] = [
  {
    id: 'cad-profile-35-45-120-53',
    name: 'Profil z rysunku CAD 35×45×120×53 (127°, t=4 mm)',
    description:
      'Profil ze zdjęcia CAD: blacha grubości 4 mm, ramiona 35 / 45 / 120 / 53 mm, dwa gięcia 90° oraz gięcie 53° (kąt rozwarty wewnątrz 127°).',
    thicknessMm: 4.0,
    widthMm: 1000,
    materialId: 'dc01',
    segmentLengthsMm: [35, 45, 120, 53],
    bends: [
      { id: 'b1', label: 'G1', targetAngleDeg: 90, insideRadiusMm: 4.5 },
      { id: 'b2', label: 'G2', targetAngleDeg: 90, insideRadiusMm: 4.5 },
      { id: 'b3', label: 'G3', targetAngleDeg: 53, insideRadiusMm: 4.5 },
    ],
  },
  {
    id: 'channel-c-50-80-50',
    name: 'Profil C 50×80×50 mm (sprawdzenie kolizji)',
    description: 'Dwa gięcia 90°. Grubość 2 mm, długość gięcia 1000 mm i promień wewnętrzny 2.5 mm są WYŁĄCZNIE przykładowe. Wprowadź rzeczywiste wartości oraz obrysy narzędzi. Na Ermaksanie zgłoszono kolizję tego profilu, której domyślny stempel nie odwzorowywał.',
    thicknessMm: 2,
    widthMm: 1000,
    materialId: 'dc01',
    segmentLengthsMm: [50, 80, 50],
    bends: [
      { id: 'c50-g1', label: 'G1', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'c50-g2', label: 'G2', targetAngleDeg: 90, insideRadiusMm: 2.5 },
    ],
  },
  {
    id: 'c-channel-clash',
    name: 'Kanał C z Kołnierzem Powrotnym',
    description:
      'Głęboki profil C z górnym zawinięciem 26 / 64 / 48 / 30 mm (3 gięcia po 90°) do weryfikacji prześwitu narzędziowego.',
    thicknessMm: 2.0,
    widthMm: 260,
    materialId: 'dc01',
    segmentLengthsMm: [26, 64, 48, 30],
    bends: [
      { id: 'b1', label: 'G1', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b2', label: 'G2', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b3', label: 'G3', targetAngleDeg: 90, insideRadiusMm: 2.5 },
    ],
  },
  {
    id: 'z-profile-stepped',
    name: 'Profil Z-Kształtny Stopniowany',
    description:
      'Profil zetowy z przeciwnym kierunkiem gięć (+90° / -90° / +90°) z blachy nierdzewnej 2.5 mm.',
    thicknessMm: 2.5,
    widthMm: 300,
    materialId: 'aisi304',
    segmentLengthsMm: [68, 26, 72, 36],
    bends: [
      { id: 'b1', label: 'G1', targetAngleDeg: 90, insideRadiusMm: 3.0 },
      { id: 'b2', label: 'G2', targetAngleDeg: -90, insideRadiusMm: 3.0 },
      { id: 'b3', label: 'G3', targetAngleDeg: 90, insideRadiusMm: 3.0 },
    ],
  },
  {
    id: 'bracket-5-bend',
    name: 'Wspornik Wielokątny 5-Gięciowy',
    description:
      'Uchwyt montażowy ze stali S355MC (t=2.0 mm) z 5 gięciami (+90° / +90° / -75° / +90° / -85°).',
    thicknessMm: 2.0,
    widthMm: 220,
    materialId: 's355mc',
    segmentLengthsMm: [28, 52, 46, 70, 34, 24],
    bends: [
      { id: 'b1', label: 'G1', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b2', label: 'G2', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b3', label: 'G3', targetAngleDeg: -75, insideRadiusMm: 2.5 },
      { id: 'b4', label: 'G4', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b5', label: 'G5', targetAngleDeg: -85, insideRadiusMm: 2.5 },
    ],
  },
  {
    id: 'alu-enclosure',
    name: 'Korytko Kapeluszowe Al-6061 T6',
    description:
      'Aluminium 6061-T6 o dużym kącie sprężynowania (Δα > 6°) z czterema gięciami (-90° / +90° / +90° / -90°).',
    thicknessMm: 2.0,
    widthMm: 340,
    materialId: 'alu6061',
    segmentLengthsMm: [26, 48, 84, 48, 26],
    bends: [
      { id: 'b1', label: 'G1', targetAngleDeg: -90, insideRadiusMm: 2.8 },
      { id: 'b2', label: 'G2', targetAngleDeg: 90, insideRadiusMm: 2.8 },
      { id: 'b3', label: 'G3', targetAngleDeg: 90, insideRadiusMm: 2.8 },
      { id: 'b4', label: 'G4', targetAngleDeg: -90, insideRadiusMm: 2.8 },
    ],
  },
  {
    id: 'facade-cassette-2500',
    name: 'Kaseta Elewacyjna 2500 mm (Falcon)',
    description:
      'Długi element fasadowy 2500 mm z blachy 2.0 mm DC01 na prasę Ermaksan Power-Bend Falcon 4100-175.',
    thicknessMm: 2.0,
    widthMm: 2500,
    materialId: 'dc01',
    segmentLengthsMm: [30, 120, 45, 25],
    bends: [
      { id: 'b1', label: 'G1', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b2', label: 'G2', targetAngleDeg: 90, insideRadiusMm: 2.5 },
      { id: 'b3', label: 'G3', targetAngleDeg: 90, insideRadiusMm: 2.5 },
    ],
  },
];
