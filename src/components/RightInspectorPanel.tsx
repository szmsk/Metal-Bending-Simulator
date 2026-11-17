import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  FlipHorizontal2,
  Gauge,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { turnToIncludedAngleDeg } from '../engine/bendingMath';
import {
  BendStepConfig,
  CollisionEvent,
  DieTool,
  PartDefinition,
  PressMachineSpec,
  PunchTool,
  SheetMaterial,
  StepSimulationReport,
  WorkspaceTab,
} from '../types/bending';
import { NumericField } from './NumericField';
import { ToolProfileEditor } from './ToolProfileEditor';

interface RightInspectorPanelProps {
  activeTab: WorkspaceTab;
  part: PartDefinition;
  material: SheetMaterial;
  punch: PunchTool;
  die: DieTool;
  machine: PressMachineSpec;
  onUpdateMachine: (machine: PressMachineSpec) => void;
  punchReversed: boolean;
  compensateSpringback: boolean;
  customKFactor: number | undefined;
  playbackSpeed: number;
  steps: BendStepConfig[];
  stepReports: StepSimulationReport[];
  currentStepIdx: number;
  punchList: PunchTool[];
  dieList: DieTool[];
  onSavePunch: (tool: PunchTool) => void;
  onSaveDie: (tool: DieTool) => void;
  onSelectPunch: (punchId: string) => void;
  onSelectDie: (dieId: string) => void;
  onTogglePunchReversed: () => void;
  onToggleCompensateSpringback: () => void;
  onCustomKFactorChange: (k: number | undefined) => void;
  onPlaybackSpeedChange: (spd: number) => void;
  onJumpToFrame: (stepIdx: number, strokeU: number) => void;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  activeTab,
  part,
  material,
  punch,
  die,
  machine,
  onUpdateMachine,
  punchReversed,
  compensateSpringback,
  customKFactor,
  playbackSpeed,
  steps,
  stepReports,
  currentStepIdx,
  punchList,
  dieList,
  onSavePunch,
  onSaveDie,
  onSelectPunch,
  onSelectDie,
  onTogglePunchReversed,
  onToggleCompensateSpringback,
  onCustomKFactorChange,
  onPlaybackSpeedChange,
  onJumpToFrame,
}) => {
  const allCollisions: CollisionEvent[] = stepReports.flatMap((r) => r.collisions);
  const criticalCount = allCollisions.filter((c) => c.severity === 'critical').length;
  const warningCount = allCollisions.filter((c) => c.severity === 'warning').length;
  const tonnageExceededAny = stepReports.some((r) => r.tonnageExceeded);
  const backgaugeOutAny = stepReports.some((r) => r.backgaugeOutOfRange);
  const shortFlangeAny = stepReports.some((r) => r.springback.flangeTooShort);
  const toolLoadAny = stepReports.some((r) => r.toolLoadExceeded);
  const lengthOverAny = stepReports.some((r) => r.bendingLengthExceeded);
  const incompleteSampling = stepReports.some((r) => !r.samplingConverged);
  const missingToolingCoverage = stepReports.some((r) => !r.toolingCoversSheetWidth);

  const isImpossible = criticalCount > 0 || tonnageExceededAny || backgaugeOutAny || toolLoadAny || lengthOverAny || missingToolingCoverage;
  const hasWarnings = !isImpossible && (warningCount > 0 || shortFlangeAny || incompleteSampling);
  const activeReport = stepReports[currentStepIdx];

  return (
    <aside className="w-[348px] shrink-0 h-full bg-[#121923] border-l border-slate-800 flex flex-col overflow-hidden">
      {/* Header Summary Strip */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-100">
          {activeTab === 'simulation' && 'Ocena Wykonalności i Kolizje'}
          {activeTab === 'springback' && 'Analiza Sprężynowania Δα'}
          {activeTab === 'tooling' && 'Narzędzia i Parametry Prasy'}
        </h2>
        <span
          className={`text-[11px] font-mono tabular-nums font-medium ${
            isImpossible
              ? 'text-red-400'
              : hasWarnings
                ? 'text-amber-400'
                : 'text-slate-300'
          }`}
        >
          {isImpossible
            ? 'Kolizja / limit'
            : hasWarnings
              ? `${warningCount} ostrzeżeń`
              : 'Niepotwierdzone'}
        </span>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: FEASIBILITY & COLLISION SIMULATION */}
        {activeTab === 'simulation' && (
          <>
            {/* Overall Feasibility Verdict */}
            <div
              className={`rounded-md border p-3 flex items-start gap-2.5 ${
                isImpossible
                  ? 'bg-red-950/45 border-red-600/60 text-red-100'
                  : hasWarnings
                    ? 'bg-amber-950/40 border-amber-600/60 text-amber-100'
                    : 'bg-slate-800/70 border-slate-600 text-slate-100'
              }`}
            >
              {isImpossible ? (
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              ) : hasWarnings ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div className="text-xs space-y-1">
                <div className="font-semibold">
                  {isImpossible
                    ? 'Wykryto kolizję lub przekroczenie limitu w modelu'
                    : hasWarnings
                      ? 'Nie można potwierdzić wykonalności'
                      : 'Brak potwierdzenia: geometria narzędzi przybliżona'}
                </div>
                <div className="text-[11px] opacity-85 leading-relaxed">
                  {isImpossible
                    ? [
                        criticalCount > 0 ? `${criticalCount} kolizji narzędzia/korpusu` : null,
                        tonnageExceededAny ? `przekroczony nacisk ${machine.maxForceKn} kN` : null,
                        backgaugeOutAny ? `przekroczony wysięg zderzaka ${machine.backgaugeXMaxMm} mm` : null,
                        toolLoadAny ? 'przeciążone narzędzie' : null,
                        lengthOverAny ? 'przekroczona długość robocza' : null,
                        missingToolingCoverage ? 'brak pokrycia całej długości linii przez stempel / matrycę' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : hasWarnings
                      ? 'Sprawdź wykryte prześwity i kompletność próbkowania. Brak zderzenia nie jest gwarancją wykonalności.'
                      : `W ${steps.length} gięciach nie wykryto przenikania brył. Uproszczone obrysy narzędzi i prowadzenie detalu nie pozwalają wykluczyć zderzenia na Twojej prasie.`}
                </div>
              </div>
            </div>

            {part.id === 'channel-c-50-80-50' && (
              <div className="border border-amber-600/50 bg-amber-950/25 rounded-md p-3 text-[11px] text-amber-100 space-y-1">
                <div className="font-semibold">Profil C 50×80×50: zgłoszona kolizja na rzeczywistej maszynie</div>
                <div>Ten preset ma przykładową grubość 2 mm, promień i długość gięcia. Jeśli model nie wykrywa przecięcia, sprawdź ostrzeżenie o prześwicie i wprowadź dokładny obrys stempla, jego mocowania, matrycy i uchwytów. Wynik nie oznacza możliwości wykonania detalu.</div>
              </div>
            )}

            {/* Active Step Telemetry Grid */}
            {activeReport && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-slate-400">
                  Aktywny krok {currentStepIdx + 1}: Gięcie {activeReport.bendLabel}
                </div>
                <div className="grid grid-cols-2 gap-px bg-slate-800 border border-slate-800 rounded overflow-hidden">
                  <div className="bg-[#0E141D] p-2.5">
                    <div className="text-[10px] text-slate-400">Kąt docelowy (CAD)</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-100 mt-0.5">
                      {turnToIncludedAngleDeg(activeReport.springback.targetAngleDeg).toFixed(1)}°
                    </div>
                  </div>
                  <div className="bg-[#0E141D] p-2.5">
                    <div className="text-[10px] text-slate-400">Przeregulowanie CNC</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-amber-400 mt-0.5">
                      {turnToIncludedAngleDeg(activeReport.springback.overbendAngleDeg).toFixed(2)}°
                    </div>
                  </div>
                  <div className="bg-[#0E141D] p-2.5">
                    <div className="text-[10px] text-slate-400">Siła nacisku</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-sky-400 mt-0.5">
                      {activeReport.springback.bendingForceKn} kN
                    </div>
                  </div>
                  <div className="bg-[#0E141D] p-2.5">
                    <div className="text-[10px] text-slate-400">Penetracja osi Y</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-100 mt-0.5">
                      -{activeReport.springback.ramPenetrationMm} mm
                    </div>
                  </div>
                </div>
                {activeReport.springback.flangeTooShort && (
                  <div className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-700/50 rounded px-2.5 py-1.5">
                    Uwaga: Ramię oporowe krótsze niż min. dla matrycy V{die.vOpeningMm} ({die.minFlangeMm} mm).
                  </div>
                )}
                {activeReport.tonnageExceeded && (
                  <div className="text-[11px] text-red-200 bg-red-950/70 border border-red-600/60 rounded px-2.5 py-1.5">
                    Przekroczony nacisk prasy {machine.model}: wymagane{' '}
                    {activeReport.springback.bendingForceKn} kN &gt; {machine.maxForceKn} kN!
                  </div>
                )}
                {!activeReport.toolingCoversSheetWidth && (
                    <div className="text-[11px] text-red-200 bg-red-950/70 border border-red-600/60 rounded px-2.5 py-1.5">
                      Stempel lub matryca nie pokrywa całej długości gięcia w osi Z. Taki wynik „brak kolizji” jest nieważny.
                    </div>
                  )}
                {activeReport.toolLoadExceeded && (
                  <div className="text-[11px] text-red-200 bg-red-950/70 border border-red-600/60 rounded px-2.5 py-1.5">
                    Obciążenie narzędzia przekracza limit kN/m dla wybranego stempla lub matrycy.
                  </div>
                )}
                {activeReport.bendingLengthExceeded && (
                  <div className="text-[11px] text-red-200 bg-red-950/70 border border-red-600/60 rounded px-2.5 py-1.5">
                    Długość gięcia przekracza {machine.bendingLengthMm} mm.
                  </div>
                )}
                <div className="text-[11px] text-slate-400">
                  Przeanalizowano {activeReport.checkedFrames} pozycji skoku
                  {!activeReport.samplingConverged && <span className="text-red-300"> · osiągnięto limit zagęszczania, wynik niepełny</span>}.
                </div>
                {activeReport.backgaugeOutOfRange && (
                  <div className="text-[11px] text-red-200 bg-red-950/70 border border-red-600/60 rounded px-2.5 py-1.5">
                    Poza zakresem osi X zderzaka ({Math.abs(activeReport.backgaugeXMm).toFixed(1)} mm &gt; {machine.backgaugeXMaxMm} mm).
                  </div>
                )}
              </div>
            )}

            {/* Full Sequence Collision Report */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                  <span>Wykryte kolizje w sekwencji (3D)</span>
                </span>
              </div>

              {allCollisions.length === 0 ? (
                <div className="border border-slate-800 bg-[#0E141D] rounded-md p-3 text-xs text-slate-300">
                  Nie wykryto przenikania brył 3D w próbkach przebiegu gięcia. To nie potwierdza bezpieczeństwa ani wykonalności na rzeczywistej prasie.
                </div>
              ) : (
                <div className="space-y-2">
                  {allCollisions.map((ev) => (
                    <div
                      key={ev.id}
                      className={`rounded-md border p-2.5 space-y-1.5 ${
                        ev.severity === 'critical'
                          ? 'bg-red-950/40 border-red-700/60'
                          : 'bg-amber-950/35 border-amber-700/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-semibold flex items-center gap-1.5 ${
                            ev.severity === 'critical' ? 'text-red-300' : 'text-amber-300'
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Krok {ev.stepOrderIndex + 1} ({ev.bendLabel})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onJumpToFrame(ev.stepOrderIndex, ev.strokeProgress)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-sky-300 flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Crosshair className="w-3 h-3" />
                          <span>Pokaż w 3D</span>
                        </button>
                      </div>

                      <div className="text-xs text-slate-200">{ev.message}</div>

                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                        <span>Skok: {(ev.strokeProgress * 100).toFixed(0)}%</span>
                        <span>·</span>
                        <span>Kąt: {turnToIncludedAngleDeg(ev.angleAtCollisionDeg).toFixed(1)}°</span>
                        {ev.contactPoint3Dmm && (
                          <span title="Współrzędne kontaktu (mm)" className="text-sky-300">Z: {ev.contactPoint3Dmm.z.toFixed(1)} mm</span>
                        )}
                        <span>·</span>
                        {ev.severity === 'critical' ? (
                          <span className="text-red-400">
                            Penetracja: {ev.penetrationMm} mm
                          </span>
                        ) : (
                          <span className="text-amber-400">
                            Prześwit: {ev.clearanceMm} mm
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </>
        )}

        {/* TAB 2: SPRINGBACK CALCULATIONS */}
        {activeTab === 'springback' && activeReport && (
          <>
            <div className="flex items-center justify-between bg-[#0E141D] border border-slate-800 rounded-md p-3">
              <div>
                <div className="text-xs font-semibold text-slate-100">
                  Kompensacja sprężynowania
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {compensateSpringback
                    ? 'Prasa przegina detal o +Δα'
                    : 'Wyłączona — widać błąd niedogięcia'}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleCompensateSpringback}
                className={`px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${
                  compensateSpringback
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {compensateSpringback ? 'Włączona' : 'Wyłączona'}
              </button>
            </div>

            {/* Interactive Springback Angle Diagram */}
            <div className="bg-[#0E141D] border border-slate-800 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Wykres gięcia: {activeReport.bendLabel}
                </span>
                <span className="font-mono tabular-nums text-amber-400">
                  Δα = +{activeReport.springback.springbackDeg.toFixed(2)}°
                </span>
              </div>

              <svg viewBox="0 0 280 110" className="w-full h-28 bg-[#0B1017] rounded border border-slate-800/80">
                <line x1="20" y1="88" x2="140" y2="88" stroke="#64748b" strokeWidth="3" />
                {(() => {
                  const targetRad = (Math.abs(activeReport.springback.targetAngleDeg) * Math.PI) / 180;
                  const overRad = (activeReport.springback.overbendAngleDeg * Math.PI) / 180;
                  const uncompRad = (activeReport.springback.uncompensatedAngleDeg * Math.PI) / 180;
                  const r = 68;
                  const cx = 140;
                  const cy = 88;
                  const tx = cx + Math.cos(targetRad) * r;
                  const ty = cy - Math.sin(targetRad) * r;
                  const ox = cx + Math.cos(overRad) * r;
                  const oy = cy - Math.sin(overRad) * r;
                  const ux = cx + Math.cos(uncompRad) * r;
                  const uy = cy - Math.sin(uncompRad) * r;
                  return (
                    <g>
                      <line
                        x1={cx}
                        y1={cy}
                        x2={ux}
                        y2={uy}
                        stroke="#64748b"
                        strokeWidth="2"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={cx}
                        y1={cy}
                        x2={ox}
                        y2={oy}
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                      />
                      <line
                        x1={cx}
                        y1={cy}
                        x2={tx}
                        y2={ty}
                        stroke="#38bdf8"
                        strokeWidth="3"
                      />
                      <circle cx={cx} cy={cy} r="3.5" fill="#e2e8f0" />
                      <text x="16" y="20" fill="#38bdf8" fontSize="10" fontFamily="monospace">
                        Cel: {turnToIncludedAngleDeg(activeReport.springback.targetAngleDeg).toFixed(1)}°
                      </text>
                      <text x="16" y="36" fill="#f59e0b" fontSize="10" fontFamily="monospace">
                        Przereg.: {turnToIncludedAngleDeg(activeReport.springback.overbendAngleDeg).toFixed(2)}°
                      </text>
                      <text x="16" y="52" fill="#94a3b8" fontSize="10" fontFamily="monospace">
                        Bez kor.: {turnToIncludedAngleDeg(activeReport.springback.uncompensatedAngleDeg).toFixed(2)}°
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>

            {/* K-Factor Calibration */}
            <div className="bg-[#0E141D] border border-slate-800 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Współczynnik osi obojętnej K</span>
                <div className="flex items-center gap-2">
                  <NumericField
                    ariaLabel="Współczynnik osi obojętnej K"
                    value={customKFactor ?? activeReport.springback.kFactor}
                    min={0.3}
                    max={0.5}
                    decimals={3}
                    onChange={(val) => onCustomKFactorChange(val)}
                    className="w-16 bg-[#0B1017] border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-sky-400 focus:outline-none focus:border-sky-500"
                  />
                  {customKFactor !== undefined && (
                    <button
                      type="button"
                      onClick={() => onCustomKFactorChange(undefined)}
                      className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      Auto
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={0.30}
                max={0.50}
                step={0.005}
                value={customKFactor ?? activeReport.springback.kFactor}
                onChange={(e) => onCustomKFactorChange(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded cursor-pointer"
              />
            </div>

            {/* Per-Bend Engineering Table */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-200">
                Tabela parametrów sprężynowania i BA/BD
              </div>
              <div className="border border-slate-800 rounded overflow-hidden">
                <table className="w-full text-[11px] font-mono tabular-nums">
                  <thead className="bg-[#0E141D] text-slate-400">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Gięcie</th>
                      <th className="text-right px-2 py-1.5 font-medium">Cel</th>
                      <th className="text-right px-2 py-1.5 font-medium">Δα</th>
                      <th className="text-right px-2 py-1.5 font-medium">Ri</th>
                      <th className="text-right px-2 py-1.5 font-medium">BD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {stepReports.map((rep, idx) => (
                      <tr
                        key={`${rep.bendIndex}-${idx}`}
                        onClick={() => onJumpToFrame(idx, 0.85)}
                        className={`cursor-pointer transition-colors ${
                          idx === currentStepIdx
                            ? 'bg-sky-950/40 text-slate-100'
                            : 'hover:bg-slate-800/40 text-slate-300'
                        }`}
                      >
                        <td className="px-2 py-1.5 font-semibold">{rep.bendLabel}</td>
                        <td className="px-2 py-1.5 text-right">
                          {turnToIncludedAngleDeg(rep.springback.targetAngleDeg).toFixed(0)}°
                        </td>
                        <td className="px-2 py-1.5 text-right text-amber-400">
                          +{rep.springback.springbackDeg.toFixed(2)}°
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {rep.springback.effectiveRadiusMm}
                        </td>
                        <td className="px-2 py-1.5 text-right text-sky-300">
                          {rep.springback.bendDeductionMm.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Material Mechanical Properties */}
            <div className="border-t border-slate-800 pt-3 text-[11px] text-slate-400 space-y-1 font-mono tabular-nums">
              <div className="text-slate-300 font-sans font-semibold text-xs mb-1">
                Model sprężysto-plastyczny: {material.code}
              </div>
              <div className="flex justify-between">
                <span>Moduł Younga (E):</span>
                <span className="text-slate-200">{material.elasticModulusMPa} MPa</span>
              </div>
              <div className="flex justify-between">
                <span>Granica plastyczności (Re):</span>
                <span className="text-slate-200">{material.yieldStrengthMPa} MPa</span>
              </div>
              <div className="flex justify-between">
                <span>Wytrzymałość (Rm):</span>
                <span className="text-slate-200">{material.tensileStrengthMPa} MPa</span>
              </div>
              <div className="flex justify-between">
                <span>Krzywa Hollomona (K / n):</span>
                <span className="text-slate-200">
                  {material.strengthCoeffK} MPa / {material.hardeningExponentN}
                </span>
              </div>
            </div>
          </>
        )}

        {/* TAB 3: TOOLING & PRESS */}
        {activeTab === 'tooling' && (
          <>
            {/* Ermaksan Power-Bend Falcon 4100-175 Machine Card */}
            <div className="bg-[#0E141D] border border-slate-800 rounded-md p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-sky-400 font-medium">
                    {machine.manufacturer}
                  </div>
                  <div className="text-xs font-semibold text-slate-100">
                    {machine.model}
                  </div>
                </div>
                <span className="text-xs font-mono tabular-nums font-semibold text-slate-200">
                  {machine.tonnageTons} t / {machine.bendingLengthMm} mm
                </span>
              </div>

              {activeReport && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono tabular-nums">
                    <span className="text-slate-400">Obciążenie prasy</span>
                    <span
                      className={
                        activeReport.tonnageExceeded ? 'text-red-400 font-semibold' : 'text-sky-300'
                      }
                    >
                      {activeReport.springback.bendingForceKn} / {machine.maxForceKn} kN (
                      {Math.min(
                        999,
                        Math.round(
                          (activeReport.springback.bendingForceKn / machine.maxForceKn) *
                            100
                        )
                      )}
                      %)
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        activeReport.tonnageExceeded ? 'bg-red-500' : 'bg-sky-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          (activeReport.springback.bendingForceKn / machine.maxForceKn) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-slate-400 pt-1 border-t border-slate-800/80">
                <div className="flex justify-between">
                  <span>Rozstaw kolumn:</span>
                  <span className="text-slate-200">{machine.distanceBetweenColumnsMm} mm</span>
                </div>
                <div className="flex justify-between">
                  <span>Gardziel C:</span>
                  <span className="text-slate-200">{machine.throatDepthMm} mm</span>
                </div>
                <div className="flex justify-between">
                  <span>Skok / Otwarcie:</span>
                  <span className="text-slate-200">
                    {machine.strokeMm} / {machine.daylightMm}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Zderzak X max:</span>
                  <span className="text-slate-200">{machine.backgaugeXMaxMm} mm</span>
                </div>
                <div className="flex justify-between">
                  <span>Prędkości Y:</span>
                  <span className="text-slate-200">
                    {machine.approachSpeedMmS}/{machine.bendSpeedMmS}/
                    {machine.returnSpeedMmS}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stół (szer.):</span>
                  <span className="text-slate-200">{machine.tableWidthMm} mm</span>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                Mocowanie: <span className="text-slate-200">{machine.clampingSystem}</span>
              </div>
              <details className="border-t border-slate-800 pt-2">
                <summary className="text-[11px] text-sky-300 cursor-pointer">Obrysy uchwytów i belki (wymiary zmierzone)</summary>
                <p className="text-[10px] text-amber-300 my-2">
                  Fabryczne wartości są poglądowe. Podaj półszerokości od osi gięcia i wymiary zmierzone na swojej prasie.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['clampHalfWidthMm', 'Półszer. zacisku'],
                    ['ramHalfWidthMm', 'Półszer. belki'],
                    ['ramBodyHeightMm', 'Wys. belki'],
                    ['dieHolderHalfWidthMm', 'Półszer. obsady matrycy'],
                    ['dieHolderHeightMm', 'Wys. obsady matrycy'],
                    ['bedHalfWidthMm', 'Półszer. stołu'],
                    ['backgaugeFingerDepthMm', 'Głęb. palca zderzaka'],
                    ['backgaugeFingerHeightMm', 'Wys. palca zderzaka'],
                  ] as const).map(([field, label]) => (
                    <label key={field} className="text-[10px] text-slate-400">
                      {label} (mm)
                      <input type="number" min="1" max="1000" step="0.5"
                        value={machine.collisionGeometry[field]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (n > 0 && n <= 1000) onUpdateMachine({
                            ...machine, collisionGeometry: { ...machine.collisionGeometry, [field]: n },
                          });
                        }}
                        className="mt-1 w-full bg-[#121923] border border-slate-700 rounded p-1.5 text-xs font-mono text-slate-100"/>
                    </label>
                  ))}
                </div>
              </details>
              <details className="border-t border-slate-800 pt-2" open>
                <summary className="text-[11px] font-semibold text-sky-300 cursor-pointer">Rozmieszczenie narzędzi w osi Z (3D)</summary>
                <p className="text-[10px] text-slate-400 my-2">Z = 0 oznacza środek prasy. Ustaw rzeczywistą długość narzędzi, położenie blachy i palców zderzaka.</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['toolLengthMm', 'Długość narzędzia', Math.min(machine.bendingLengthMm, Math.max(420, part.widthMm + 140))],
                    ['toolOffsetZMm', 'Przesunięcie narzędzia Z', 0],
                    ['partOffsetZMm', 'Przesunięcie blachy Z', 0],
                    ['backgaugeFingerSeparationMm', 'Rozstaw palców Z', Math.min(3300,Math.max(80,part.widthMm*.68))],
                    ['backgaugeFingerWidthMm', 'Szerokość palca Z', 22],
                  ] as const).map(([field, label, fallback]) => (
                    <label key={field} className="text-[10px] text-slate-400">{label} (mm)
                      <input type="number" step="1"
                        value={machine.collisionGeometry[field] ?? fallback}
                        onChange={e => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) onUpdateMachine({...machine,collisionGeometry:{...machine.collisionGeometry,[field]:n}});
                        }}
                        className="mt-1 w-full bg-[#121923] border border-slate-700 rounded p-1.5 text-xs font-mono text-slate-100" />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-400">Opcjonalne segmenty stempla i matrycy: jeden przedział Z na linię, format <code>-250;0</code>. Zatwierdź zmianę poza polem.</p>
                {(['punchStationsZMm','dieStationsZMm'] as const).map(field => (
                  <label key={field} className="block text-[10px] text-slate-400 mt-2">
                    {field==='punchStationsZMm'?'Segmenty stempla':'Segmenty matrycy'}
                    <textarea key={`${field}-${machine.collisionGeometry[field]?.length ?? 0}`}
                      defaultValue={(machine.collisionGeometry[field]??[]).map(seg => `${seg.startMm};${seg.endMm}`).join('\n')}
                      placeholder="Puste = jedno narzędzie o długości podanej wyżej"
                      onBlur={e => {
                        const text = e.target.value.trim();
                        const rows = text ? text.split(/\r?\n/).map(line => line.split(/[;,]/).map(Number)) : [];
                        if (rows.some(row => row.length!==2 || row.some(v => !Number.isFinite(v)) || row[1]<=row[0])) { e.target.setCustomValidity('Błędny zakres. Wpisz start;koniec w mm'); e.target.reportValidity(); return; }
                        e.target.setCustomValidity('');
                        onUpdateMachine({...machine,collisionGeometry:{...machine.collisionGeometry,[field]:rows.map(([startMm,endMm])=>({startMm,endMm}))}});
                      }}
                      rows={2} className="mt-1 w-full resize-y bg-[#121923] border border-slate-700 rounded p-1.5 text-xs font-mono text-slate-100" />
                  </label>
                ))}
              </details>
              <label className="block text-[11px] text-amber-200 border-t border-slate-800 pt-2">
                Margines kontrolny przy gotowych zagięciach (mm)
                <input type="number" min="0" max="30" step="0.5"
                  value={machine.collisionGeometry.minimumFreeClearanceMm ?? 8}
                  onChange={e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n <= 30)
                      onUpdateMachine({...machine, collisionGeometry:{...machine.collisionGeometry, minimumFreeClearanceMm:n}});
                  }}
                  className="mt-1 w-full bg-[#121923] border border-amber-800 rounded p-1.5 text-xs font-mono text-slate-100" />
                <span className="block mt-1 text-[10px] text-amber-300">8 mm to próg diagnostycznego ostrzeżenia, nie tolerancja bezpiecznej pracy. Ostrzeżenie NIE zatrzymuje gięcia. Odtwarzanie zatrzymuje się dopiero przy kontakcie obrysów w modelu.</span>
              </label>
              <p className="text-[10px] text-amber-300">Detektor 3D obsługuje bryły o stałym przekroju wzdłuż Z. Nie modeluje jeszcze dowolnych modeli STEP ani odkształceń kontaktowych. Domyślne wymiary korpusu są orientacyjne.</p>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Stempel górny</span>
                <button
                  type="button"
                  onClick={onTogglePunchReversed}
                  className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                    punchReversed
                      ? 'bg-sky-600/25 border-sky-500 text-sky-300'
                      : 'border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  <FlipHorizontal2 className="w-3 h-3" />
                  <span>{punchReversed ? 'Odwrócony 180°' : 'Obróć 180°'}</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {punchList.map((p) => {
                  const selected = p.id === punch.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPunch(p.id)}
                      className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer flex items-center gap-3 ${
                        selected
                          ? 'bg-sky-950/45 border-sky-500/80'
                          : 'bg-[#0E141D] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <svg
                        viewBox="-30 -5 60 160"
                        className="w-11 h-16 bg-[#0B1017] rounded border border-slate-800 shrink-0"
                      >
                        <polygon
                          points={p.profile2D
                            .map((pt) => `${punchReversed && selected ? -pt.x : pt.x},${150 - pt.y}`)
                            .join(' ')}
                          fill={selected ? '#38bdf8' : '#64748b'}
                          fillOpacity="0.85"
                        />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {p.name}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-sky-300/90 mt-0.5">
                          H:{p.heightMm}+30 · {p.tipAngleDeg}° · R{p.tipRadiusMm} ·{' '}
                          {Math.round(p.maxLoadKnPerM / 9.81)} t/m
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 leading-snug">
                          {p.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="rounded border border-amber-700/60 bg-amber-950/25 p-2 text-[10px] leading-relaxed text-amber-200">
                Potwierdzone katalogowo: model, kąt, promień, wysokość i nośność.
                <strong> Obrys kolizyjny stempla jest nadal szacunkowy!</strong> Etykieta narzędzia
                nie zawiera wymiarów odsunięcia szyjki ani szczegółów uchwytu, które
                mogą spowodować kolizję przy drugim gięciu profilu C.
                {' '}<a className="underline" target="_blank" rel="noopener noreferrer"
                  href={punch.code.startsWith('PS.')
                    ? 'https://www.rolleritools.com/tools-6437/press-brakes/tools/type-r1-punches/ps13585r08-6700'
                    : 'https://www.rolleritools.com/tools-6437/press-brakes/tools/type-r1-punches/top17560r5-6594'}>
                  Dokumentacja Rolleri
                </a>
              </div>
              <ToolProfileEditor kind="punch" tool={punch} onSave={onSavePunch} />
            </div>

            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Matryca dolna V</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  8×t = V{Math.round(part.thicknessMm * 8)}
                </span>
              </div>

              <div className="space-y-1.5">
                {dieList.map((d) => {
                  const selected = d.id === die.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onSelectDie(d.id)}
                      className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                        selected
                          ? 'bg-sky-950/45 border-sky-500/80'
                          : 'bg-[#0E141D] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100">{d.name}</div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                          V{d.vOpeningMm} · {d.vAngleDeg}° · R{d.shoulderRadiusMm} · Min {d.minFlangeMm} mm
                        </div>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                        {d.maxLoadKnPerM} kN/m
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="rounded border border-amber-700/60 bg-amber-950/25 p-2 text-[10px] leading-relaxed text-amber-200">
                M.460.R to jeden korpus z czterema rowkami: V16, V22, V35 i V50, 85°.
                Wybór V odpowiada obróceniu matrycy. <strong>Symulator przedstawia
                uproszczony korpus z aktywnym rowkiem; pozostałe trzy rowki boczne
                nie są jeszcze odwzorowane z rysunku producenta.</strong>
                {' '}<a className="underline" target="_blank" rel="noopener noreferrer"
                  href="https://www.rolleritools.com/tools-6437/press-brakes/tools/type-r1-dies/m460r-6802">
                  Dokumentacja Rolleri
                </a>
              </div>
              <ToolProfileEditor kind="die" tool={die} onSave={onSaveDie} />
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-sky-400" />
                  <span>Prędkość symulacji</span>
                </span>
                <span className="font-mono tabular-nums text-sky-400">{playbackSpeed}x</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[0.5, 1, 1.5, 2].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => onPlaybackSpeedChange(spd)}
                    className={`py-1 rounded text-xs font-mono cursor-pointer ${
                      playbackSpeed === spd
                        ? 'bg-sky-600 text-white'
                        : 'bg-[#0E141D] border border-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
