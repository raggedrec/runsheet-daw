/**
 * The DAW: one song from Run Sheet, its stems as lanes, and a transport.
 *
 * Loading is deliberate rather than automatic — several minutes of audio is
 * fetched, decoded and written to local storage, and nobody should pay that
 * just for following a link. The button also gives the browser the user
 * gesture it needs before an AudioContext will run.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { boot, startAudio, BootError, type BootResult } from "./opendawBoot";
import { createSession, type DawSession } from "./opendaw/session";
import { loadSongIntoProject, tempoOf, type LoadedLane, type LoadProgress } from "./opendaw/loadSong";
import { loadSong, playableFiles, LoadError, type Song } from "./runsheet";
import { isConfigured, requestedSong, supabase } from "./supabase";
import { useAnimationValue, useObservable } from "./useObservable";
import { S } from "./styles";

type Stage =
  | { name: "booting" }
  | { name: "blocked"; message: string; remedy: string }
  | { name: "ready" }
  | { name: "loading"; progress: LoadProgress | null }
  | { name: "loaded" };

export default function DawApp() {
  const [stage, setStage] = useState<Stage>({ name: "booting" });
  const [bootResult, setBootResult] = useState<BootResult | null>(null);
  const [session, setSession] = useState<DawSession | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [lanes, setLanes] = useState<LoadedLane[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const params = useMemo(() => requestedSong(), []);

  // --- boot the engine, then fetch the song's details ----------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await boot();
        if (cancelled) return;
        setBootResult(result);

        if (!isConfigured) {
          setStage({
            name: "blocked",
            message: "This app isn't configured.",
            remedy: "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.",
          });
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSignedIn(Boolean(data.session));

        if (!params.sceneId || !params.trackId) {
          setStage({
            name: "blocked",
            message: "No song was named in the link.",
            remedy: "Open a song in Run Sheet and press DAW.",
          });
          return;
        }

        const loaded = await loadSong(params.sceneId, params.trackId);
        if (cancelled) return;
        setSong(loaded);
        setStage({ name: "ready" });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BootError || err instanceof LoadError) {
          setStage({ name: "blocked", message: err.message, remedy: err.remedy });
        } else {
          setStage({
            name: "blocked",
            message: err instanceof Error ? err.message : "Something went wrong.",
            remedy: "Check the browser console for the underlying error.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.sceneId, params.trackId]);

  const files = useMemo(() => (song ? playableFiles(song) : []), [song]);

  /** Start the audio engine and pull the song's stems in. One gesture. */
  const open = useCallback(async () => {
    if (!bootResult || !song) return;
    setStage({ name: "loading", progress: null });
    try {
      const started = await startAudio(bootResult);
      if (!started.wasm) {
        throw new BootError(
          "The audio engine didn't start.",
          started.reason ?? "No reason was reported. Check the console.",
        );
      }
      const created = await createSession(bootResult);
      setSession(created);

      const result = await loadSongIntoProject(
        created.project,
        created.sampleService,
        song,
        files,
        (progress) => setStage({ name: "loading", progress }),
      );
      setLanes(result);
      setStage({ name: "loaded" });
    } catch (err) {
      setStage({
        name: "blocked",
        message: err instanceof Error ? err.message : "The song didn't load.",
        remedy: err instanceof BootError || err instanceof LoadError ? err.remedy : "",
      });
    }
  }, [bootResult, song, files]);

  const engine = session?.project.engine ?? null;
  const isPlaying = useObservable(engine?.isPlaying ?? null, false);
  const seconds = useAnimationValue(
    () =>
      session
        ? session.project.tempoMap.intervalToSeconds(0, session.project.engine.position.getValue())
        : 0,
    Boolean(session),
    0,
  );

  return (
    <main style={S.page}>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>{song?.name ?? "Run Sheet — DAW"}</h1>
          <p style={S.sub}>
            {song
              ? [song.sceneName, song.bpm ? `${song.bpm} BPM` : null, song.key]
                  .filter(Boolean)
                  .join(" · ")
              : "Loading…"}
          </p>
        </div>
      </header>

      {stage.name === "booting" && <p style={S.note}>Starting…</p>}

      {stage.name === "blocked" && (
        <section style={S.panelBad}>
          <p style={S.badTitle}>{stage.message}</p>
          {stage.remedy && <p style={S.note}>{stage.remedy}</p>}
          {signedIn === false && (
            <p style={S.note}>
              You don't appear to be signed in on this address.{" "}
              <a href="https://raggedcompanyrecordings.com/runsheet/" style={S.a}>
                Sign in to Run Sheet
              </a>{" "}
              and press DAW again.
            </p>
          )}
        </section>
      )}

      {stage.name === "ready" && song && (
        <section style={S.panel}>
          {files.length === 0 ? (
            <>
              <p style={S.badTitle}>Nothing to play.</p>
              <p style={S.note}>
                This song has no stems or mixes in Idea Drop yet — only links, MIDI or notes.
              </p>
            </>
          ) : (
            <>
              <p style={S.note}>
                {files.length} {files.length === 1 ? "file" : "files"} ready:{" "}
                {files.map((f) => f.name).join(", ")}
              </p>
              <button style={S.button} onClick={() => void open()}>
                Open in the DAW
              </button>
            </>
          )}
        </section>
      )}

      {stage.name === "loading" && (
        <section style={S.panel}>
          <p style={S.note}>
            {stage.progress
              ? `Loading ${stage.progress.index} of ${stage.progress.total} — ${stage.progress.name}`
              : "Starting the engine…"}
          </p>
          <p style={S.noteFaint}>
            Audio is decoded in this browser. Nothing is uploaded.
          </p>
        </section>
      )}

      {stage.name === "loaded" && session && (
        <>
          <section style={S.transport}>
            <button
              style={S.button}
              onClick={() => (isPlaying ? session.project.engine.stop() : session.project.engine.play())}
            >
              {isPlaying ? "Stop" : "Play"}
            </button>
            <button
              style={S.buttonQuiet}
              onClick={() => session.project.engine.setPosition(0)}
            >
              Back to start
            </button>
            <span style={S.clock}>{formatTime(seconds)}</span>
            {song?.bpm && tempoOf(song.bpm) && <span style={S.noteFaint}>{tempoOf(song.bpm)} BPM</span>}
          </section>

          <section style={S.panel}>
            <h2 style={S.h2}>Lanes</h2>
            {lanes.map((lane) => (
              <div key={lane.fileId} style={S.lane}>
                <span style={S.laneName}>{lane.name}</span>
                <span style={S.noteFaint}>{formatTime(lane.seconds)}</span>
              </div>
            ))}
          </section>
        </>
      )}

      {/*
        AGPL §13: anyone using this over a network is entitled to its source.
        A LICENSE file in the repo doesn't discharge that — the running app has
        to offer it, which is what this link is.
      */}
      <footer style={S.footer}>
        Run Sheet DAW is free software under the{" "}
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" style={S.a}>
          GNU AGPL v3
        </a>
        .{" "}
        <a href="https://github.com/raggedrec/runsheet-daw" style={S.a}>
          Source code
        </a>
        . Built on{" "}
        <a href="https://opendaw.org" style={S.a}>
          openDAW
        </a>
        .
      </footer>
    </main>
  );
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
