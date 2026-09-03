/**
 * A boundary around one panel, so a broken panel isn't a broken session.
 *
 * This exists because of the EQ. Its parameters are nested one level deeper than
 * every other device's, the generic device panel called `getValue()` on a group
 * object, and the throw during render unmounted the ENTIRE app — blank white
 * screen, transport gone, and any take recorded since the last upload gone with
 * it. The parameter shape is fixed; this is the second half of the fix, because
 * "one device we haven't met yet can destroy the session" is the real defect and
 * openDAW has a lot of devices we render generically.
 *
 * It shows what actually threw rather than a shrug. Per the house rule: errors
 * carry what was reported, not a guess — the message here is the one thing that
 * makes the next device-shape surprise a five-minute fix.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { font, radius, size, space, type Skin } from "./theme";

export interface PanelBoundaryProps {
  skin: Skin;
  /** Named in the message, so it's clear which panel failed. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PanelBoundary extends Component<PanelBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Into the console, which means into the engine log panel — the place we
    // already look when something goes wrong.
    console.error(`[${this.props.label}] panel crashed:`, error, info.componentStack);
  }

  /*
   * Re-rendering a panel that just threw usually throws again, so the reset is
   * explicit rather than automatic. Selecting a different device is the other
   * way out, and that remounts this anyway.
   */
  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { skin, label, children } = this.props;
    if (!error) return children;

    return (
      <div
        style={{
          padding: space[4],
          background: skin.surface,
          border: `1px solid #C0453B`,
          borderRadius: radius.md,
        }}
      >
        <p style={{ font: `600 ${size.base}px ${font.body}`, color: "#C0453B", margin: 0 }}>
          The {label} panel couldn't be drawn.
        </p>
        <p
          style={{
            font: `${size.sm}px ${font.mono}`, color: skin.fgMuted,
            margin: `${space[2]}px 0 0`, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}
        >
          {error.message}
        </p>
        <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: `${space[2]}px 0 0` }}>
          The rest of the session is unaffected — the transport, your takes and the mix are fine.
        </p>
        <button
          onClick={this.reset}
          style={{
            marginTop: space[3], height: 28, paddingInline: 12,
            font: `600 ${size.xs}px ${font.body}`, letterSpacing: ".08em", textTransform: "uppercase",
            color: skin.fg, background: "transparent",
            border: `1px solid ${skin.border}`, borderRadius: radius.sm, cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
