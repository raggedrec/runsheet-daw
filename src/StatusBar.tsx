/**
 * The strip along the bottom: what the engine is actually running at.
 *
 * Every figure here is read from something real. CPU comes from the engine's
 * own cpuLoad, which is the honest early warning before audio starts breaking
 * up — a number worth having on screen precisely because it goes wrong before
 * you can hear it.
 *
 * Bit depth is stated as what takes are WRITTEN at, not what the engine
 * processes internally. openDAW works in 32-bit float; the WAV encoder emits
 * 16-bit. Saying "24-bit" here because it looks professional would be a lie
 * about a file you might later hand to a mastering engineer.
 */
import { useEffect, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { font, size, space, type Skin } from "./theme";

export interface StatusBarProps {
  skin: Skin;
  project: Project | null;
  audioContext: AudioContext | null;
  position: number;
}

export function StatusBar({ skin, project, audioContext, position }: StatusBarProps) {
  const cpu = useCpuLoad(project);

  /*
   * Round-trip latency the browser reports, in ms. baseLatency is the
   * processing buffer; outputLatency adds the hardware path (0 or absent in some
   * browsers). This is as close to "what am I hearing, how late" as the web
   * platform gives — the buffer SIZE itself isn't ours to set (that lives in the
   * interface's driver), but the latency it produces is at least worth showing.
   */
  const latencyMs =
    audioContext
      ? Math.round((audioContext.baseLatency + (audioContext.outputLatency || 0)) * 1000)
      : null;

  const items: Array<[string, string]> = [
    ["Rate", audioContext ? `${(audioContext.sampleRate / 1000).toFixed(1)} kHz` : "—"],
    ["Latency", latencyMs === null ? "—" : `${latencyMs} ms`],
    // What takes are saved as, not what the engine computes in.
    ["Takes", "16-bit WAV"],
    ["Position", formatLong(position)],
    ["CPU", cpu === null ? "—" : `${Math.round(cpu * 100)}%`],
  ];

  return (
    <footer
      style={{
        display: "flex", alignItems: "center", gap: space[5],
        padding: `${space[2]}px ${space[4]}px`,
        marginTop: space[3],
        borderTop: `1px solid ${skin.border}`,
        font: `500 ${size.xs}px ${font.mono}`,
        color: skin.fgSubtle,
        fontVariantNumeric: "tabular-nums",
        flexWrap: "wrap",
      }}
    >
      {items.map(([label, value]) => (
        <span key={label} style={{ display: "flex", gap: 6 }}>
          <span style={{ font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".08em", textTransform: "uppercase" }}>
            {label}
          </span>
          <span style={{ color: skin.fgMuted }}>{value}</span>
        </span>
      ))}

      {cpu !== null && (
        <span
          style={{
            width: 60, height: 5, borderRadius: 999,
            background: skin.slot, overflow: "hidden",
          }}
          title="Engine CPU load"
        >
          <span
            style={{
              display: "block", height: "100%",
              width: `${Math.min(100, cpu * 100)}%`,
              // Amber past 70%, red past 90% — the points at which you should
              // freeze something rather than wonder why it's crackling.
              background: cpu > 0.9 ? "#C0453B" : cpu > 0.7 ? "#C88B00" : "#3B9E5A",
            }}
          />
        </span>
      )}
    </footer>
  );
}

/**
 * Engine CPU, sampled a few times a second.
 *
 * Not subscribed: cpuLoad updates per audio block, and re-rendering React
 * hundreds of times a second to move a 60-pixel bar would itself become a
 * reason the number goes up.
 */
function useCpuLoad(project: Project | null): number | null {
  const [load, setLoad] = useState<number | null>(null);

  useEffect(() => {
    if (!project) return;
    const id = window.setInterval(() => {
      try {
        setLoad(project.engine.cpuLoad.getValue());
      } catch {
        // The engine can be mid-restart. A missing number for one tick is not
        // worth an error boundary.
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [project]);

  return load;
}

/** h:mm:ss.t — the long form, for the status bar rather than the transport. */
function formatLong(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${tenths}`;
}
