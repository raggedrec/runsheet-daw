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
 * to silence instead of freezing at the last value. Fast attack, slow release,
 * the way a meter should move.
 *
 * RUNTIME-UNVERIFIED: the PEAKS float layout isn't documented; taking the max
 * magnitude across the array is the safe reading. Verify it moves with playback.
 */
import { useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { EngineAddresses } from "@opendaw/studio-adapters";

export function useMasterMeter(project: Project | null): number {
  const [level, setLevel] = useState(0);
  const incoming = useRef(0);

  useEffect(() => {
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
    const tick = () => {
      const peak = incoming.current;
      incoming.current = 0; // reset each frame — no fresh peak means silence
      setLevel((prev) => (peak > prev ? peak : prev * 0.8));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      sub.terminate();
      cancelAnimationFrame(frame);
    };
  }, [project]);

  return level;
}
