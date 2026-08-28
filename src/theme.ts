/**
 * The DAW's look: two skins, a few user choices, and hard limits on both.
 *
 * The palette is Ragged Company Recordings' own, read out of the live
 * stylesheet at raggedcompanyrecordings.com rather than eyeballed from a
 * screenshot, so the DAW is the same object as the label. If the site changes,
 * re-read it rather than nudging hex codes until they look close.
 *
 * Two skins, because a waveform needs contrast against the lane behind it and
 * there is no single background that flatters both a printed look and a
 * studio one:
 *
 *   paper — light lanes, dark waveforms. Reads like the label's site.
 *   dark  — dark lanes, light waveforms. Reads like every other DAW.
 *
 * What the user can change is the accent — the playhead, the transport, the
 * highlights. What they cannot change is the relationship between a lane and
 * the waveform drawn on it. That's the legibility barrier: pick your colour,
 * but you can't pick one that makes the audio invisible.
 */

export type SkinName = "paper" | "dark";

/** The brand palette. Everything below is assembled from these. */
export const brand = {
  blue: "#004B84",
  blue700: "#003A66",
  blue500: "#005FA8",
  blue100: "#D6E4EF",
  red: "#C44536",
  red700: "#9A3528",
  yellow: "#FBAF01",
  yellow700: "#C88B00",
  paper: "#E9E9E9",
  cream: "#ECDEC2",
  white: "#FFFFFF",
  ink: "#1C110A",
} as const;

/**
 * The accents a user may choose.
 *
 * Each carries its own foreground, because white text on the yellow is
 * unreadable and ink on the blue is worse. Pairing them here means a bad
 * combination can't be selected rather than being merely discouraged.
 */
export const accents = {
  blue: { name: "Blue", solid: brand.blue, hover: brand.blue700, fg: brand.white },
  yellow: { name: "Yellow", solid: brand.yellow, hover: brand.yellow700, fg: brand.ink },
  red: { name: "Red", solid: brand.red, hover: brand.red700, fg: brand.white },
} as const;

export type AccentName = keyof typeof accents;

export interface Skin {
  name: SkinName;
  /** Page and chrome. */
  bg: string;
  surface: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  border: string;
  borderStrong: string;
  /** The timeline: lanes, grid and the audio drawn on them. */
  lane: string;
  laneAlt: string;
  laneLine: string;
  laneLabel: string;
  /** Waveform fill. Always the opposite weight to `lane` — see the note above. */
  wave: string;
  waveMuted: string;
  /** Bar lines are stronger than beat lines, or the grid reads as noise. */
  gridBar: string;
  gridBeat: string;
  shadow: string;
}

const paper: Skin = {
  name: "paper",
  bg: brand.paper,
  surface: brand.white,
  fg: brand.ink,
  fgMuted: "rgba(28,17,10,.70)",
  fgSubtle: "rgba(28,17,10,.40)",
  border: "rgba(28,17,10,.15)",
  borderStrong: brand.ink,
  lane: brand.white,
  laneAlt: "#F4F1EA",
  laneLine: "rgba(28,17,10,.15)",
  laneLabel: brand.ink,
  wave: brand.ink,
  waveMuted: "rgba(28,17,10,.28)",
  gridBar: "rgba(28,17,10,.28)",
  gridBeat: "rgba(28,17,10,.10)",
  shadow: "0 1px 0 rgba(28,17,10,.15), 0 8px 24px -8px rgba(28,17,10,.15)",
};

const dark: Skin = {
  name: "dark",
  // Derived from the brand ink rather than a neutral grey, so the dark skin
  // still belongs to the same product instead of looking like a default.
  bg: "#17100B",
  surface: "#211812",
  fg: "#F2EDE6",
  fgMuted: "rgba(242,237,230,.68)",
  fgSubtle: "rgba(242,237,230,.40)",
  border: "rgba(242,237,230,.14)",
  borderStrong: "rgba(242,237,230,.34)",
  lane: "#1E1610",
  laneAlt: "#241B14",
  laneLine: "rgba(242,237,230,.12)",
  laneLabel: "#F2EDE6",
  wave: "#F2EDE6",
  waveMuted: "rgba(242,237,230,.30)",
  gridBar: "rgba(242,237,230,.26)",
  gridBeat: "rgba(242,237,230,.09)",
  shadow: "0 1px 0 rgba(0,0,0,.4), 0 8px 24px -8px rgba(0,0,0,.6)",
};

export const skins: Record<SkinName, Skin> = { paper, dark };

export const font = {
  stamp: '"Impact Label", "Special Elite", "Courier New", monospace',
  display: '"Bebas Neue", "Oswald", "Impact", sans-serif',
  body: '"Futura", "Futura PT", "Avenir Next", "Avenir", "Helvetica Neue", system-ui, sans-serif',
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
} as const;

export const size = { xs: 12, sm: 14, base: 16, md: 18, lg: 22, xl: 28, xxl: 36 } as const;
export const tracking = { stamp: "0.04em", display: "0.02em", caps: "0.12em" } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const;
export const radius = { none: 0, sm: 2, md: 4, pill: 999 } as const;
export const motion = {
  snap: "cubic-bezier(.2,.9,.1,1)",
  out: "cubic-bezier(0,0,.2,1)",
  fast: "120ms",
  base: "200ms",
} as const;

/**
 * Lane colours by stem role, not by position.
 *
 * Position-based colours change meaning whenever a stem is added, so a session
 * looks different every time it's opened. Role-based ones stay put: drums are
 * always red, vocals always yellow.
 *
 * These tint the lane header only, never the waveform — a red waveform on a
 * paper lane and a red one on a dark lane can't both be legible, and the
 * waveform's contrast is not negotiable.
 */
const roleColors: ReadonlyArray<readonly [RegExp, string]> = [
  [/drum|dr\b|kick|snare|perc/i, brand.red],
  [/bass|bs\b|808/i, "#7A4E2D"],
  [/vox|voc|vcl|lead|sing/i, brand.yellow],
  [/gtr|guit|aco|acou|elec/i, brand.yellow700],
  [/key|pian|rhod|wurl|organ|synth|pad/i, brand.blue500],
  [/mix|master|full|ref/i, brand.blue],
];

export function laneColorFor(name: string): string {
  for (const [pattern, color] of roleColors) {
    if (pattern.test(name)) return color;
  }
  return "#6B7B8C";
}

/** What the user has chosen. Small enough to keep in one place. */
export interface Look {
  skin: SkinName;
  accent: AccentName;
  /** Lane height in pixels. Bounded — see LANE_HEIGHT. */
  laneHeight: number;
}

/**
 * Lane height limits.
 *
 * Below about 40px a stereo waveform is a smear and the lane name stops
 * fitting; above ~160px a four-stem song no longer fits on a laptop screen
 * and the transport scrolls away. Both ends are legibility, not taste.
 */
export const LANE_HEIGHT = { min: 44, max: 160, default: 84 } as const;

export const DEFAULT_LOOK: Look = {
  skin: "dark",
  accent: "yellow",
  laneHeight: LANE_HEIGHT.default,
};

/** Clamps anything read back from storage, so a stale value can't break the UI. */
export function sanitizeLook(raw: unknown): Look {
  const l = (raw ?? {}) as Partial<Look>;
  const skin: SkinName = l.skin === "paper" || l.skin === "dark" ? l.skin : DEFAULT_LOOK.skin;
  const accent: AccentName =
    l.accent && Object.prototype.hasOwnProperty.call(accents, l.accent)
      ? l.accent
      : DEFAULT_LOOK.accent;
  const height = Number(l.laneHeight);
  return {
    skin,
    accent,
    laneHeight: Number.isFinite(height)
      ? Math.min(LANE_HEIGHT.max, Math.max(LANE_HEIGHT.min, Math.round(height)))
      : LANE_HEIGHT.default,
  };
}
