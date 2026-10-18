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
  /** The signature warm accent of the dark refresh — "tape" amber. Distinct
   *  from brand.amber above, which stays the darker tone used as a palette
   *  swatch; the clay reads as a deliberate accent on the near-black ground. */
  clay: "#E6A35C",
  clayDeep: "#CE8B45",
  lilac: "#9E8AD6",
} as const;

/**
 * The three transport-critical track states, each its own colour so a glance at
 * a strip reads its state without hunting: solo yellow, mute green, record-arm
 * red. Fixed regardless of the chosen accent — these mean the same thing on
 * every desk and shouldn't shift with a theme.
 */
export const control = {
  solo: "#E0B000",
  mute: "#3B9E5A",
  arm: "#C0453B",
} as const;

/**
 * Selectable accents, each with the foreground that stays readable on it.
 * Pairing them here means an unreadable combination cannot be chosen, rather
 * than merely being discouraged.
 */
export const accents = {
  blue: { name: "Blue", solid: brand.blue, hover: brand.blueDeep, fg: "#FFFFFF" },
  teal: { name: "Teal", solid: brand.teal, hover: "#1F6167", fg: "#FFFFFF" },
  amber: { name: "Amber", solid: brand.clay, hover: brand.clayDeep, fg: "#241603" },
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
  bg: "#0E1116",
  surface: "#161C23",
  surfaceSunken: "#10151B",
  fg: "#ECEFF3",
  fgMuted: "rgba(236,239,243,.64)",
  fgSubtle: "rgba(236,239,243,.40)",
  border: "rgba(236,239,243,.10)",
  borderStrong: "rgba(236,239,243,.26)",
  lane: "#11151B",
  laneAlt: "#141922",
  laneLine: "rgba(236,239,243,.08)",
  wave: "#D8E2EC",
  waveMuted: "rgba(216,226,236,.22)",
  gridBar: "rgba(236,239,243,.20)",
  gridBeat: "rgba(236,239,243,.06)",
  slot: "rgba(236,239,243,.13)",
};

export const skins: Record<SkinName, Skin> = { light, dark };

/**
 * The type stack. IBM Plex Sans for chrome, IBM Plex Mono wherever digits must
 * not jitter, Space Grotesk for titles and the wordmark. All three are
 * self-hosted via @fontsource (imported in main.tsx): the page is cross-origin
 * isolated (COEP require-corp) and cannot pull webfonts from a CDN. Each stack
 * keeps a system fallback so the UI stays legible if a face fails to load.
 */
export const font = {
  body: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace',
  display: '"Space Grotesk", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
} as const;

export const size = { xs: 11, sm: 12, base: 13, md: 15, lg: 19, xl: 24 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
export const radius = { sm: 4, md: 6, lg: 8, pill: 999 } as const;

/**
 * Lane stripe colours by stem role, not by position.
 *
 * Position-based colours change meaning whenever a stem is added, so a session
 * looks different every time it's opened. Role-based ones stay put: drums are
 * always red, vocals always lilac. These tint the lane header only — never the
 * waveform, whose contrast is set by the skin and left alone. Tuned brighter
 * for the dark refresh so each role reads at a glance against the near-black
 * lanes, and so vocals sit clear of the amber accent.
 */
const roleColors: ReadonlyArray<readonly [RegExp, string]> = [
  [/drum|kick|snare|perc|\bdr\b/i, brand.red],
  [/bass|\bbs\b|808/i, "#CF9A4E"],
  [/vox|voc|vcl|sing|lead/i, brand.lilac],
  [/gtr|guit|aco|acou|elec/i, "#C7A24A"],
  [/key|pian|rhod|wurl|organ|synth|pad/i, "#52ABCC"],
  [/mix|master|full|ref/i, brand.blue],
];

export function laneColorFor(name: string): string {
  for (const [pattern, color] of roleColors) if (pattern.test(name)) return color;
  return "#8A94A0";
}

/**
 * The swatches the track colour picker offers.
 *
 * The role colours first — so the automatic choice is one click to confirm —
 * then a spread across the wheel for the times a musician wants their own. A
 * fixed set rather than a free colour wheel because ten deliberate, legible
 * colours beat sixteen million, most of which vanish against one skin or the
 * other.
 */
export const TRACK_PALETTE: ReadonlyArray<string> = [
  brand.red, "#CF9A4E", brand.lilac, "#C7A24A", "#52ABCC",
  brand.blue, control.solo, "#3B9E5A", "#9C4F9C", "#8A94A0",
];

/**
 * Black ink or white, whichever reads on a given solid colour — so a label on
 * the yellow solo isn't the washed-out white that works on the red and green.
 * WCAG relative luminance, dark ink above the mid threshold.
 */
export function readableOn(hex: string): string {
  if (hex.length !== 7 || hex[0] !== "#") return "#FFFFFF";
  const n = parseInt(hex.slice(1), 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  return lum > 0.45 ? "#1B2430" : "#FFFFFF";
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

/**
 * The refresh opens dark, on the amber accent, with waveforms tinted to their
 * stem's role colour — the direction Shayne signed off. A returning user's
 * stored choice still wins (useLook reads localStorage first); this only sets
 * what a fresh browser sees.
 */
export const DEFAULT_LOOK: Look = { skin: "dark", accent: "amber", laneHeight: LANE_HEIGHT.default, colorWaveforms: true };

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

/**
 * One-time look migration. Bumping LOOK_REV moves every returning browser onto
 * the current DEFAULT_LOOK once. Before the dark + amber refresh a saved look
 * from an older build — usually light + blue — hid the new default entirely,
 * because a stored preference always wins over it, so the refresh would never
 * reach anyone who had opened the app before.
 *
 * Lane height is kept: it's ergonomics, set deliberately, not part of the look
 * being refreshed. useLook records the rev after applying this, so it fires a
 * single time per browser; whatever the user picks afterwards sticks.
 */
export const LOOK_REV = 1;

export function migrateLook(stored: Look, rev: number): Look {
  return rev < LOOK_REV ? { ...DEFAULT_LOOK, laneHeight: stored.laneHeight } : stored;
}
