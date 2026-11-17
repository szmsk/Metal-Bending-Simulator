import React, { useEffect, useState } from 'react';
import type { DieTool, PunchTool } from '../types/bending';
import { parseProfile, stringifyProfile } from '../engine/profileValidation';

type Props =
  | { kind: 'punch'; tool: PunchTool; onSave: (tool: PunchTool) => void }
  | { kind: 'die'; tool: DieTool; onSave: (tool: DieTool) => void };

/** Enables measured or traced outlines, without implying that a profile is certified. */
export function ToolProfileEditor(props: Props) {
  const [open, setOpen] = useState(false);
  const [outline, setOutline] = useState('');
  const [height, setHeight] = useState(0);
  const [vOpening, setVOpening] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    setOutline(stringifyProfile(props.tool.profile2D));
    setHeight(props.tool.heightMm);
    if (props.kind === 'die') {
      setVOpening(props.tool.vOpeningMm);
      setWidth(props.tool.widthMm);
    }
    setError('');
  }, [props.tool]);

  const save = () => {
    try {
      const points = parseProfile(outline);
      if (!Number.isFinite(height) || height <= 0 || height > 1000)
        throw new Error('Wysokość narzędzia musi być w zakresie 0–1000 mm.');
      if (props.kind === 'punch') {
        if (points.some((pt) => pt.y < -0.5 || pt.y > height + 0.5))
          throw new Error('Stempel: obrys musi leżeć w zakresie Y=0…H od czubka.');
        props.onSave({
          ...props.tool, id: 'custom-punch', name: 'Własny stempel (obrys 2D)',
          profile2D: points, heightMm: height, profileOrigin: 'user',
          description: 'Wprowadzony ręcznie obrys. Zweryfikuj wymiary na rzeczywistym narzędziu.',
        });
      } else {
        if (!Number.isFinite(vOpening) || vOpening <= 0 || !Number.isFinite(width) || width < vOpening)
          throw new Error('Podaj prawidłową szerokość matrycy i rozwarcie V (V ≤ szerokość).');
        if (points.some((pt) => pt.y > 0.5 || pt.y < -height - 0.5))
          throw new Error('Matryca: obrys musi leżeć w zakresie Y=-H…0 od powierzchni górnej.');
        props.onSave({
          ...props.tool, id: 'custom-die', name: 'Własna matryca (obrys 2D)',
          profile2D: points, heightMm: height, vOpeningMm: vOpening,
          widthMm: width, profileOrigin: 'user',
        });
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nieprawidłowy format profilu.');
    }
  };

  return (
    <div className="border border-slate-700 rounded bg-[#0B1017] p-2.5 space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="text-xs text-sky-300 hover:text-sky-200 cursor-pointer text-left w-full">
        {open ? 'Zamknij edytor obrysu' : `Wprowadź rzeczywisty obrys ${props.kind === 'punch' ? 'stempla' : 'matrycy'} (2D)`}
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-[11px] text-amber-300 leading-relaxed">
            Domyślne kontury są orientacyjne. Wprowadź zmierzone współrzędne punktów
            po obwodzie narzędzia, w mm. Nie zapewnia to jeszcze weryfikacji 3D.
          </p>
          <label className="block text-[11px] text-slate-400">
            Punkty x y, jeden na linię (lub JSON [[x,y],...])
            <textarea spellCheck={false} value={outline} onChange={(e) => setOutline(e.target.value)}
              rows={6} className="mt-1 w-full font-mono text-[11px] bg-[#121923] text-slate-100 border border-slate-700 rounded p-2 resize-y"/>
          </label>
          <label className="block text-[11px] text-slate-400">Wysokość H (mm)
            <input type="number" min={1} max={1000} step="0.1" value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="block mt-1 w-full text-xs bg-[#121923] border border-slate-700 rounded p-1.5 text-slate-100"/>
          </label>
          {props.kind === 'die' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-400">Otwarcie V (mm)
                <input type="number" min={1} step="0.1" value={vOpening}
                  onChange={(e) => setVOpening(Number(e.target.value))}
                  className="block mt-1 w-full text-xs bg-[#121923] border border-slate-700 rounded p-1.5 text-slate-100"/>
              </label>
              <label className="text-[11px] text-slate-400">Szerokość (mm)
                <input type="number" min={1} step="0.1" value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="block mt-1 w-full text-xs bg-[#121923] border border-slate-700 rounded p-1.5 text-slate-100"/>
              </label>
            </div>
          )}
          {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
          <button type="button" onClick={save}
            className="rounded px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold cursor-pointer">
            Zapisz własny obrys
          </button>
          <div className="text-[10px] text-slate-500">
            Jeden przekrój X/Y. Brak STL/STEP, promieni i uchwytów 3D oraz kontroli po osi Z.
          </div>
        </div>
      )}
    </div>
  );
}
