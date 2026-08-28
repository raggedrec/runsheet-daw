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
import { useObservable } from "./useObservable";
import { S } from "./styles";
import { Timeline } from "./Timeline";
import { Transport } from "./Transport";
import { useLook } from "./useLook";
import { accents, skins } from "./theme";
import { RecordPanel } from "./RecordPanel";
import { useTransportClock } from "./useTransportClock";
import {
  addRecordTrack, armTrack, listInputs, RecordingError,
  startRecording as beginRecording, stopRecording as endRecording,
  type InputDevice, type RecordTrack,
} from "./opendaw/recording";

type Stage =
  | { name: "booting" }
  | { name: "blocked"; message: string; remedy: string }
  | { name: "ready" }
  | { name: "loading"; progress: LoadProgress | null }
  | { name: "loaded" };

/** Stable identity, so passing "nothing is muted" doesn't repaint every frame. */
const NO_LANES: ReadonlySet<string> = new Set<string>();

export default function DawApp() {
  const [stage, setStage] = useState<Stage>({ name: "booting" });
  const [bootResult, setBootResult] = useState<BootResult | null>(null);
  const [session, setSession] = useState<DawSession | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [lanes, setLanes] = useState<LoadedLane[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const params = useMemo(() => requestedSong(), []);
  const [look, setLook] = useLook();

  // --- recording ----------------------------------------------------------
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [recordTrack, setRecordTrack] = useState<RecordTrack | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<{ message: string; remedy: string } | null>(null);
  const skin = skins[look.skin];
  const accent = accents[look.accent];

  /*
   * The page background follows the skin. Set on <body> rather than a wrapper
   * because the timeline can be taller than the viewport, and a wrapper would
   * leave the page's own background showing past the end of it.
   */
  useEffect(() => {
    document.body.style.background = skin.bg;
    document.body.style.color = skin.fg;
    document.body.style.margin = "0";
  }, [skin]);

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

  /*
   * The song is as long as its longest stem. Taking the first lane's length
   * would cut the timeline short whenever a stem starts late or runs on.
   */
  const duration = useMemo(
    () => lanes.reduce((max, l) => Math.max(max, l.seconds), 0),
    [lanes],
  );

  const engine = session?.project.engine ?? null;

  /*
   * Two sources of truth about whether the transport is rolling, deliberately.
   *
   * `engine.isPlaying` is the engine's own answer and the one to trust — but
   * the position it publishes alongside it does not advance in this build, so
   * the clock can't be driven from it. `rolling` is what this app knows it
   * asked for. The clock follows `rolling`; the button follows the engine when
   * the engine is talking and falls back to `rolling` when it isn't.
   */
  const [rolling, setRolling] = useState(false);
  const enginePlaying = useObservable(engine?.isPlaying ?? null, false);
  const isPlaying = enginePlaying || rolling;
  const clock = useTransportClock(session?.audioContext ?? null, rolling, duration);
  const seconds = clock.seconds;

  const playStop = useCallback(() => {
    if (!session) return;
    if (rolling) {
      session.project.engine.stop();
      clock.stop(clock.seconds);
      setRolling(false);
    } else {
      session.project.engine.play();
      clock.start(clock.seconds);
      setRolling(true);
    }
  }, [session, rolling, clock]);

  const rewind = useCallback(() => {
    if (!session) return;
    session.project.engine.setPosition(0);
    clock.seek(0);
  }, [session, clock]);

  const scrub = useCallback(
    (to: number) => {
      if (!session) return;
      // The engine positions in musical time, so a scrub in seconds goes back
      // through the tempo map rather than being scaled.
      session.project.engine.setPosition(session.project.tempoMap.secondsToPPQN(to));
      clock.seek(to);
    },
    [session, clock],
  );

  /** Add a track, ask for the microphone, arm it. One button, three steps. */
  const addTrack = useCallback(
    async (name: string) => {
      if (!session) return;
      setBusy(true);
      setRecError(null);
      try {
        const available = devices.length > 0 ? devices : await listInputs();
        setDevices(available);
        const chosen = deviceId ?? available[0]?.deviceId ?? null;
        setDeviceId(chosen);

        const track = addRecordTrack(session.project, name);
        armTrack(session.project, track.capture, chosen);
        setRecordTrack(track);
      } catch (err) {
        setRecError(
          err instanceof RecordingError
            ? { message: err.message, remedy: err.remedy }
            : { message: "The track couldn't be added.", remedy: String(err) },
        );
      } finally {
        setBusy(false);
      }
    },
    [session, devices, deviceId],
  );

  const chooseDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      if (session && recordTrack) armTrack(session.project, recordTrack.capture, id);
    },
    [session, recordTrack],
  );

  const record = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setRecError(null);
    try {
      await beginRecording(session.project, countIn);
      clock.start(clock.seconds);
      setRolling(true);
      setIsRecording(true);
    } catch (err) {
      setRecError(
        err instanceof RecordingError
          ? { message: err.message, remedy: err.remedy }
          : { message: "Recording didn't start.", remedy: String(err) },
      );
    } finally {
      setBusy(false);
    }
  }, [session, countIn, clock]);

  const stopRecord = useCallback(() => {
    if (!session) return;
    endRecording(session.project);
    session.project.engine.stop();
    clock.stop(clock.seconds);
    setRolling(false);
    setIsRecording(false);
  }, [session, clock]);

  return (
    <main style={{ ...S.page, color: skin.fg, maxWidth: 1180 }}>
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
          <Transport
            skin={skin}
            accent={accent.solid}
            accentFg={accent.fg}
            isPlaying={isPlaying}
            position={seconds}
            duration={duration}
            bpm={song?.bpm ? tempoOf(song.bpm) : null}
            look={look}
            onLook={setLook}
            onPlayStop={playStop}
            onRewind={rewind}
          />

          <RecordPanel
            skin={skin}
            accent={accent.solid}
            accentFg={accent.fg}
            armedTrackName={recordTrack?.name ?? null}
            devices={devices}
            deviceId={deviceId}
            isRecording={isRecording}
            countIn={countIn}
            busy={busy}
            error={recError}
            onAddTrack={(name) => void addTrack(name)}
            onChooseDevice={chooseDevice}
            onCountIn={setCountIn}
            onRecord={() => void record()}
            onStop={stopRecord}
          />

          <Timeline
            lanes={lanes}
            skin={skin}
            accent={accent.solid}
            laneHeight={look.laneHeight}
            position={seconds}
            duration={duration}
            bpm={song?.bpm ? tempoOf(song.bpm) : null}
            muted={NO_LANES}
            soloed={NO_LANES}
            onScrub={scrub}
          />
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
