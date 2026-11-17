import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  FlipHorizontal2,
  Layers,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { MATERIALS, PART_PRESETS } from '../data/library';
import { includedToTurnAngleDeg, turnToIncludedAngleDeg } from '../engine/bendingMath';
import {
  BendStepConfig,
  PartDefinition,
  SheetMaterial,
  StepSimulationReport,
} from '../types/bending';
import { NumericField } from './NumericField';

interface LeftSequencePanelProps {
  part: PartDefinition;
  material: SheetMaterial;
  steps: BendStepConfig[];
  stepReports: StepSimulationReport[];
  currentStepIdx: number;
  onSelectPreset: (presetId: string) => void;
  onUpdatePart: (updated: PartDefinition) => void;
  onSelectStep: (stepIdx: number) => void;
  onMoveStep: (stepIdx: number, dir: -1 | 1) => void;
  onToggleFlip: (stepIdx: number) => void;
}

export const LeftSequencePanel: React.FC<LeftSequencePanelProps> = ({
  part,
  material,
  steps,
  stepReports,
  currentStepIdx,
  onSelectPreset,
  onUpdatePart,
  onSelectStep,
  onMoveStep,
  onToggleFlip,
}) => {
  const [editGeometry, setEditGeometry] = useState(true);

  const handleThicknessChange = (val: number) => {
    if (!Number.isFinite(val)) return;
    onUpdatePart({ ...part, thicknessMm: Math.max(0.5, Math.min(12, val)) });
  };

  const handleWidthChange = (val: number) => {
    if (!Number.isFinite(val)) return;
    onUpdatePart({ ...part, widthMm: Math.max(40, Math.min(4100, val)) });
  };

  const handleSegmentChange = (idx: number, len: number) => {
    if (!Number.isFinite(len)) return;
    const nextSegs = [...part.segmentLengthsMm];
    nextSegs[idx] = Math.max(10, Math.min(750, len));
    onUpdatePart({ ...part, segmentLengthsMm: nextSegs });
  };

  const handleBendIncludedAngleChange = (idx: number, rawVal: number, currentSign: 1 | -1) => {
    if (!Number.isFinite(rawVal)) return;
    if (Math.abs(rawVal) < 30) return;
    const nextSign: 1 | -1 = rawVal < 0 ? -1 : currentSign;
    const clampedIncluded = Math.max(30, Math.min(175, Math.abs(rawVal)));
    const nextTurn = includedToTurnAngleDeg(clampedIncluded, nextSign);
    const nextBends = part.bends.map((b, i) =>
      i === idx ? { ...b, targetAngleDeg: nextTurn } : b
    );
    onUpdatePart({ ...part, bends: nextBends });
  };

  const handleToggleBendDirection = (idx: number) => {
    const nextBends = part.bends.map((b, i) =>
      i === idx ? { ...b, targetAngleDeg: -b.targetAngleDeg } : b
    );
    onUpdatePart({ ...part, bends: nextBends });
  };

  const handleAddBend = () => {
    if (part.bends.length >= 6) return;
    const nextIdx = part.bends.length + 1;
    onUpdatePart({
      ...part,
      segmentLengthsMm: [...part.segmentLengthsMm, 38],
      bends: [
        ...part.bends,
        {
          id: `b${Date.now()}`,
          label: `G${nextIdx}`,
          targetAngleDeg: 90,
          insideRadiusMm: 2.5,
        },
      ],
    });
  };

  const handleRemoveLastBend = () => {
    if (part.bends.length <= 1) return;
    onUpdatePart({
      ...part,
      segmentLengthsMm: part.segmentLengthsMm.slice(0, -1),
      bends: part.bends.slice(0, -1),
    });
  };

  return (
    <aside className="w-[296px] shrink-0 h-full bg-[#121923] border-r border-slate-800 flex flex-col overflow-hidden">
      {/* Part & Material Configuration */}
      <div className="p-3.5 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>Detal i Materiał</span>
          </h2>
          <button
            type="button"
            onClick={() => setEditGeometry((v) => !v)}
            className={`text-[11px] font-medium px-2 py-0.5 rounded border transition-colors cursor-pointer flex items-center gap-1 ${
              editGeometry
                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                : 'border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>{editGeometry ? 'Gotowe' : 'Edytuj profil'}</span>
          </button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Szablon detalu CAD</label>
            <select
              value={part.id}
              onChange={(e) => onSelectPreset(e.target.value)}
              className="w-full bg-[#0B1017] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
            >
              {PART_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Gatunek blachy</label>
            <select
              value={part.materialId}
              onChange={(e) => onUpdatePart({ ...part, materialId: e.target.value })}
              className="w-full bg-[#0B1017] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
            >
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (Re {m.yieldStrengthMPa} MPa)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Grubość t (mm)</label>
              <NumericField
                ariaLabel="Grubość blachy w mm"
                value={part.thicknessMm}
                min={0.5}
                max={12}
                onChange={handleThicknessChange}
                className="w-full bg-[#0B1017] border border-slate-700 rounded px-2.5 py-1 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Długość gięcia (mm)</label>
              <NumericField
                ariaLabel="Długość gięcia w mm"
                value={part.widthMm}
                min={40}
                max={4100}
                onChange={handleWidthChange}
                className="w-full bg-[#0B1017] border border-slate-700 rounded px-2.5 py-1 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Parametric Profile Editor */}
        {editGeometry && (
          <div className="pt-2 border-t border-slate-800 space-y-2 max-h-56 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-300">
                Segmenty i kąty gięcia
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddBend}
                  disabled={part.bends.length >= 6}
                  title="Dodaj gięcie"
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-sky-400 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={handleRemoveLastBend}
                  disabled={part.bends.length <= 1}
                  title="Usuń ostatnie gięcie"
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {part.segmentLengthsMm.map((segLen, sIdx) => (
                <React.Fragment key={sIdx}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-400 font-mono w-14 shrink-0">
                      S{sIdx + 1} (mm)
                    </span>
                    <NumericField
                      ariaLabel={`Długość odcinka S${sIdx + 1} w mm`}
                      value={segLen}
                      min={10}
                      max={750}
                      onChange={(val) => handleSegmentChange(sIdx, val)}
                      className="flex-1 bg-[#0B1017] border border-slate-700 rounded px-2 py-0.5 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  {sIdx < part.bends.length && (() => {
                    const b = part.bends[sIdx];
                    const dirSign: 1 | -1 = b.targetAngleDeg >= 0 ? 1 : -1;
                    const cadAngle = turnToIncludedAngleDeg(b.targetAngleDeg);
                    return (
                      <div className="flex items-center justify-between gap-1.5 text-xs pl-3">
                        <span className="text-sky-400 font-mono w-11 shrink-0">
                          {b.label} (°)
                        </span>
                        <NumericField
                          ariaLabel={`Kąt między ramionami ${b.label} w stopniach`}
                          value={cadAngle}
                          min={-175}
                          max={175}
                          allowNegative={true}
                          onChange={(val) => handleBendIncludedAngleChange(sIdx, val, dirSign)}
                          className="flex-1 min-w-0 bg-[#0B1017] border border-sky-800/60 rounded px-2 py-0.5 text-xs font-mono tabular-nums text-sky-200 focus:outline-none focus:border-sky-400"
                        />
                        <button
                          type="button"
                          onClick={() => handleToggleBendDirection(sIdx)}
                          title={dirSign > 0 ? 'Kierunek: w górę (+). Kliknij, aby odwrócić' : 'Kierunek: w dół (−). Kliknij, aby odwrócić'}
                          className={`px-1.5 py-0.5 rounded border text-[11px] font-mono shrink-0 cursor-pointer ${
                            dirSign > 0
                              ? 'bg-[#0B1017] border-slate-700 text-sky-300 hover:border-sky-500'
                              : 'bg-amber-950/50 border-amber-600/60 text-amber-300 hover:border-amber-400'
                          }`}
                        >
                          {dirSign > 0 ? '↑' : '↓'}
                        </button>
                      </div>
                    );
                  })()}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bend Sequence List */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-200">
            Sekwencja gięć ({steps.length})
          </h2>
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            E {(material.elasticModulusMPa / 1000).toFixed(0)} GPa
          </span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {steps.map((step, sIdx) => {
            const bend = part.bends[step.bendIndex];
            const rep = stepReports[sIdx];
            const isActive = sIdx === currentStepIdx;
            const critCount = rep?.collisions.filter((c) => c.severity === 'critical').length ?? 0;
            const warnCount = rep?.collisions.filter((c) => c.severity === 'warning').length ?? 0;

            return (
              <div
                key={`${step.bendIndex}-${sIdx}`}
                onClick={() => onSelectStep(sIdx)}
                className={`p-3 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-sky-950/45'
                    : 'hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-5 h-5 rounded text-[11px] font-mono font-semibold flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {sIdx + 1}
                    </span>
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      Gięcie {bend.label}
                    </span>
                    {critCount > 0 ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Kolizja</span>
                      </span>
                    ) : rep?.tonnageExceeded || rep?.backgaugeOutOfRange || rep?.toolLoadExceeded || rep?.bendingLengthExceeded ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Limit prasy</span>
                      </span>
                    ) : !rep?.toolingCoversSheetWidth ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" /><span>Brak narzędzia</span>
                      </span>
                    ) : warnCount > 0 || !rep?.samplingConverged ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Sprawdź</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Niezweryfikowane*</span>
                      </span>
                    )}
                  </div>

                  {/* Reorder & Flip Controls */}
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleFlip(sIdx)}
                      title="Obrót detalu 180° w poziomie"
                      className={`p-1 rounded transition-colors cursor-pointer ${
                        step.flipHorizontal
                          ? 'bg-sky-600/30 text-sky-300'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <FlipHorizontal2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveStep(sIdx, -1)}
                      disabled={sIdx === 0}
                      title="Przesuń wcześniej"
                      className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveStep(sIdx, 1)}
                      disabled={sIdx === steps.length - 1}
                      title="Przesuń później"
                      className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Clean Unboxed Engineering Readout */}
                <div className="mt-1.5 pl-7 flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                  <span>
                    {turnToIncludedAngleDeg(bend.targetAngleDeg).toFixed(0)}° {bend.targetAngleDeg >= 0 ? '↑' : '↓'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300/90">
                    Δα {rep ? `+${rep.springback.springbackDeg.toFixed(2)}°` : '—'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{step.flipHorizontal ? 'Obrót 180°' : 'Przód'}</span>
                  {rep?.upsideDown && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-sky-300">Odwr.</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
