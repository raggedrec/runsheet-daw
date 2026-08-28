/**
 * A live level meter for the selected input.
 *
 * This exists because "Nothing was recorded" is a terrible way to find out you
 * were pointed at the wrong device. A meter answers "is signal arriving"
 * before you play anything, which is the first question in any studio and the
 * one this app couldn't answer.
 *
 * It opens its own stream rather than tapping openDAW's, deliberately:
 * openDAW's stream only exists once recording has been prepared, and the whole
 * point is to check the input *before* committing to a take. Two streams on
 * one device is normal — the OS mixes them — and this one is closed the moment
 * the device changes or the panel goes away.
 *
 * Peak, not RMS. A meter that reads average level looks healthy while the
 * loudest moments clip, and for setting a gain knob the peak is the number
 * that matters.
 */
import { useEffect, useRef, useState } from "react";

export interface InputMeter {
  /** 0..1 peak of the last frame. */
  level: number;
  /** True once audio has actually been observed above the noise floor. */
  sawSignal: boolean;
  error: string | null;
}

export function useInputMeter(deviceId: string | null, enabled: boolean): InputMeter {
  const [level, setLevel] = useState(0);
  const [sawSignal, setSawSignal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!enabled || !deviceId) {
      setLevel(0);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    setError(null);
    setSawSignal(false);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // exact: asking for a device and silently getting a different one is
          // exactly the confusion this meter exists to end.
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // A context of its own, at whatever rate the device runs. Nothing is
        // connected to a destination, so this makes no sound.
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buffer);
          let peak = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = Math.abs(buffer[i]);
            if (v > peak) peak = v;
          }
          setLevel(peak);
          // A floor, so mains hum and a noisy preamp don't count as "signal".
          if (peak > 0.02) setSawSignal(true);
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.name === "OverconstrainedError"
            ? "That input isn't available."
            : "Couldn't open that input.",
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
    };
  }, [deviceId, enabled]);

  return { level, sawSignal, error };
}
