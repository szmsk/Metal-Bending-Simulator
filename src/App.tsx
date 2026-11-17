import React, { useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pause, Play } from 'lucide-react';
import { DEFAULT_MACHINE, DIE_TOOLS, MATERIALS, PART_PRESETS, PUNCH_TOOLS } from './data/library';
import { simulateFullSequenceCollisions } from './engine/collisionEngine';
import { BendStepConfig, DieTool, PartDefinition, PressMachineSpec, PunchTool, WorkspaceTab } from './types/bending';
import { PressBrakeViewport } from './components/PressBrakeViewport';
import { LeftSequencePanel } from './components/LeftSequencePanel';
import { RightInspectorPanel } from './components/RightInspectorPanel';

function createDefaultSteps(part: PartDefinition): BendStepConfig[] {
  return part.bends.map((_, idx) => ({
    bendIndex: idx,
    flipHorizontal: false,
  }));
}

function loadCustomTool<T>(key: string): T | undefined {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : undefined;
  } catch { return undefined; }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('simulation');
  const [customPunch, setCustomPunch] = useState<PunchTool | undefined>(() => loadCustomTool<PunchTool>('falcon-custom-punch'));
  const [customDie, setCustomDie] = useState<DieTool | undefined>(() => loadCustomTool<DieTool>('falcon-custom-die'));
  const punchList = useMemo(() => customPunch ? [...PUNCH_TOOLS, customPunch] : PUNCH_TOOLS, [customPunch]);
  const dieList = useMemo(() => customDie ? [...DIE_TOOLS, customDie] : DIE_TOOLS, [customDie]);
  const [machine, setMachine] = useState<PressMachineSpec>(() =>
    loadCustomTool<PressMachineSpec>('falcon-machine') ?? DEFAULT_MACHINE
  );
  const handleUpdateMachine = (next: PressMachineSpec) => {
    setMachine(next);
    try { window.localStorage.setItem('falcon-machine', JSON.stringify(next)); } catch { /* private mode */ }
  };
  const handleSavePunch = (tool: PunchTool) => {
    setCustomPunch(tool);
    try { window.localStorage.setItem('falcon-custom-punch', JSON.stringify(tool)); } catch { /* private browser mode */ }
    setPunchId(tool.id);
  };
  const handleSaveDie = (tool: DieTool) => {
    setCustomDie(tool);
    try { window.localStorage.setItem('falcon-custom-die', JSON.stringify(tool)); } catch { /* private browser mode */ }
    setDieId(tool.id);
  };
  const [part, setPart] = useState<PartDefinition>(PART_PRESETS[0]);
  const [punchId, setPunchId] = useState<string>(() => customPunch?.id ?? PUNCH_TOOLS[0].id);
  const [dieId, setDieId] = useState<string>(() => customDie?.id ?? DIE_TOOLS[2].id); // V35 (Rolleri M.460.R) dla blachy 4 mm
  const [punchReversed, setPunchReversed] = useState<boolean>(false);
  const [compensateSpringback, setCompensateSpringback] = useState<boolean>(true);
  const [customKFactor, setCustomKFactor] = useState<number | undefined>(undefined);

  const [steps, setSteps] = useState<BendStepConfig[]>(() => createDefaultSteps(PART_PRESETS[0]));
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(2);
  const [strokeProgress, setStrokeProgress] = useState<number>(0.72);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);

  const material = useMemo(
    () => MATERIALS.find((m) => m.id === part.materialId) ?? MATERIALS[0],
    [part.materialId]
  );
  const punch = useMemo(
    () => punchList.find((p) => p.id === punchId) ?? PUNCH_TOOLS[0],
    [punchId, punchList]
  );
  const die = useMemo(
    () => dieList.find((d) => d.id === dieId) ?? DIE_TOOLS[2],
    [dieId, dieList]
  );

  // Full swept-stroke collision, springback & machine limit simulation for the user-defined sequence
  const stepReports = useMemo(
    () =>
      simulateFullSequenceCollisions(
        part,
        material,
        punch,
        die,
        steps,
        compensateSpringback,
        punchReversed,
        customKFactor,
        20,
        machine
      ),
    [part, material, punch, die, steps, compensateSpringback, punchReversed, customKFactor, machine]
  );

  const handleSelectPreset = (presetId: string) => {
    const found = PART_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setIsPlaying(false);
    setPart(found);
    setSteps(createDefaultSteps(found));

    const matchedDie =
      DIE_TOOLS.find((d) => d.vOpeningMm >= found.thicknessMm * 7.5) ??
      DIE_TOOLS[DIE_TOOLS.length - 1];
    setDieId(matchedDie.id);

    setCurrentStepIdx(0);
    setStrokeProgress(0.75);
  };

  const handleUpdatePart = (updated: PartDefinition) => {
    setIsPlaying(false);
    setPart(updated);
    if (updated.bends.length !== steps.length) {
      const nextSteps = createDefaultSteps(updated);
      setSteps(nextSteps);
      setCurrentStepIdx(0);
      setStrokeProgress(0);
    }
  };

  const handleMoveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const tmp = next[idx];
    next[idx] = next[target];
    next[target] = tmp;
    setSteps(next);
    setCurrentStepIdx(target);
  };

  const handleToggleFlip = (idx: number) => {
    const next = steps.map((s, i) =>
      i === idx ? { ...s, flipHorizontal: !s.flipHorizontal } : s
    );
    setSteps(next);
  };

  const handleTogglePlay = () => {
    if (!isPlaying) {
      if (currentStepIdx >= steps.length - 1 && strokeProgress >= 0.99) {
        setCurrentStepIdx(0);
        setStrokeProgress(0);
      }
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  const handleRunFullSimulation = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setCurrentStepIdx(0);
      setStrokeProgress(0);
      setIsPlaying(true);
    }
  };

  const handleResetSim = () => {
    setIsPlaying(false);
    setCurrentStepIdx(0);
    setStrokeProgress(0);
  };

  const handleJumpToFrame = (stepIdx: number, strokeU: number) => {
    setIsPlaying(false);
    setCurrentStepIdx(stepIdx);
    setStrokeProgress(strokeU);
  };

  const navItems: { id: WorkspaceTab; label: string }[] = [
    { id: 'simulation', label: 'Symulacja i Wykonalność' },
    { id: 'springback', label: 'Sprężynowanie Δα' },
    { id: 'tooling', label: 'Narzędzia i Prasa' },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B1017] text-slate-100 overflow-hidden">
      {/* Top Bar Contract: 3 Zones (Wordmark — Nav Links — 1 Primary Action) */}
      <header className="h-12 shrink-0 bg-[#121923] border-b border-slate-800 px-4 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setLeftCollapsed((v) => !v)}
            title={leftCollapsed ? 'Pokaż panel sekwencji' : 'Ukryj panel sekwencji'}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
          <span className="text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            Symulacja Gięcia 3D
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 h-full">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (rightCollapsed) setRightCollapsed(false);
                }}
                className={`h-full px-1 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRunFullSimulation}
            className="px-3.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Zatrzymaj symulację' : 'Symuluj pełny cykl'}</span>
          </button>
          <button
            type="button"
            onClick={() => setRightCollapsed((v) => !v)}
            title={rightCollapsed ? 'Pokaż inspektor inżynierski' : 'Ukryj inspektor inżynierski'}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            {rightCollapsed ? (
              <PanelRightOpen className="w-4 h-4" />
            ) : (
              <PanelRightClose className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Main 3-Column Engineering Workstation */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {!leftCollapsed && (
          <LeftSequencePanel
            part={part}
            material={material}
            steps={steps}
            stepReports={stepReports}
            currentStepIdx={currentStepIdx}
            onSelectPreset={handleSelectPreset}
            onUpdatePart={handleUpdatePart}
            onSelectStep={(idx) => {
              setIsPlaying(false);
              setCurrentStepIdx(idx);
              setStrokeProgress(0.82);
            }}
            onMoveStep={handleMoveStep}
            onToggleFlip={handleToggleFlip}
          />
        )}

        {/* Central 3D Simulation Viewport */}
        <section className="flex-1 min-w-0 h-full relative">
          <PressBrakeViewport
            part={part}
            material={material}
            punch={punch}
            die={die}
            machine={machine}
            steps={steps}
            currentStepIdx={currentStepIdx}
            strokeProgress={strokeProgress}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            compensateSpringback={compensateSpringback}
            punchReversed={punchReversed}
            customKFactor={customKFactor}
            onStepChange={setCurrentStepIdx}
            onStrokeChange={setStrokeProgress}
            onTogglePlay={handleTogglePlay}
            onStopPlay={() => setIsPlaying(false)}
            onResetSim={handleResetSim}
          />
        </section>

        {!rightCollapsed && (
          <RightInspectorPanel
            activeTab={activeTab}
            part={part}
            material={material}
            punch={punch}
            die={die}
            machine={machine}
            onUpdateMachine={handleUpdateMachine}
            punchReversed={punchReversed}
            compensateSpringback={compensateSpringback}
            customKFactor={customKFactor}
            playbackSpeed={playbackSpeed}
            steps={steps}
            stepReports={stepReports}
            currentStepIdx={currentStepIdx}
            punchList={punchList}
            dieList={dieList}
            onSavePunch={handleSavePunch}
            onSaveDie={handleSaveDie}
            onSelectPunch={setPunchId}
            onSelectDie={setDieId}
            onTogglePunchReversed={() => setPunchReversed((v) => !v)}
            onToggleCompensateSpringback={() => setCompensateSpringback((v) => !v)}
            onCustomKFactorChange={setCustomKFactor}
            onPlaybackSpeedChange={setPlaybackSpeed}
            onJumpToFrame={handleJumpToFrame}
          />
        )}
      </main>
    </div>
  );
}
