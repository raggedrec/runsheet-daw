/**
 * Where the playhead is, in seconds.
 *
 * The obvious source is `engine.position`, and it doesn't work: in this build
 * the value stays where it was last set and never advances while the transport
 * rolls. Audio plays, the position doesn't move. I don't yet know why, and
 * guessing at it from type definitions has been wrong three times.
 *
 * So the clock is driven from the AudioContext instead, which is the same
 * clock the engine itself renders against and is authoritative about how much
 * audio has actually been produced. On each transport change the reading is
 * re-anchored: remember where the playhead was and what `currentTime` said at
 * that instant, then elapsed = currentTime - anchor. Nothing accumulates, so
 * there is no drift to correct.
 *
 * This is also what most browser DAWs do regardless, because it doesn't
 * re-render React on every audio block. If `engine.position` starts reporting
 * properly, this stays correct — it just becomes the less direct of two right
 * answers.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface TransportClock {
  /** Current playhead position, in seconds. */
  seconds: number;
  /** Call when playback starts, with the position it starts from. */
  start: (fromSeconds: number) => void;
  /** Call when playback stops, with where it stopped. */
  stop: (atSeconds: number) => void;
  /** Call when the user scrubs. Keeps rolling if it was already rolling. */
  seek: (toSeconds: number) => void;
}

export function useTransportClock(
  audioContext: AudioContext | null,
  running: boolean,
  limit: number,
): TransportClock {
  const [seconds, setSeconds] = useState(0);
  // Anchor: the playhead position at the moment the context clock read `at`.
  const anchor = useRef({ position: 0, at: 0 });

  const now = useCallback(() => audioContext?.currentTime ?? 0, [audioContext]);

  const start = useCallback(
    (fromSeconds: number) => {
      anchor.current = { position: fromSeconds, at: now() };
      setSeconds(fromSeconds);
    },
    [now],
  );

  const stop = useCallback((atSeconds: number) => {
    anchor.current = { position: atSeconds, at: 0 };
    setSeconds(atSeconds);
  }, []);

  const seek = useCallback(
    (toSeconds: number) => {
      anchor.current = { position: toSeconds, at: now() };
      setSeconds(toSeconds);
    },
    [now],
  );

  useEffect(() => {
    if (!running || !audioContext) return;
    let frame = 0;
    const tick = () => {
      const elapsed = audioContext.currentTime - anchor.current.at;
      // Clamped at the end of the longest lane: past that there is nothing to
      // play, and a clock that keeps counting says otherwise.
      setSeconds(Math.min(limit, Math.max(0, anchor.current.position + elapsed)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, audioContext, limit]);

  return { seconds, start, stop, seek };
}
