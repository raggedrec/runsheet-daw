/**
 * The DAW shell's chrome — the song header, the boot/error panels, and the
 * always-on AGPL footer that every stage renders inside. Everything the loaded
 * mix draws comes from theme.ts tokens; this file is only the few pieces DawApp
 * wraps around it.
 *
 * It used to be a static, light-only palette (hardcoded white panels, brown
 * ink, one dark-blue link). That was a second source of truth for colour, and
 * it showed white error cards and low-contrast links once the app defaulted to
 * the dark skin. Now it derives from the active skin and accent, so the shell
 * matches the mix it frames.
 */
import type { CSSProperties } from "react";
import { control, font, radius, size, type Skin } from "./theme";

export function shell(skin: Skin, link: string): Record<string, CSSProperties> {
  return {
    page: {
      maxWidth: 780,
      margin: "0 auto",
      padding: 28,
      font: `14px/1.55 ${font.body}`,
      color: skin.fg,
    },
    header: { display: "flex", alignItems: "baseline", gap: 16, marginBottom: 20 },
    h1: { font: `700 ${size.xl}px ${font.display}`, margin: "0 0 2px", color: skin.fg },
    sub: { font: `${size.base}px ${font.body}`, color: skin.fgMuted, margin: 0 },

    panelBad: {
      background: skin.surface,
      border: `1px solid ${skin.border}`,
      borderLeft: `3px solid ${control.arm}`,
      borderRadius: radius.md,
      padding: 16,
      marginBottom: 14,
    },
    badTitle: { font: `600 ${size.md}px ${font.display}`, color: control.arm, margin: "0 0 6px" },

    note: { font: `${size.base}px ${font.body}`, color: skin.fgMuted, margin: "0 0 10px" },
    footer: { font: `${size.sm}px ${font.body}`, color: skin.fgMuted, marginTop: 28 },
    a: { color: link },
  };
}
