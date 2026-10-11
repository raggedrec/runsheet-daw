/**
 * The engine's master output level.
 *
 * openDAW broadcasts the mix's peaks out of the audio worklet on one global
 * address — EngineAddresses.PEAKS — read here through the project's live-stream
 * receiver. There is no per-unit peak address in the SDK, so this is the master
 * bus only; per-track playback meters would need engine internals that aren't
 * exposed.
 *
 * The receiver fires whenever the engine has new peaks (driven by the same
 * AnimationFrame pump the rest of the UI depends on). Each frame we take the
 * loudest channel, then reset — so if the engine stops sending, the meter falls
 * to silence instead of freezing at the last value. Ballistics, hold and the
 * clip latch live in `meter.ts`, timed by the frame's real timestamp.
 *
 * RUNTIME-UNVERIFIED: the PEAKS float layout isn't documented; taking the max
 * magnitude across the array is the safe reading. Verify it moves with playback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { EngineAddresses } from "@opendaw/studio-adapters";
import { SILENT_METER, clearClip, feedMeter, type MeterState } from "./meter";

export interface MasterMeter {
  reading: MeterState;
  clearClip: () => void;
}

export function useMasterMeter(project: Project | null): MasterMeter {
  const [reading, setReading] = useState<MeterState>(SILENT_METER);
  const state = useRef<MeterState>(SILENT_METER);
  const incoming = useRef(0);

  useEffect(() => {
    state.current = SILENT_METER;
    setReading(SILENT_METER);
    if (!project) return;

    const sub = project.liveStreamReceiver.subscribeFloats(EngineAddresses.PEAKS, (floats) => {
      let max = 0;
      for (let i = 0; i < floats.length; i++) {
        const a = Math.abs(floats[i]);
        if (a > max) max = a;
      }
      if (max > incoming.current) incoming.current = max;
    });

    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const peak = incoming.current;
      incoming.current = 0; // reset each frame — no fresh peak means silence
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      state.current = feedMeter(state.current, peak, dt);
      setReading(state.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      sub.terminate();
      cancelAnimationFrame(frame);
    };
  }, [project]);

  const clear = useCallback(() => {
    state.current = clearClip(state.current);
    setReading(state.current);
  }, []);

  return { reading, clearClip: clear };
}
