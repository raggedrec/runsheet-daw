/**
 * The metronome: on/off and click level, owned by the engine.
 *
 * Like the rest of the mix, the state lives in openDAW — here in the engine's
 * preferences, not in a second copy in React. `metronome.enabled` and
 * `metronome.gain` are the two fields that matter; this reads them, mirrors them
 * into state for the controls to render, and writes back through the same
 * mutable values. `gain` is in decibels and openDAW caps it at 0, so the slider
 * works in dB too rather than inventing a 0..1 scale that would have to be
 * mapped twice.
 *
 * The click sounds are loaded once here, because an enabled metronome with no
 * sound loaded is silent — the engine ships none of its own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import type { MutableObservableValue, Terminable } from "@opendaw/lib-std";
import { loadClickSounds } from "./opendaw/metronome";

export interface Metronome {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** Click level in dB, always ≤ 0 (the engine's own range). */
  gainDb: number;
  setGainDb: (db: number) => void;
}

/** The lowest dB the slider offers before it just reads as off. */
export const CLICK_MIN_DB = -36;

export function useMetronome(project: Project | null, sampleRate: number | null): Metronome {
  const [enabled, setEnabledState] = useState(false);
  const [gainDb, setGainDbState] = useState(-6);
  const enabledMV = useRef<(MutableObservableValue<boolean> & Terminable) | null>(null);
  const gainMV = useRef<(MutableObservableValue<number> & Terminable) | null>(null);

  useEffect(() => {
    if (!project || sampleRate === null) return;
    loadClickSounds(project, sampleRate);

    const prefs = project.engine.preferences;
    const en = prefs.createMutableObservableValue("metronome", "enabled");
    const gn = prefs.createMutableObservableValue("metronome", "gain");
    enabledMV.current = en;
    gainMV.current = gn;

    const subs = [
      en.catchupAndSubscribe((o) => setEnabledState(o.getValue())),
      gn.catchupAndSubscribe((o) => setGainDbState(o.getValue())),
    ];

    return () => {
      subs.forEach((s) => s.terminate());
      en.terminate();
      gn.terminate();
      enabledMV.current = null;
      gainMV.current = null;
    };
  }, [project, sampleRate]);

  const setEnabled = useCallback((on: boolean) => enabledMV.current?.setValue(on), []);
  const setGainDb = useCallback((db: number) => gainMV.current?.setValue(Math.min(0, db)), []);

  return { enabled, setEnabled, gainDb, setGainDb };
}
