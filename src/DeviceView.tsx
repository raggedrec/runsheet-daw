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
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, SampleService } from "@opendaw/studio-core";
import { UUID } from "@opendaw/lib-std";
import { NeuralAmpModelBox, type NeuralAmpDeviceBox, type ConvolverDeviceBox } from "@opendaw/studio-boxes";
import { font, radius, size, space, type Skin } from "./theme";
import { prepareAudioFile } from "./opendaw/loadSong";

/** The shape we rely on, kept narrow so a change in openDAW fails loudly. */
interface Param {
  name: string;
  type: string;
  getValue: () => unknown;
  setValue: (v: never) => void;
  setUnitValue: (v: number) => void;
  valueMapping: { x: (v: never) => number };
  /**
   * openDAW's own formatting of the current value.
   *
   * This is what makes tempo sync legible. A synced delay time is a musical
   * division, and its raw number is meaningless — printed, it reads "1/8" or
   * "1/4." like it should. Same mechanism gives "250 ms", "-12 dB", "45 %"
   * everywhere else, so the panel stops showing bare floats.
   */
  getPrintValue?: () => unknown;
}

interface DeviceAdapterish {
  /**
   * Flat for most devices, nested for some. See `collectParams` — the EQ's is
   * a record of BANDS, each holding its own parameters, so this can't be typed
   * as a flat record without lying about it.
   */
  namedParameter?: Record<string, unknown>;
  box: unknown;
  enabledField?: { getValue: () => boolean; setValue: (v: boolean) => void };
}

/** One control to draw, and the band it belongs to when it belongs to one. */
interface ParamRowSpec {
  id: string;
  group: string | null;
  keyName: string;
  param: Param;
}

/** Whether a value is a parameter, rather than a group of them. */
function isParam(value: unknown): value is Param {
  const p = value as Param | undefined;
  return (
    typeof p === "object" && p !== null &&
    typeof p.getValue === "function" &&
    typeof p.setUnitValue === "function"
  );
}

/**
 * The parameters of a device, flattened one level.
 *
 * Most devices expose `namedParameter` as a flat record of parameters. The EQ
 * (Revamp) does not: its record holds seven BANDS — highPass, lowShelf, lowBell,
 * midBell, highBell, highShelf, lowPass — and each band holds the parameters.
 *
 * Assuming flat is what blanked the whole app: the panel called `getValue()` on
 * a band, `getValue` was undefined, and the throw during render unmounted every
 * component in the tree. So this asks each entry what it is rather than assuming,
 * and anything that is neither a parameter nor a group of them is skipped rather
 * than rendered into a crash.
 */
function collectParams(named: Record<string, unknown> | undefined): ParamRowSpec[] {
  const rows: ParamRowSpec[] = [];
  for (const [key, value] of Object.entries(named ?? {})) {
    if (isParam(value)) {
      rows.push({ id: key, group: null, keyName: key, param: value });
    } else if (typeof value === "object" && value !== null) {
      for (const [subKey, sub] of Object.entries(value as Record<string, unknown>)) {
        if (isParam(sub)) {
          rows.push({ id: `${key}.${subKey}`, group: humanize(key), keyName: subKey, param: sub });
        }
      }
    }
  }
  return rows;
}

/** "highPass" → "High pass", for band names openDAW only spells in camelCase. */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Plainer names for parameters whose internal ones are opaque.
 *
 * openDAW's Delay carries both a musical time and a free one — `delay` is
 * synced to the tempo, `millisTime` is not — and as raw keys neither says so.
 * The engine already does tempo sync; this is what makes it visible.
 */
const PARAM_LABELS: Record<string, string> = {
  delay: "Time (synced)",
  millisTime: "Time (ms)",
  preSyncTimeLeft: "Pre-delay L (synced)",
  preSyncTimeRight: "Pre-delay R (synced)",
  preMillisTimeLeft: "Pre-delay L (ms)",
  preMillisTimeRight: "Pre-delay R (ms)",
  lfoSpeed: "LFO rate",
  lfoDepth: "LFO depth",
  cross: "Ping-pong",
  automakeup: "Auto makeup",
  autoattack: "Auto attack",
  autorelease: "Auto release",
  inputgain: "Input gain",
};

/** Parameters that follow the project tempo, flagged so it's obvious which. */
const SYNCED = /sync|^delay$/i;

export interface DeviceViewProps {
  project: Project;
  devices: ReadonlyArray<unknown>;
  trackName: string;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
  /** Needed to import an IR into a convolver. */
  sampleService: SampleService;
}

export function DeviceView({ project, devices, trackName, skin, accent, revision, onChanged, sampleService }: DeviceViewProps) {
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
        const rows = collectParams(device.namedParameter);
        const enabled = device.enabledField?.getValue() ?? true;
        const flat = rows.filter((r) => r.group === null);
        const bands = groupRows(rows);

        return (
          <div
            key={i}
            style={{
              flex: "0 0 auto", maxWidth: "100%",
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
              {/* The amp modeler needs a model before its knobs mean anything —
                  load a .nam capture here; the gain/mix knobs follow below. */}
              {isNeuralAmp(device) && (
                <NamModelLoader
                  project={project}
                  box={device.box as NeuralAmpDeviceBox}
                  skin={skin}
                  accent={accent}
                  onWrite={write}
                />
              )}

              {/* The convolver's IR — a cab (in front of, after the amp) or a
                  reverb (Lexicon), the same device either way. */}
              {isConvolver(device) && (
                <IrLoader
                  project={project}
                  sampleService={sampleService}
                  box={device.box as ConvolverDeviceBox}
                  skin={skin}
                  accent={accent}
                  onWrite={write}
                />
              )}

              {rows.length === 0 && !isNeuralAmp(device) && (
                <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: 0 }}>
                  This device exposes no parameters.
                </p>
              )}

              {/* Flat devices (compressor, gate…): a row of knobs that wraps. */}
              {flat.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: space[3] }}>
                  {flat.map((row) => (
                    <Control key={row.id} keyName={row.keyName} param={row.param} skin={skin} accent={accent} onWrite={write} />
                  ))}
                </div>
              )}

              {/* Grouped devices (the EQ's seven bands): each band is a column,
                  and the bands run ACROSS the panel, not stacked — stacked, they
                  made a device taller than the whole screen. */}
              {bands.length > 0 && (
                <div
                  style={{
                    display: "flex", gap: space[4], alignItems: "flex-start",
                    marginTop: flat.length > 0 ? space[4] : 0,
                  }}
                >
                  {bands.map((band) => (
                    <div key={band.name} style={{ flex: "0 0 auto" }}>
                      <p
                        style={{
                          font: `700 ${size.xs}px ${font.body}`,
                          letterSpacing: ".06em", textTransform: "uppercase",
                          color: skin.fgMuted, margin: `0 0 ${space[2]}px`, textAlign: "center",
                        }}
                      >
                        {band.name}
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[3] }}>
                        {band.rows.map((row) => (
                          <Control key={row.id} keyName={row.keyName} param={row.param} skin={skin} accent={accent} onWrite={write} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Rows grouped by band, in first-seen order; flat (ungrouped) rows excluded. */
function groupRows(rows: ParamRowSpec[]): Array<{ name: string; rows: ParamRowSpec[] }> {
  const order: string[] = [];
  const byName = new Map<string, ParamRowSpec[]>();
  for (const row of rows) {
    if (row.group === null) continue;
    if (!byName.has(row.group)) {
      byName.set(row.group, []);
      order.push(row.group);
    }
    byName.get(row.group)!.push(row);
  }
  return order.map((name) => ({ name, rows: byName.get(name)! }));
}

/** Whether a device is the Neural Amp, by openDAW's static ClassName. */
function isNeuralAmp(device: DeviceAdapterish): boolean {
  const ctor = (device.box as { constructor?: { ClassName?: string } })?.constructor;
  return ctor?.ClassName === "NeuralAmpDeviceBox";
}

/** Whether a device is the Convolver (an IR loader — cab or reverb). */
function isConvolver(device: DeviceAdapterish): boolean {
  const ctor = (device.box as { constructor?: { ClassName?: string } })?.constructor;
  return ctor?.ClassName === "ConvolverDeviceBox";
}

/**
 * Loads a .nam model into a Neural Amp device.
 *
 * A .nam file is JSON — the format sdatkinson/neural-amp-modeler trains — and
 * openDAW runs it in the worklet through its bundled nam-wasm. The model lives
 * in its own box (a NeuralAmpModelBox) that the device points at, exactly as
 * openDAW's own import does: hash the JSON for a stable id, reuse a model box
 * already loaded from the same capture, else make one, then point the device at
 * it. Stored in the graph, so the amp comes back when the session reopens.
 *
 * The read-and-hash is async, so it happens BEFORE the transaction; only the box
 * writes go inside editing.modify() (via onWrite).
 */
/** A bundled preset (an amp capture or an IR) the user can pick without files. */
interface Preset {
  category: string;
  name: string;
  file: string;
}

/*
 * Preset manifests, fetched once each and shared. Generated into public/nam by
 * scripts/sync-nam.mjs from the NAM/ folder: index.json (amps), ir.json (cab &
 * reverb IRs). Absent (empty) is fine — the picker just doesn't show.
 */
const presetIndexCache = new Map<string, Promise<Preset[]>>();
function loadPresetIndex(path: string): Promise<Preset[]> {
  let promise = presetIndexCache.get(path);
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}${path}`)
      .then((r) => (r.ok ? (r.json() as Promise<Preset[]>) : []))
      .catch(() => []);
    presetIndexCache.set(path, promise);
  }
  return promise;
}

/** A grouped preset dropdown; calls onPick with the chosen preset. */
function PresetSelect({
  path, placeholder, disabled, skin, onPick,
}: {
  path: string;
  placeholder: string;
  disabled: boolean;
  skin: Skin;
  onPick: (preset: Preset) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => {
    let live = true;
    loadPresetIndex(path).then((p) => { if (live) setPresets(p); });
    return () => { live = false; };
  }, [path]);

  if (presets.length === 0) return null;

  const groups = presets.reduce<Record<string, Preset[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <select
      value=""
      disabled={disabled}
      onChange={(e) => {
        const preset = presets.find((p) => p.file === e.target.value);
        if (preset) onPick(preset);
        e.target.value = "";
      }}
      style={{
        width: "100%", boxSizing: "border-box", marginBottom: space[2],
        font: `${size.sm}px ${font.body}`, color: skin.fg,
        background: skin.surface, border: `1px solid ${skin.border}`,
        borderRadius: radius.sm, padding: "5px 6px",
      }}
    >
      <option value="">{placeholder}</option>
      {Object.entries(groups).map(([category, items]) => (
        <optgroup key={category} label={category}>
          {items.map((p) => (
            <option key={p.file} value={p.file}>{p.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function NamModelLoader({
  project, box, skin, accent, onWrite,
}: {
  project: Project;
  box: NeuralAmpDeviceBox;
  skin: Skin;
  accent: string;
  onWrite: (fn: () => void) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = box.model.targetVertex.unwrapOrNull() as NeuralAmpModelBox | null;
  const modelName = current ? current.label.getValue() : null;

  /*
   * One owner for loading, whatever the source. `getText` fetches the JSON — off
   * disk for a user's own .nam, off public/nam for a preset — and everything
   * after (validate, hash, create/link) is identical. The content hash means a
   * preset chosen twice, or the same amp loaded on several tracks, shares one
   * model box rather than duplicating a few hundred KB of weights each time.
   */
  const applyModel = useCallback(
    async (getText: () => Promise<string>, label: string) => {
      setError(null);
      setBusy(true);
      try {
        const text = await getText();
        let looksLikeNam = false;
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          looksLikeNam =
            typeof parsed === "object" && parsed !== null &&
            ("architecture" in parsed || "config" in parsed || "weights" in parsed);
        } catch {
          // Not JSON at all — handled by the throw below.
        }
        if (!looksLikeNam) {
          throw new Error("That doesn't look like a .nam model (expected NAM JSON).");
        }

        const uuid = await UUID.sha256(new TextEncoder().encode(text).buffer);
        let modelBox: NeuralAmpModelBox | null = null;
        for (const existing of project.boxGraph.boxes()) {
          if (existing instanceof NeuralAmpModelBox && UUID.equals(existing.address.uuid, uuid)) {
            modelBox = existing;
            break;
          }
        }

        onWrite(() => {
          if (modelBox === null) {
            modelBox = NeuralAmpModelBox.create(project.boxGraph, uuid);
            modelBox.label.setValue(label);
            modelBox.model.setValue(text);
          }
          box.model.refer(modelBox);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that model.");
      } finally {
        setBusy(false);
      }
    },
    [project, box, onWrite],
  );

  return (
    <div style={{ marginBottom: space[3] }}>
      {/* Preset amps first — the path for anyone who doesn't have or want their
          own .nam. The file picker below stays for those who do. */}
      <PresetSelect
        path="nam/index.json"
        placeholder="Choose an amp…"
        disabled={busy}
        skin={skin}
        onPick={(preset) =>
          void applyModel(async () => {
            const res = await fetch(`${import.meta.env.BASE_URL}nam/${preset.file}`);
            if (!res.ok) throw new Error("Couldn't fetch that amp preset.");
            return res.text();
          }, preset.name)
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept=".nam,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void applyModel(() => file.text(), file.name.replace(/\.nam$/i, ""));
          e.target.value = ""; // let the same file be picked again after an error
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            flex: "0 0 auto", height: 28, paddingInline: 12,
            font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".04em",
            color: accent, background: "transparent",
            border: `1px dashed ${accent}`, borderRadius: radius.sm,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Loading…" : modelName ? "Change .nam" : "Load .nam"}
        </button>
        <span
          title={modelName ?? undefined}
          style={{
            font: `${size.sm}px ${font.body}`,
            color: modelName ? skin.fg : skin.fgSubtle,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {modelName ?? "No model loaded"}
        </span>
      </div>
      {error && (
        <p style={{ font: `${size.xs}px ${font.body}`, color: "#C0453B", margin: `${space[2]}px 0 0` }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Loads an impulse response into a Convolver — a cab (after the amp) or a reverb
 * (Lexicon), same device either way. Presets come from the bundled IR pack; the
 * file picker takes any .wav. The IR is imported as an audio sample and the
 * convolver's `file` pointed at it, the same way a stem's region references its
 * audio.
 */
function IrLoader({
  project, sampleService, box, skin, accent, onWrite,
}: {
  project: Project;
  sampleService: SampleService;
  box: ConvolverDeviceBox;
  skin: Skin;
  accent: string;
  onWrite: (fn: () => void) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const hasIr = box.file.targetVertex.nonEmpty();

  const applyIr = useCallback(
    async (getBuffer: () => Promise<ArrayBuffer>, label: string) => {
      setError(null);
      setBusy(true);
      try {
        const buffer = await getBuffer();
        const createFileBox = await prepareAudioFile(sampleService, project, label, buffer);
        onWrite(() => {
          box.file.refer(createFileBox());
        });
        setPickedName(label);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that IR.");
      } finally {
        setBusy(false);
      }
    },
    [project, sampleService, box, onWrite],
  );

  return (
    <div style={{ marginBottom: space[3] }}>
      <PresetSelect
        path="nam/ir.json"
        placeholder="Choose an IR (cab / reverb)…"
        disabled={busy}
        skin={skin}
        onPick={(preset) =>
          void applyIr(async () => {
            const res = await fetch(`${import.meta.env.BASE_URL}nam/${preset.file}`);
            if (!res.ok) throw new Error("Couldn't fetch that IR.");
            return res.arrayBuffer();
          }, preset.name)
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept=".wav,audio/wav"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void applyIr(() => file.arrayBuffer(), file.name.replace(/\.wav$/i, ""));
          e.target.value = "";
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            flex: "0 0 auto", height: 28, paddingInline: 12,
            font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".04em",
            color: accent, background: "transparent",
            border: `1px dashed ${accent}`, borderRadius: radius.sm,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Loading…" : hasIr ? "Change IR" : "Load .wav IR"}
        </button>
        <span
          title={pickedName ?? undefined}
          style={{
            font: `${size.sm}px ${font.body}`,
            color: pickedName || hasIr ? skin.fg : skin.fgSubtle,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {pickedName ?? (hasIr ? "IR loaded" : "No IR")}
        </span>
      </div>
      {error && (
        <p style={{ font: `${size.xs}px ${font.body}`, color: "#C0453B", margin: `${space[2]}px 0 0` }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** One parameter: a checkbox for a boolean, a knob for a number. */
function Control({
  param, keyName, skin, accent, onWrite,
}: {
  param: Param;
  keyName: string;
  skin: Skin;
  accent: string;
  onWrite: (fn: () => void) => void;
}) {
  const value = param.getValue();

  if (typeof value === "boolean") {
    return (
      <label
        style={{
          display: "flex", alignItems: "center", gap: 5,
          font: `${size.xs}px ${font.body}`, color: skin.fgMuted, cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onWrite(() => param.setValue(e.target.checked as never))}
        />
        {PARAM_LABELS[keyName] ?? param.name}
      </label>
    );
  }

  const label = PARAM_LABELS[keyName] ?? param.name;
  const synced = SYNCED.test(keyName);
  const numeric = typeof value === "number" ? value : 0;
  let unit = 0;
  try {
    unit = param.valueMapping.x(numeric as never);
  } catch {
    // A mapping that can't place this value isn't worth an error boundary;
    // the knob just starts at its minimum.
  }
  const u = Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 66 }}>
      <span
        style={{
          font: `${size.xs}px ${font.body}`, color: skin.fgSubtle,
          textAlign: "center", lineHeight: 1.15, height: 26,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
        }}
      >
        {label}
        {synced && (
          <span
            title="Follows the project tempo"
            style={{
              font: `700 8px ${font.body}`, letterSpacing: ".06em",
              color: accent, border: `1px solid ${accent}`, borderRadius: 2, padding: "0 2px",
            }}
          >
            SYNC
          </span>
        )}
      </span>
      <Knob unit={u} accent={accent} skin={skin} title={label} onChange={(v) => onWrite(() => param.setUnitValue(v))} />
      <span
        style={{
          font: `500 ${size.xs}px ${font.mono}`, color: skin.fgMuted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {printed(param, numeric)}
      </span>
    </div>
  );
}

/**
 * A knob, dragged vertically. Same gesture as the mixer's pan knob — up is more,
 * down is less — over the parameter's 0..1 unit range, so the curve baked into
 * each parameter does the work and the knob stays linear in feel. The indicator
 * sweeps 270°, the usual hardware throw.
 */
function Knob({
  unit, accent, skin, title, onChange,
}: {
  unit: number;
  accent: string;
  skin: Skin;
  title: string;
  onChange: (v: number) => void;
}) {
  const start = useRef<{ y: number; v: number } | null>(null);
  const onDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      start.current = { y: e.clientY, v: unit };
      const move = (ev: PointerEvent) => {
        if (!start.current) return;
        // ~160px of travel spans the whole range — enough to be precise without
        // running off the panel on the parameters with the widest swing.
        const dv = (start.current.y - ev.clientY) / 160;
        onChange(Math.max(0, Math.min(1, start.current.v + dv)));
      };
      const up = () => {
        start.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [unit, onChange],
  );

  const angle = -135 + u01(unit) * 270;
  return (
    <div
      onPointerDown={onDown}
      title={`${title} — drag`}
      style={{ position: "relative", width: 34, height: 34, cursor: "ns-resize", touchAction: "none" }}
    >
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: 999,
          border: `1px solid ${skin.border}`,
          backgroundImage: "linear-gradient(180deg, #30353b, #16191d)",
          boxShadow: "0 1px 3px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)",
        }}
      />
      {/* A faint arc track, and the indicator at the value's angle. */}
      <div
        style={{
          position: "absolute", left: "50%", top: "50%", width: 2, height: 14,
          background: accent, borderRadius: 1,
          transformOrigin: "bottom center",
          transform: `translate(-50%, -100%) rotate(${angle}deg)`,
        }}
      />
    </div>
  );
}

/** Clamp to 0..1, so a stray mapping can't throw the indicator off the dial. */
function u01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/**
 * A device's name, from openDAW's own static ClassName.
 *
 * NOT `constructor.name`. That works in dev and returns "e" in production,
 * because the minifier renames classes but leaves string values alone. Every
 * openDAW box declares `static readonly ClassName`, which is a string and
 * therefore survives.
 */
function boxClassName(box: unknown): string {
  const ctor = (box as { constructor?: { ClassName?: string; name?: string } })?.constructor;
  const raw = ctor?.ClassName ?? ctor?.name ?? "Device";
  return raw.replace(/DeviceBox$/, "").replace(/Box$/, "");
}

/** Compressor rather than CompressorDeviceBox. */
function deviceName(device: DeviceAdapterish): string {
  return boxClassName(device.box);
}

/**
 * openDAW's own printed value where it has one, a plain number otherwise.
 *
 * Its formatting knows what each parameter IS — a musical division prints as
 * "1/8", a time as "250 ms", a gain as "-12 dB". Guessing at that from the
 * raw float would be inventing units.
 */
function printed(param: Param, fallback: number): string {
  try {
    const result = param.getPrintValue?.();
    if (typeof result === "string" && result.length > 0) return result;
    if (result && typeof result === "object") {
      const r = result as { value?: unknown; unit?: unknown };
      const value = typeof r.value === "string" ? r.value : String(r.value ?? "");
      const unit = typeof r.unit === "string" ? r.unit : "";
      if (value.length > 0) return unit ? `${value} ${unit}` : value;
    }
  } catch {
    // A parameter that can't print itself still has a number worth showing.
  }
  return format(fallback);
}

/** Enough precision to be useful, not so much that it jitters. */
function format(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
