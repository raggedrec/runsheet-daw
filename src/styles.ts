/**
 * Run Sheet's look, in plain objects.
 *
 * No CSS framework on purpose: this app is a handful of screens and the whole
 * bundle already carries an audio engine. The colours match Run Sheet so the
 * two feel like one product across the tab boundary.
 */
import type { CSSProperties } from "react";

const INK = "#1c110a";
const MUTED = "rgba(28,17,10,.62)";
const FAINT = "rgba(28,17,10,.42)";
const LINE = "rgba(28,17,10,.15)";
const ACCENT = "#004b84";
const BAD = "#b3261e";

export const S: Record<string, CSSProperties> = {
  page: {
    maxWidth: 780,
    margin: "0 auto",
    padding: 28,
    font: '14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    color: INK,
  },
  header: { display: "flex", alignItems: "baseline", gap: 16, marginBottom: 20 },
  h1: { fontSize: 21, margin: "0 0 2px", fontWeight: 600 },
  h2: {
    fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em",
    color: MUTED, margin: "0 0 12px", fontWeight: 600,
  },
  sub: { color: MUTED, fontSize: 13, margin: 0 },

  panel: { background: "#fff", border: `1px solid ${LINE}`, padding: 16, marginBottom: 14 },
  panelBad: {
    background: "#fff", border: `1px solid ${LINE}`, borderLeft: `3px solid ${BAD}`,
    padding: 16, marginBottom: 14,
  },
  badTitle: { color: BAD, fontWeight: 600, margin: "0 0 6px", fontSize: 14 },

  transport: {
    display: "flex", alignItems: "center", gap: 12,
    background: "#fff", border: `1px solid ${LINE}`, padding: 12, marginBottom: 14,
  },
  clock: {
    font: "15px ui-monospace, SFMono-Regular, Menlo, monospace",
    fontVariantNumeric: "tabular-nums",
  },

  lane: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "9px 0", borderTop: `1px solid ${LINE}`,
  },
  laneName: { fontWeight: 500 },

  button: {
    padding: "9px 16px", fontSize: 13, fontWeight: 600,
    color: "#fff", background: ACCENT, border: 0, cursor: "pointer",
  },
  buttonQuiet: {
    padding: "9px 16px", fontSize: 13, fontWeight: 500,
    color: INK, background: "transparent", border: `1px solid ${LINE}`, cursor: "pointer",
  },

  note: { color: MUTED, fontSize: 13, margin: "0 0 10px" },
  noteFaint: { color: FAINT, fontSize: 12, margin: 0 },
  footer: { fontSize: 12, color: MUTED, marginTop: 28 },
  a: { color: ACCENT },
};
