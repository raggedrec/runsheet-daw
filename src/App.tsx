/**
 * Phase 1: prove the engine starts, and say plainly when it doesn't.
 *
 * There is no timeline here yet on purpose. The thing worth knowing first is
 * whether cross-origin isolation, the workers, the worklets and the Rust
 * engine all come up on a real machine — and if one of them doesn't, which.
 */
import { useEffect, useState } from "react";
import { boot, BootError, type BootResult } from "./opendawBoot";
import { isConfigured, requestedSong, supabase } from "./supabase";

type Status =
  | { state: "booting" }
  | { state: "ready"; result: BootResult }
  | { state: "failed"; message: string; remedy: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: "booting" });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const song = requestedSong();

  useEffect(() => {
    let cancelled = false;
    boot()
      .then((result) => !cancelled && setStatus({ state: "ready", result }))
      .catch((err) => {
        if (cancelled) return;
        setStatus(
          err instanceof BootError
            ? { state: "failed", message: err.message, remedy: err.remedy }
            : {
                state: "failed",
                message: err instanceof Error ? err.message : "The engine failed to start.",
                remedy: "Check the browser console for the underlying error.",
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reported, not enforced. Phase 1 only needs to know whether the shared
  // cookie session actually arrived from Run Sheet.
  useEffect(() => {
    if (!isConfigured) {
      setSignedIn(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  return (
    <main style={S.page}>
      <h1 style={S.h1}>Run Sheet — DAW</h1>
      <p style={S.sub}>Phase 1 · engine boot check</p>

      <section style={S.panel}>
        <h2 style={S.h2}>Engine</h2>
        {status.state === "booting" && <pre style={S.pre}>starting…</pre>}
        {status.state === "ready" && (
          <pre style={S.pre}>
            {[
              `cross-origin isolated : ${self.crossOriginIsolated}`,
              `SharedArrayBuffer     : ${typeof SharedArrayBuffer !== "undefined"}`,
              `audio engine          : ${status.result.wasm ? "Rust (WASM)" : "TypeScript fallback"}`,
              `sample rate           : ${status.result.sampleRate} Hz`,
              `context state         : ${status.result.audioContext.state}`,
            ].join("\n")}
          </pre>
        )}
        {status.state === "failed" && (
          <pre style={{ ...S.pre, color: "#b3261e" }}>
            {status.message}
            {"\n\n"}
            {status.remedy}
          </pre>
        )}
      </section>

      <section style={S.panel}>
        <h2 style={S.h2}>Session and song</h2>
        <pre style={S.pre}>
          {[
            `supabase configured : ${isConfigured}`,
            `signed in           : ${signedIn === null ? "checking…" : signedIn}`,
            `scene               : ${song.sceneId ?? "(none in the URL)"}`,
            `track               : ${song.trackId ?? "(none in the URL)"}`,
          ].join("\n")}
        </pre>
      </section>

      {/*
        AGPL §13: anyone interacting with this over a network is entitled to
        the source. A LICENSE file in the repo alone doesn't discharge that —
        the running app has to offer it, which is what this link is for.
      */}
      <footer style={S.footer}>
        Run Sheet DAW is free software under the{" "}
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" style={S.a}>
          GNU AGPL v3
        </a>
        . <a href="https://github.com/raggedrec/runsheet-daw" style={S.a}>Source code</a>. Built on{" "}
        <a href="https://opendaw.org" style={S.a}>openDAW</a>.
      </footer>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 720,
    margin: "0 auto",
    padding: 28,
    font: '14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    color: "#1c110a",
  },
  h1: { fontSize: 19, margin: "0 0 2px" },
  sub: { color: "rgba(28,17,10,.62)", fontSize: 13, margin: "0 0 20px" },
  panel: { background: "#fff", border: "1px solid rgba(28,17,10,.15)", padding: 16, marginBottom: 14 },
  h2: {
    fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em",
    color: "rgba(28,17,10,.62)", margin: "0 0 12px",
  },
  pre: {
    background: "#fafafa", border: "1px solid rgba(28,17,10,.15)", padding: 12,
    font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre-wrap", margin: 0,
  },
  footer: { fontSize: 12, color: "rgba(28,17,10,.62)", marginTop: 24 },
  a: { color: "#004b84" },
};
