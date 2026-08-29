/**
 * One owner for the transport.
 *
 * Until now three things had an opinion about whether the song was moving: a
 * React `rolling` flag this app set when it pressed a button, a clock derived
 * from the AudioContext, and the engine's own observables. They disagreed, and
 * every disagreement became a bug — most memorably a clock counting up
 * convincingly while the engine sat still, which hid a broken record path for
 * most of a day.
 *
 * So: the engine is the only authority. Play, stop, record and position all go
 * through here, and every value the UI shows is something the engine said.
 *
 * The one piece of cleverness is the position, and it is deliberate. The
 * engine publishes position in pulses, but not on every frame — in this build
 * it can go long stretches without an update. Rather than either freezing the
 * playhead or ignoring the engine, this interpolates: whenever the engine
 * reports a position that is its anchor, and between reports the AudioContext
 * clock — the same clock the engine renders against — fills the gap. If the
 * engine goes quiet the playhead keeps moving smoothly; the moment it speaks
 * again, it wins.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";

export interface Transport {
  /** Seconds. Engine-anchored, interpolated between its reports. */
  position: number;
  isPlaying: boolean;
  isRecording: boolean;
  isCountingIn: boolean;
  /** True while the engine, not this app, says something is happening. */
  isActive: boolean;
  play: () => void;
  stop: () => void;
  toggle: () => void;
  rewind: () => void;
  seek: (seconds: number) => void;
}

export function useTransport(project: Project | null, audioContext: AudioContext | null): Transport {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [position, setPosition] = useState(0);

  // Anchor: the last position the ENGINE reported, and the context time when
  // it said so. Everything between is interpolation, not invention.
  const anchor = useRef({ seconds: 0, at: 0 });

  useEffect(() => {
    if (!project) return;
    const { engine } = project;

    const subs = [
      engine.isPlaying.catchupAndSubscribe((o) => setIsPlaying(o.getValue())),
      engine.isRecording.catchupAndSubscribe((o) => setIsRecording(o.getValue())),
      engine.isCountingIn.catchupAndSubscribe((o) => setIsCountingIn(o.getValue())),
      engine.position.catchupAndSubscribe((o) => {
        const seconds = project.tempoMap.ppqnToSeconds(o.getValue());
        anchor.current = { seconds, at: audioContext?.currentTime ?? 0 };
        setPosition(seconds);
      }),
    ];
    return () => subs.forEach((s) => s.terminate());
  }, [project, audioContext]);

  // Fill the gaps between the engine's reports, and only while it says it's
  // moving. Stopped means stopped — no drifting playhead over a silent song.
  useEffect(() => {
    if (!audioContext || (!isPlaying && !isCountingIn)) return;
    let frame = 0;
    const tick = () => {
      const elapsed = audioContext.currentTime - anchor.current.at;
      setPosition(Math.max(0, anchor.current.seconds + elapsed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioContext, isPlaying, isCountingIn]);

  const seek = useCallback(
    (seconds: number) => {
      if (!project) return;
      // The engine positions in musical time, so seconds go back through the
      // tempo map rather than being scaled.
      project.engine.setPosition(project.tempoMap.secondsToPPQN(seconds));
      anchor.current = { seconds, at: audioContext?.currentTime ?? 0 };
      setPosition(seconds);
    },
    [project, audioContext],
  );

  const play = useCallback(() => {
    if (!project) return;
    /*
     * Position before play. play() on its own rolls the transport but
     * produces silence until something sets a position — setting the one the
     * playhead already occupies costs nothing and makes Play behave the same
     * as clicking the timeline.
     */
    project.engine.setPosition(project.tempoMap.secondsToPPQN(position));
    project.engine.play();
  }, [project, position]);

  const stop = useCallback(() => project?.engine.stop(), [project]);
  const toggle = useCallback(() => (isPlaying ? stop() : play()), [isPlaying, stop, play]);
  const rewind = useCallback(() => seek(0), [seek]);

  return {
    position,
    isPlaying,
    isRecording,
    isCountingIn,
    isActive: isPlaying || isRecording || isCountingIn,
    play,
    stop,
    toggle,
    rewind,
    seek,
  };
}
