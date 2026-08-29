/**
 * A track's devices, with their controls.
 *
 * Every openDAW device adapter exposes `namedParameter` — an object of
 * `AutomatableParameterFieldAdapter`s, each with a name, a value mapping and a
 * setter. That means one generic panel rather than twenty bespoke ones: read
 * the parameters, render a control for each, write back through the mapping.
 *
 * The trade is that a compressor here looks like a list rather than like a
 * compressor. That is the honest version of "you can tweak it" for now — a
 * threshold you can move and hear beats a graphic you can't.
 *
 * Values go through `setUnitValue` rather than `setValue`, so the slider is
 * always 0..1 and each parameter's own curve does the work. A linear slider
 * over a decibel range spends most of its travel somewhere useless.
 */
import { useCallback } from "react";
import type { Project } from "@opendaw/studio-core";
import { font, radius, size, space, type Skin } from "./theme";

/** The shape we rely on, kept narrow so a change in openDAW fails loudly. */
interface Param {
  name: string;
  type: string;
  getValue: () => unknown;
  setValue: (v: never) => void;
  setUnitValue: (v: number) => void;
  valueMapping: { x: (v: never) => number };
}

interface DeviceAdapterish {
  namedParameter?: Record<string, Param>;
  box: { constructor?: { name?: string }; delete?: () => void };
  enabledField?: { getValue: () => boolean; setValue: (v: boolean) => void };
}

export interface DeviceViewProps {
  project: Project;
  devices: ReadonlyArray<unknown>;
  trackName: string;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
}

export function DeviceView({ project, devices, trackName, skin, accent, revision, onChanged }: DeviceViewProps) {
  void revision;

  const write = useCallback(
    (fn: () => void) => {
      // Inside a transaction, like every other box write.
      project.editing.modify(fn);
      onChanged();
    },
    [project, onChanged],
  );

  if (devices.length === 0) {
    return (
      <div style={{ padding: space[5], font: `${size.base}px ${font.body}`, color: skin.fgSubtle }}>
        No devices on {trackName}. Add one in the effects rack.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: space[3], padding: space[3], overflowX: "auto" }}>
      {devices.map((d, i) => {
        const device = d as DeviceAdapterish;
        const params = Object.entries(device.namedParameter ?? {});
        const enabled = device.enabledField?.getValue() ?? true;

        return (
          <div
            key={i}
            style={{
              width: 232, flex: "0 0 auto",
              background: skin.surface,
              border: `1px solid ${skin.border}`,
              borderRadius: radius.md,
              overflow: "hidden",
              opacity: enabled ? 1 : 0.5,
            }}
          >
            <header
              style={{
                display: "flex", alignItems: "center", gap: space[2],
                padding: `${space[2]}px ${space[3]}px`,
                borderBottom: `1px solid ${skin.border}`,
                background: skin.surfaceSunken,
              }}
            >
              <span style={{ font: `600 ${size.sm}px ${font.body}`, color: skin.fg, flex: 1 }}>
                {deviceName(device)}
              </span>
              {/* Bypass rather than remove — comparing with and without is how
                  you decide whether a device is earning its place. */}
              {device.enabledField && (
                <button
                  onClick={() => write(() => device.enabledField!.setValue(!enabled))}
                  title={enabled ? "Bypass" : "Enable"}
                  style={{
                    font: `700 ${size.xs}px ${font.body}`,
                    padding: "2px 6px", cursor: "pointer",
                    color: enabled ? "#fff" : skin.fgSubtle,
                    background: enabled ? accent : "transparent",
                    border: `1px solid ${enabled ? accent : skin.border}`,
                    borderRadius: radius.sm,
                  }}
                >
                  ON
                </button>
              )}
            </header>

            <div style={{ padding: space[3] }}>
              {params.length === 0 && (
                <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: 0 }}>
                  This device exposes no parameters.
                </p>
              )}

              {params.map(([key, param]) => (
                <ParamRow
                  key={key}
                  param={param}
                  skin={skin}
                  accent={accent}
                  onWrite={write}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ParamRow({
  param, skin, accent, onWrite,
}: {
  param: Param;
  skin: Skin;
  accent: string;
  onWrite: (fn: () => void) => void;
}) {
  const value = param.getValue();

  if (typeof value === "boolean") {
    return (
      <label
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "3px 0",
          font: `${size.sm}px ${font.body}`, color: skin.fgMuted, cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onWrite(() => param.setValue(e.target.checked as never))}
        />
        {param.name}
      </label>
    );
  }

  const numeric = typeof value === "number" ? value : 0;
  let unit = 0;
  try {
    unit = param.valueMapping.x(numeric as never);
  } catch {
    // A mapping that can't place this value is not worth an error boundary;
    // the slider just starts at the left.
  }

  return (
    <div style={{ padding: "3px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span style={{ font: `${size.xs}px ${font.body}`, color: skin.fgSubtle }}>{param.name}</span>
        <span
          style={{
            font: `500 ${size.xs}px ${font.mono}`, color: skin.fgMuted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {format(numeric)}
        </span>
      </div>
      <input
        type="range"
        min={0} max={1} step={0.001}
        value={Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0}
        onChange={(e) => onWrite(() => param.setUnitValue(Number(e.target.value)))}
        style={{ width: "100%", height: 3, accentColor: accent }}
      />
    </div>
  );
}

/** Compressor rather than CompressorDeviceBox. */
function deviceName(device: DeviceAdapterish): string {
  const raw = device.box?.constructor?.name ?? "Device";
  return raw.replace(/DeviceBox$/, "").replace(/Box$/, "");
}

/** Enough precision to be useful, not so much that it jitters. */
function format(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
