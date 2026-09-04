/**
 * The effects rack for the selected track.
 *
 * openDAW ships real devices — compressor, gate, EQ, reverbs, delay,
 * saturation, a neural amp modeler — and until now none of them were reachable.
 * They were sitting in the bundle doing nothing.
 *
 * What this does NOT do is edit their parameters. Each device has its own
 * controls, and building twenty device UIs is a project rather than a panel.
 * Adding one to a chain, seeing the chain, and removing it is the useful 20%:
 * an artist can put a compressor on a vocal and hear it, which is the thing
 * they actually wanted.
 */
import { useCallback, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { EffectFactories } from "@opendaw/studio-core";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { font, radius, size, space, type Skin } from "./theme";

/**
 * The devices offered, in the order a signal usually meets them.
 *
 * Not every factory openDAW has — a list of twenty is a menu nobody reads.
 * These are the ones that answer "my vocal needs help": control the dynamics,
 * shape the tone, add space.
 */
const OFFERED: ReadonlyArray<{ key: string; label: string; factory: unknown; note: string }> = [
  { key: "Gate", label: "Gate", factory: EffectFactories.Gate, note: "Cuts what's below the threshold" },
  { key: "Compressor", label: "Compressor", factory: EffectFactories.Compressor, note: "Evens out the loud and quiet" },
  { key: "Revamp", label: "EQ", factory: EffectFactories.Revamp, note: "Shapes the tone" },
  { key: "NeuralAmp", label: "Amp (NAM)", factory: EffectFactories.NeuralAmp, note: "A neural amp/pedal capture — load a .nam" },
  { key: "Convolver", label: "IR (cab / reverb)", factory: EffectFactories.Convolver, note: "A cab or reverb impulse — a preset or your own .wav" },
  { key: "Tidal", label: "Saturator", factory: EffectFactories.Tidal, note: "Warmth and grit" },
  { key: "Delay", label: "Delay", factory: EffectFactories.Delay, note: "Echoes in time" },
  { key: "DattorroReverb", label: "Reverb", factory: EffectFactories.DattorroReverb, note: "Puts it in a room" },
  { key: "StereoTool", label: "Stereo", factory: EffectFactories.StereoTool, note: "Width and balance" },
  { key: "Maximizer", label: "Maximizer", factory: EffectFactories.Maximizer, note: "Loudness, with a ceiling" },
];

export interface EffectsRackProps {
  project: Project;
  /** The track whose chain is shown, or null when none is selected. */
  unit: AudioUnitBox | null;
  trackName: string | null;
  skin: Skin;
  accent: string;
  revision: number;
  onChanged: () => void;
}

export function EffectsRack({ project, unit, trackName, skin, accent, revision, onChanged }: EffectsRackProps) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void revision;

  /*
   * The chain lives on the unit's adapter, not the box. Found by identity
   * rather than index, because track order changes whenever a take is added.
   */
  const adapter = unit
    ? project.rootBoxAdapter.audioUnits.adapters().find((a) => a.box === unit)
    : undefined;
  const effectsField = adapter?.audioEffectsField;
  const chain = adapter?.audioEffects.mapOr((c) => c.adapters(), () => []) ?? [];

  const add = useCallback(
    (factory: unknown) => {
      if (!effectsField || effectsField.isEmpty()) {
        setError("This track can't take effects.");
        return;
      }
      setError(null);
      // Inside a transaction, like every other box write.
      project.editing.modify(() => {
        project.api.insertEffect(effectsField.unwrap(), factory as never);
      });
      setAdding(false);
      onChanged();
    },
    [project, effectsField, onChanged],
  );

  const remove = useCallback(
    (box: { delete: () => void }) => {
      project.editing.modify(() => box.delete());
      onChanged();
    },
    [project, onChanged],
  );

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "baseline", gap: space[2],
          padding: `${space[3]}px ${space[4]}px`,
          borderBottom: `1px solid ${skin.border}`,
        }}
      >
        <h2
          style={{
            font: `600 ${size.xs}px ${font.body}`,
            letterSpacing: ".08em", textTransform: "uppercase",
            color: skin.fgSubtle, margin: 0,
          }}
        >
          Effects
        </h2>
        <span style={{ font: `${size.sm}px ${font.body}`, color: skin.fgMuted }}>
          {trackName ?? "no track selected"}
        </span>
      </header>

      <div style={{ padding: space[3] }}>
        {!unit && (
          <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: 0 }}>
            Click a track name to load its chain.
          </p>
        )}

        {unit && chain.length === 0 && !adding && (
          <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: `0 0 ${space[3]}px` }}>
            Nothing on this track yet.
          </p>
        )}

        {/* The chain, in signal order — the order they are in is the order the
            audio meets them, so the list is the truth rather than a legend. */}
        {chain.map((effect, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", gap: space[3],
              padding: `${space[2]}px ${space[3]}px`,
              marginBottom: 4,
              background: skin.surfaceSunken,
              border: `1px solid ${skin.border}`,
              borderRadius: radius.sm,
            }}
          >
            <span style={{ font: `500 ${size.xs}px ${font.mono}`, color: skin.fgSubtle, width: 16 }}>
              {i + 1}
            </span>
            <span style={{ font: `600 ${size.base}px ${font.body}`, color: skin.fg, flex: 1 }}>
              {labelFor(effect)}
            </span>
            <button
              onClick={() => remove(effect.box as unknown as { delete: () => void })}
              title="Remove"
              style={{
                width: 24, height: 24, cursor: "pointer",
                background: "transparent", color: skin.fgSubtle,
                border: `1px solid ${skin.border}`, borderRadius: radius.sm,
                font: `600 ${size.sm}px ${font.body}`, padding: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}

        {unit && !adding && (
          <button
            onClick={() => setAdding(true)}
            style={{
              width: "100%", height: 32, marginTop: space[2],
              font: `600 ${size.sm}px ${font.body}`,
              color: accent, background: "transparent",
              border: `1px dashed ${skin.borderStrong}`,
              borderRadius: radius.sm, cursor: "pointer",
            }}
          >
            + Add effect
          </button>
        )}

        {unit && adding && (
          <div style={{ marginTop: space[2] }}>
            {OFFERED.map((d) => (
              <button
                key={d.key}
                onClick={() => add(d.factory)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start",
                  width: "100%", textAlign: "left", gap: 1,
                  padding: `${space[2]}px ${space[3]}px`, marginBottom: 2,
                  background: "transparent", cursor: "pointer",
                  border: `1px solid ${skin.border}`, borderRadius: radius.sm,
                }}
              >
                <span style={{ font: `600 ${size.base}px ${font.body}`, color: skin.fg }}>{d.label}</span>
                {/* One line of plain English each: "Revamp" and "Tidal" mean
                    nothing to someone who just wants their vocal to sit. */}
                <span style={{ font: `${size.xs}px ${font.body}`, color: skin.fgSubtle }}>{d.note}</span>
              </button>
            ))}
            <button
              onClick={() => setAdding(false)}
              style={{
                width: "100%", height: 28, marginTop: 4,
                font: `500 ${size.xs}px ${font.body}`, color: skin.fgSubtle,
                background: "transparent", border: "none", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {error && (
          <p style={{ font: `${size.sm}px ${font.body}`, color: "#C0453B", margin: `${space[2]}px 0 0` }}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A readable device name.
 *
 * From openDAW's static ClassName, not `constructor.name` — the latter works in
 * dev and returns a single minified letter in production, which is where the
 * effects list started showing every device as "e".
 */
function labelFor(effect: unknown): string {
  const ctor = (effect as { box?: { constructor?: { ClassName?: string; name?: string } } })?.box
    ?.constructor;
  const raw = ctor?.ClassName ?? ctor?.name ?? "Effect";
  const known = OFFERED.find((d) => raw.startsWith(d.key));
  return known ? known.label : raw.replace(/DeviceBox$/, "").replace(/Box$/, "");
}
