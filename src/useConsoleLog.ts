/**
 * Captures what openDAW says, and puts it on screen.
 *
 * openDAW reports almost everything through the console and almost nothing
 * through return values. `Recording.start` returns `Errors.warn(...)` on
 * failure. `CaptureAudio.startRecording` logs "No audio chain or worklet
 * available for recording" and hands back an empty Terminable. From the
 * outside, both look identical to a take that simply had no signal.
 *
 * Six fixes were shipped for this recording bug without anyone reading those
 * messages, each one a guess dressed as a diagnosis. This exists so the next
 * question is answered with evidence instead.
 *
 * It patches the console rather than using a debug flag because the messages
 * that matter come from inside a dependency — there is no hook to pass and no
 * option to set.
 */
import { useEffect, useState } from "react";

export interface LogLine {
  id: number;
  level: "debug" | "info" | "warn" | "error";
  text: string;
  at: number;
}

/** Only openDAW's own chatter, plus anything that looks like a failure. */
const INTERESTING = /opendaw|capture|record|worklet|engine|wasm|sample|audio|latency|error|fail|unable|cannot|no /i;

export function useConsoleLog(enabled: boolean, limit = 200): LogLine[] {
  const [lines, setLines] = useState<LogLine[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let id = 0;
    const original = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const capture = (level: LogLine["level"]) =>
      (...args: unknown[]) => {
        original[level](...args);
        const text = args
          .map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            if (typeof a === "string") return a;
            try {
              return JSON.stringify(a);
            } catch {
              // Circular, or a live audio node. Its type is still useful.
              return Object.prototype.toString.call(a);
            }
          })
          .join(" ")
          .slice(0, 400);

        // Errors and warnings always; debug only when it's about the audio
        // path, or the log fills with router and React noise.
        if (level === "debug" && !INTERESTING.test(text)) return;

        setLines((current) => {
          const next = [...current, { id: id++, level, text, at: Date.now() }];
          return next.length > limit ? next.slice(next.length - limit) : next;
        });
      };

    console.debug = capture("debug");
    console.info = capture("info");
    console.warn = capture("warn");
    console.error = capture("error");

    // Unhandled rejections are how a failed prepareRecording surfaces when
    // nobody is awaiting it — Recording.start calls .finally() and drops it.
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      setLines((current) => [
        ...current,
        {
          id: id++,
          level: "error",
          text: `Unhandled rejection: ${
            reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
          }`,
          at: Date.now(),
        },
      ]);
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      console.debug = original.debug;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [enabled, limit]);

  return lines;
}
