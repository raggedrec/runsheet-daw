/**
 * The DAW's look: Run Sheet's, so the two apps feel like one product across
 * the tab boundary.
 *
 * An earlier version of this file took the label site's player as the model —
 * cream, letterpress shadows, Bebas caps. It looked like the website and
 * nothing like the app the DAW opens from. Run Sheet's chrome is quieter:
 * near-white surfaces on a light grey page, one solid blue for anything
 * clickable, hairline borders, small uppercase labels. That reads better at
 * the density a DAW needs, where a dozen controls sit in the space a player
 * gives to three.
 *
 * Two skins, because a waveform needs contrast against its lane and no single
 * background gives it:
 *
 *   light — Run Sheet's own palette. Pale lanes, dark waveforms.
 *   dark  — the same layout inverted, for working at night against a mix.
 *
 * The user picks the skin, the accent and the lane height. They cannot pick a
 * combination that makes the audio unreadable: accents ship their own
 * foreground, and the lane/waveform relationship is fixed by the skin.
 */

export type SkinName = "light" | "dark";

export const brand = {
  blue: "#1D4E89",
  blueDeep: "#173F6E",
  blueSoft: "#E8EEF5",
  ink: "#1B2430",
  red: "#C0453B",
  amber: "#C88B00",
  teal: "#2A7F86",
} as const;

/**
 * Selectable accents, each with the foreground that stays readable on it.
 * Pairing them here means an unreadable combination cannot be chosen, rather
 * than merely being discouraged.
 */
export const accents = {
  blue: { name: "Blue", solid: brand.blue, hover: brand.blueDeep, fg: "#FFFFFF" },
  teal: { name: "Teal", solid: brand.teal, hover: "#1F6167", fg: "#FFFFFF" },
  amber: { name: "Amber", solid: brand.amber, hover: "#9E6E00", fg: "#1B2430" },
  red: { name: "Red", solid: brand.red, hover: "#9C352C", fg: "#FFFFFF" },
} as const;

export type AccentName = keyof typeof accents;

export interface Skin {
  name: SkinName;
  bg: string;
  surface: string;
  surfaceSunken: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  border: string;
  borderStrong: string;
  /** Timeline lanes. */
  lane: string;
  laneAlt: string;
  laneLine: string;
  /** Waveform fill — always the opposite weight to `lane`. Not negotiable. */
  wave: string;
  waveMuted: string;
  gridBar: string;
  gridBeat: string;
  /** Fader track, before the filled portion. */
  slot: string;
}

const light: Skin = {
  name: "light",
  bg: "#F2F3F5",
  surface: "#FFFFFF",
  surfaceSunken: "#F7F8FA",
  fg: brand.ink,
  fgMuted: "rgba(27,36,48,.62)",
  fgSubtle: "rgba(27,36,48,.42)",
  border: "rgba(27,36,48,.13)",
  borderStrong: "rgba(27,36,48,.30)",
  lane: "#FFFFFF",
  laneAlt: "#F7F8FA",
  laneLine: "rgba(27,36,48,.12)",
  wave: "#2C3B4C",
  waveMuted: "rgba(27,36,48,.22)",
  gridBar: "rgba(27,36,48,.22)",
  gridBeat: "rgba(27,36,48,.07)",
  slot: "rgba(27,36,48,.12)",
};

const dark: Skin = {
  name: "dark",
  bg: "#12171D",
  surface: "#1A212A",
  surfaceSunken: "#161C23",
  fg: "#E8EDF3",
  fgMuted: "rgba(232,237,243,.66)",
  fgSubtle: "rgba(232,237,243,.40)",
  border: "rgba(232,237,243,.13)",
  borderStrong: "rgba(232,237,243,.30)",
  lane: "#161C23",
  laneAlt: "#1A212A",
  laneLine: "rgba(232,237,243,.11)",
  wave: "#D8E2EC",
  waveMuted: "rgba(216,226,236,.24)",
  gridBar: "rgba(232,237,243,.22)",
  gridBeat: "rgba(232,237,243,.07)",
  slot: "rgba(232,237,243,.14)",
};

export const skins: Record<SkinName, Skin> = { light, dark };

/** Run Sheet's stack: system UI for chrome, mono where digits must not jitter. */
export const font = {
  body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace',
} as const;

export const size = { xs: 11, sm: 12, base: 13, md: 15, lg: 19, xl: 24 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
export const radius = { sm: 4, md: 6, lg: 8, pill: 999 } as const;

/**
 * Lane stripe colours by stem role, not by position.
 *
 * Position-based colours change meaning whenever a stem is added, so a session
 * looks different every time it's opened. Role-based ones stay put: drums are
 * always red, vocals always amber. These tint the lane header only — never the
 * waveform, whose contrast is set by the skin and left alone.
 */
const roleColors: ReadonlyArray<readonly [RegExp, string]> = [
  [/drum|kick|snare|perc|\bdr\b/i, brand.red],
  [/bass|\bbs\b|808/i, "#7A5230"],
  [/vox|voc|vcl|sing|lead/i, brand.amber],
  [/gtr|guit|aco|acou|elec/i, "#8A6B2F"],
  [/key|pian|rhod|wurl|organ|synth|pad/i, brand.teal],
  [/mix|master|full|ref/i, brand.blue],
];

export function laneColorFor(name: string): string {
  for (const [pattern, color] of roleColors) if (pattern.test(name)) return color;
  return "#6B7B8C";
}

export interface Look {
  skin: SkinName;
  accent: AccentName;
  laneHeight: number;
  /** Tint each waveform its track's role colour instead of the skin's default. */
  colorWaveforms: boolean;
}

/**
 * Lane height limits.
 *
 * Below the floor a stereo waveform is a smear and the name stops fitting;
 * above the ceiling a four-stem song no longer fits on a laptop screen and the
 * transport scrolls out of reach. Both ends are legibility, not taste.
 */
export const LANE_HEIGHT = { min: 44, max: 160, default: 84 } as const;

export const DEFAULT_LOOK: Look = { skin: "light", accent: "blue", laneHeight: LANE_HEIGHT.default, colorWaveforms: false };

/** Clamps anything read back from storage, so a stale value can't break the UI. */
export function sanitizeLook(raw: unknown): Look {
  const l = (raw ?? {}) as Partial<Look>;
  const skin: SkinName = l.skin === "light" || l.skin === "dark" ? l.skin : DEFAULT_LOOK.skin;
  const accent: AccentName =
    l.accent && Object.prototype.hasOwnProperty.call(accents, l.accent) ? l.accent : DEFAULT_LOOK.accent;
  const h = Number(l.laneHeight);
  return {
    skin,
    accent,
    laneHeight: Number.isFinite(h)
      ? Math.min(LANE_HEIGHT.max, Math.max(LANE_HEIGHT.min, Math.round(h)))
      : LANE_HEIGHT.default,
    colorWaveforms: l.colorWaveforms === true,
  };
}
