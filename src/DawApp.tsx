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
import {
  loadSongIntoProject,
  tempoOf,
  type LoadedLane,
  type LoadProgress,
} from "./opendaw/loadSong";
import { loadSong, playableFiles, LoadError, type Song, type SongFile } from "./runsheet";
import { isConfigured, requestedSong, supabase } from "./supabase";
import { S } from "./styles";
import { Timeline } from "./Timeline";
import { TransportBar } from "./TransportBar";
import { useLook } from "./useLook";
import { accents, skins, font, size, space } from "./theme";
import { StartScreen } from "./StartScreen";
import { Mixer, audibility } from "./Mixer";
import { TrackList, TRACK_COLUMN } from "./TrackList";
import { StatusBar } from "./StatusBar";
import { Browser } from "./Browser";
import { ChordsPanel } from "./ChordsPanel";
import { MarkerStrip } from "./MarkerStrip";
import {
  listMarkers, subscribeMarkers, addMarker, moveMarker, renameMarker, deleteMarker, hueFor,
  type MarkerInfo,
} from "./opendaw/markers";
import { useConsoleLog } from "./useConsoleLog";
import { collectTakes } from "./opendaw/take";
import { saveSession } from "./session";
import { uploadToIdeaDrop, downloadUrl, deleteIdeaDropFile } from "./runsheet";
import { Dialog } from "./Dialog";
import { useTransport } from "./useTransport";
import {
  addRecordTrack, armTrack, captureFor, disarmAll, listInputs, RecordingError,
  startRecording as beginRecording, stopRecording as endRecording,
  type InputDevice, type RecordTrack,
} from "./opendaw/recording";

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
  const [look, setLook] = useLook();

  // --- recording ----------------------------------------------------------
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [recordTrack, setRecordTrack] = useState<RecordTrack | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<{ message: string; remedy: string } | null>(null);
  /** Takes recorded this visit that haven't reached Idea Drop yet. */
  const [unsaved, setUnsaved] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /*
   * Bumped after any mixer change. The mix lives in openDAW's boxes, not in
   * React state — this is only the nudge that tells React to re-read them, so
   * there's never a second copy to disagree with the graph.
   */
  const [mixRevision, setMixRevision] = useState(0);
  /** fileId of the lane whose R button is lit. */
  const [armedLane, setArmedLane] = useState<string | null>(null);
  /*
   * openDAW reports failures through the console and nothing else — a
   * recording that never started and a take with no signal look identical
   * from outside. Captured from the first render so nothing is missed.
   */
  const logs = useConsoleLog(true);
  const [showLog, setShowLog] = useState(false);
  /** The track whose effects chain is on screen. */
  const [selected, setSelected] = useState<LoadedLane | null>(null);
  /** Section markers (Verse, Chorus…), read from the project's marker track. */
  const [markers, setMarkers] = useState<MarkerInfo[]>([]);
  /** Horizontal zoom: 1 = whole song across the width. */
  const [zoom, setZoom] = useState(1);
  const [scroll, setScroll] = useState(0);

  /*
   * The log opens itself the first time something goes wrong, and stays shut
   * otherwise. A diagnostic panel permanently expanded is noise; one that
   * appears exactly when there is something to read is a colleague.
   */
  const problems = logs.filter((l) => l.level === "error" || l.level === "warn").length;
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (problems > 0 && !autoOpened) {
      setShowLog(true);
      setAutoOpened(true);
    }
  }, [problems, autoOpened]);
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
      /*
       * Always a fresh load from the stems, for now.
       *
       * Reopening a saved session (loadSessionProject / lanesFromProject, still
       * in the opendaw layer) is shelved: cross-session the samples aren't in
       * this browser's store, so it never actually reopened — it loaded the graph
       * only to fall back to a fresh load anyway — and that extra
       * load-then-terminate on the shared AudioContext made the loader hang
       * intermittently. It comes back when the missing-samples re-import is built
       * and it can be verified end to end. Saving still works; loading a saved
       * mix does not yet.
       */
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

  /* eslint-disable-next-line react-hooks/exhaustive-deps -- mixRevision is the trigger */
  const audible = useMemo(() => audibility(lanes), [lanes, mixRevision]);


  const bump = useCallback(() => setMixRevision((n) => n + 1), []);

  /**
   * Rename a track.
   *
   * Two places have to agree: openDAW's own label, so a saved session comes
   * back with the right name, and the lane, which is what every panel reads.
   * Writing only one of them is how a mixer strip ends up disagreeing with the
   * track list above it.
   */
  const renameLane = useCallback(
    (lane: LoadedLane, name: string) => {
      if (!session) return;
      session.project.editing.modify(() => {
        const label = (lane.unit as unknown as { label?: { setValue: (v: string) => void } }).label;
        label?.setValue(name);
      });
      setLanes((current) => current.map((l) => (l === lane ? { ...l, name } : l)));
      setSelected((current) => (current === lane ? { ...current, name } : current));
      bump();
    },
    [session, bump],
  );

  const toggleMute = useCallback(
    (lane: LoadedLane) => {
      if (!session) return;
      session.project.editing.modify(() => lane.unit.mute.setValue(!lane.unit.mute.getValue()));
      bump();
    },
    [session, bump],
  );

  const toggleSolo = useCallback(
    (lane: LoadedLane) => {
      if (!session) return;
      session.project.editing.modify(() => lane.unit.solo.setValue(!lane.unit.solo.getValue()));
      bump();
    },
    [session, bump],
  );

  /**
   * Arm a track for recording, exclusively.
   *
   * Arming is a property of a track, which is why the button lives on the
   * track. The input DEVICE is still chosen once in the transport, because one
   * interface is the normal case and asking per track would be four dropdowns
   * saying the same thing.
   */
  const toggleArm = useCallback(
    (lane: LoadedLane) => {
      if (!session) return;
      if (armedLane === lane.fileId) {
        disarmAll(session.project);
        setArmedLane(null);
        setRecordTrack(null);
        return;
      }
      const capture = captureFor(session.project, lane.unit);
      if (capture === null) {
        setRecError({
          message: "That track has no input.",
          remedy: "It was created without a capture device, so it can't record.",
        });
        return;
      }
      armTrack(session.project, capture, deviceId);
      setArmedLane(lane.fileId);
      setRecordTrack({ name: lane.name, capture });
    },
    [session, armedLane, deviceId],
  );

  /*
   * One owner for the transport. See useTransport.
   *
   * Everything shown — playing, recording, counting in, position — is the
   * engine's own answer. This app no longer keeps a parallel idea of whether
   * the song is moving, which is what let a clock tick convincingly over a
   * stopped engine and hide a broken record path for most of a day.
   */
  const transport = useTransport(session?.project ?? null, session?.audioContext ?? null);
  const seconds = transport.position;

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

        /*
         * The lane appears NOW, empty, not after the first take. Adding a track
         * puts a row in the timeline and a strip in the mixer straight away, and
         * arms it — so you can see what you're about to record onto, the way a
         * DAW works. Its waveform fills in when the take finalises (stopRecord
         * matches this lane by its audio unit and drops the peaks in). peaks is
         * null until then, which the timeline draws as an empty row.
         */
        const laneId = `rec:${crypto.randomUUID()}`;
        setLanes((current) => [
          ...current,
          { name: track.name, fileId: laneId, seconds: 0, peaks: null, unit: track.capture.audioUnitBox },
        ]);
        setArmedLane(laneId);
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

      /*
       * Report what the engine actually did, a beat later. The log showed
       * "[RecordAudio] start" while nothing rolled, and there was no way to
       * see that from the outside — the on-screen clock is driven from the
       * AudioContext, so it counts up whether or not the transport moves.
       */
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
  }, [session, countIn]);

  const stopRecord = useCallback(async () => {
    if (!session || !recordTrack || !song) return;
    /*
     * The UI leaves the recording state immediately, before any waiting.
     * Previously this flag was cleared only after the take had been collected
     * and uploaded, so if openDAW never finalised, the button stayed on "Stop"
     * and pressing it again did nothing — the app looked frozen mid-take.
     * Whether openDAW stops is openDAW's problem; whether the button works is
     * ours.
     */
    setIsRecording(false);
    // Waits for openDAW to finalise the take. It does that asynchronously,
    // from a subscriber on isRecording — reading the regions before that has
    // happened is what produced "Nothing was recorded" on good takes.
    await endRecording(session.project, recordTrack.capture);
    session.project.engine.stop();
    setIsRecording(false);

    /*
     * The take is already in the engine — it's a region on the track that was
     * armed. What's missing is that `lanes` was built once at load time, so
     * nothing tells the canvas to draw it.
     *
     * Reading it back locally rather than round-tripping through Idea Drop:
     * the peaks were computed during recording and the audio is in memory.
     * Uploading and re-downloading to see what we already have would cost a
     * WAV upload and a download to display bytes we're holding.
     */
    try {
      const takes = await collectTakes(recordTrack.capture, recordTrack.name);
      if (takes.length === 0) {
        setRecError({
          message: "Nothing was recorded.",
          remedy: "The input produced no audio. Check the device is passing signal.",
        });
        return;
      }

      /*
       * Fill the empty record lane in place rather than appending a new one.
       * addTrack already put a row in the timeline for this take's audio unit;
       * the first take drops its waveform into that row. Extra takes (a punch-in
       * producing more than one region) append as their own lanes on the same
       * unit — rare, but a performance we shouldn't silently drop.
       */
      const unit = recordTrack.capture.audioUnitBox;
      const [first, ...rest] = takes;
      setLanes((current) => {
        let filled = false;
        const updated = current.map((l) => {
          if (!filled && l.unit === unit) {
            filled = true;
            return { ...l, name: first.name, seconds: first.seconds, peaks: first.peaks };
          }
          return l;
        });
        // No empty row to fill (e.g. recorded onto an existing lane): append.
        const head = filled
          ? updated
          : [...updated, { name: first.name, fileId: `take:${crypto.randomUUID()}`, seconds: first.seconds, peaks: first.peaks, unit }];
        const extras = rest.map((t) => ({
          name: t.name,
          fileId: `take:${crypto.randomUUID()}`,
          seconds: t.seconds,
          peaks: t.peaks,
          unit,
        }));
        return [...head, ...extras];
      });
      setUnsaved((n) => n + takes.length);

      // Upload after the lane appears, not before: the take is visible and
      // playable while it uploads, and a failed upload doesn't hide it.
      for (const take of takes) {
        await uploadToIdeaDrop(song, new File([take.wav], `${take.name}.wav`), "stem");
        setUnsaved((n) => Math.max(0, n - 1));
      }
    } catch (err) {
      setRecError({
        message: "The take didn't reach Idea Drop.",
        remedy:
          err instanceof Error
            ? `${err.message} The recording is still here — don't close the tab.`
            : "The recording is still here — don't close the tab.",
      });
    }
  }, [session, recordTrack, song, transport]);

  /**
   * One stop for the whole transport.
   *
   * A take in progress ends through stopRecord — which finalises it and draws
   * its lane — and anything else is plain playback, which just halts. Routing
   * both through one button is what keeps "end the recording" a single, reliable
   * click rather than a toggle that sometimes started a second take instead.
   */
  const stopAll = useCallback(() => {
    if (isRecording || transport.isRecording || transport.isCountingIn) {
      void stopRecord();
    } else {
      transport.stop();
    }
  }, [isRecording, transport, stopRecord]);

  /*
   * Markers. The project's marker track is the source of truth; this mirrors it
   * into state and re-reads whenever it changes (including undo). Each handler
   * writes through the opendaw layer, then the subscription pulls the new list.
   */
  const refreshMarkers = useCallback(() => {
    if (session) setMarkers(listMarkers(session.project));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refreshMarkers();
    const sub = subscribeMarkers(session.project, refreshMarkers);
    return () => sub.terminate();
  }, [session, refreshMarkers]);

  const onAddMarker = useCallback(
    (seconds: number, label: string, hue: number) => {
      if (!session) return;
      addMarker(session.project, seconds, label, hue);
      refreshMarkers();
    },
    [session, refreshMarkers],
  );
  const onMoveMarker = useCallback(
    (box: Parameters<typeof moveMarker>[1], seconds: number) => {
      if (!session) return;
      moveMarker(session.project, box, seconds);
      refreshMarkers();
    },
    [session, refreshMarkers],
  );
  const onRenameMarker = useCallback(
    (box: Parameters<typeof renameMarker>[1], label: string) => {
      if (!session) return;
      renameMarker(session.project, box, label);
      refreshMarkers();
    },
    [session, refreshMarkers],
  );
  const onDeleteMarker = useCallback(
    (box: Parameters<typeof deleteMarker>[1]) => {
      if (!session) return;
      deleteMarker(session.project, box);
      refreshMarkers();
    },
    [session, refreshMarkers],
  );

  /*
   * Keyboard shortcuts, DAW-standard where there is a standard.
   *
   *   space      play / stop (stops a take too)
   *   R          record (again to stop)
   *   M          drop a marker at the playhead (unsnapped)
   *   [ ]        zoom out / in
   *   ; '        shorter / taller lanes
   *   1–9        select that track
   *
   * Ignored while typing in a field, so renaming a track or a marker types
   * letters rather than firing transport. No modifier combos — those belong to
   * the browser.
   */
  useEffect(() => {
    if (stage.name !== "loaded") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const active = transport.isPlaying || transport.isRecording || transport.isCountingIn || isRecording;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (active) stopAll();
          else transport.play();
          return;
        case "r": case "R":
          e.preventDefault();
          if (transport.isRecording || transport.isCountingIn || isRecording) void stopRecord();
          else void record();
          return;
        case "m": case "M":
          // Drop a marker at the live playhead, unsnapped — catch the moment as
          // it plays, tidy it to a bar by dragging later.
          e.preventDefault();
          onAddMarker(transport.position, "Section", hueFor("Section"));
          return;
        case "]":
          e.preventDefault();
          setZoom((z) => Math.min(64, z * 2));
          return;
        case "[":
          e.preventDefault();
          setZoom((z) => { const n = Math.max(1, z / 2); if (n === 1) setScroll(0); return n; });
          return;
        case "'":
          e.preventDefault();
          setLook({ laneHeight: look.laneHeight + 12 }); // sanitizeLook clamps
          return;
        case ";":
          e.preventDefault();
          setLook({ laneHeight: look.laneHeight - 12 });
          return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        if (idx < lanes.length) {
          e.preventDefault();
          setSelected(lanes[idx]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage.name, transport, isRecording, record, stopRecord, stopAll, onAddMarker, lanes, look, setLook]);

  /*
   * Track and file management: remove a lane, download a take, delete a file.
   *
   * The two that lose something — removing a lane, deleting a file — go through
   * the dialog rather than acting on one click. Removing a lane offers to also
   * delete the underlying file when the lane maps to one; deleting from Idea
   * Drop is always its own explicit, confirmed action. Download just saves.
   */
  const [pending, setPending] = useState<
    | { kind: "remove-lane"; lane: LoadedLane; file: SongFile | null }
    | { kind: "delete-file"; file: SongFile }
    | null
  >(null);

  /** Removes a lane from the arrangement — the track, its regions, its strip. */
  const removeLaneFromArrangement = useCallback(
    (lane: LoadedLane) => {
      if (!session) return;
      session.project.editing.modify(() => session.project.api.deleteAudioUnit(lane.unit));
      setLanes((current) => current.filter((l) => l.fileId !== lane.fileId));
      if (armedLane === lane.fileId) setArmedLane(null);
      setSelected((current) => (current?.fileId === lane.fileId ? null : current));
      if (recordTrack && recordTrack.capture.audioUnitBox === lane.unit) setRecordTrack(null);
      bump();
    },
    [session, armedLane, recordTrack, bump],
  );

  /** Saves a take/file to disk. The signed URL carries an attachment header, so
      following it downloads rather than navigating this tab away. */
  const downloadFile = useCallback(async (file: SongFile) => {
    try {
      const url = await downloadUrl(file.storagePath, file.name);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setRecError({
        message: "Couldn't download the file.",
        remedy: err instanceof Error ? err.message : "Try again.",
      });
    }
  }, []);

  /** Deletes a file from Idea Drop for good, then drops it from the list. */
  const deleteFile = useCallback(async (file: SongFile) => {
    try {
      await deleteIdeaDropFile(file);
      setSong((s) => (s ? { ...s, files: s.files.filter((f) => f.id !== file.id) } : s));
    } catch (err) {
      setRecError({
        message: "Couldn't delete the file.",
        remedy: err instanceof Error ? err.message : "Try again.",
      });
    }
  }, []);

  /** Saves the whole session: tracks, faders, pans, effects, arrangement. */
  const save = useCallback(async () => {
    if (!session || !song) return;
    setSaveState("saving");
    try {
      await saveSession(song, session.project.toArrayBuffer());
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }, [session, song]);

  /*
   * A take that hasn't uploaded exists only in this tab. The browser only
   * allows a generic warning — the wording is the browser's, not ours — but a
   * generic warning beats losing a performance to a stray Cmd-W.
   */
  useEffect(() => {
    if (unsaved === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return (
    <main
      style={
        stage.name === "loaded"
          ? {
              /*
               * A session fills the window. Everything a DAW needs at once —
               * tracks, timeline, browser, mixer, effects — has to be visible
               * without scrolling, or the answer to "why can't I hear the
               * vocal" is three scroll positions away.
               */
              color: skin.fg,
              height: "100vh",
              display: "flex",
              flexDirection: "column",
              padding: 12,
              gap: 10,
              boxSizing: "border-box",
              overflow: "hidden",
              font: `13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
            }
          : { ...S.page, color: skin.fg, maxWidth: 1180 }
      }
    >
      {stage.name !== "loaded" && <header style={S.header}>
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
      </header>}

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
        <StartScreen
          skin={skin}
          accent={accent.solid}
          accentFg={accent.fg}
          song={song}
          files={files}
          onOpen={() => void open()}
        />
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
          <TransportBar
            skin={skin}
            accent={accent.solid}
            accentFg={accent.fg}
            position={seconds}
            duration={duration}
            bpm={song?.bpm ? tempoOf(song.bpm) : null}
            songKey={song?.key ?? null}
            isPlaying={transport.isPlaying}
            isRecording={transport.isRecording || isRecording}
            isCountingIn={transport.isCountingIn}
            armedTrackName={recordTrack?.name ?? null}
            countIn={countIn}
            busy={busy}
            look={look}
            onLook={setLook}
            zoom={zoom}
            onZoom={(z) => { setZoom(z); if (z === 1) setScroll(0); }}
            onPlay={transport.play}
            onStop={stopAll}
            onRewind={transport.rewind}
            onRecord={() => void record()}
            onCountIn={setCountIn}
            saveState={saveState}
            onSave={() => void save()}
          />

          {/* The add-track form used to live here as a wide dead-space panel.
              Adding a track now happens in the track list (+ Add track) and the
              input is chosen in the mixer, so all that's left to surface here is
              a recording error when one happens. */}
          {recError && (
            <p
              style={{
                font: `${size.sm}px ${font.body}`,
                color: "#C0453B",
                margin: `0 0 ${space[4]}px`,
              }}
            >
              <strong>{recError.message}</strong> {recError.remedy}
            </p>
          )}

          {/*
            Row: tracks + timeline take the space, the browser is a fixed
            column beside them. Fixed because a file list that grows and
            shrinks with the window moves the thing you were about to click.
          */}
          <div style={{ display: "flex", gap: 10, flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
                background: skin.surface,
                border: `1px solid ${skin.border}`,
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {/* Marker lane, fixed above the scroll. The left spacer is the
                  width of the track column, so the strip aligns over the timeline
                  (gutter 0) rather than the track controls. */}
              <div style={{ display: "flex", flex: "0 0 auto" }}>
                <div style={{ width: TRACK_COLUMN, flex: "0 0 auto" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MarkerStrip
                    markers={markers}
                    duration={duration}
                    zoom={zoom}
                    scroll={scroll}
                    playheadSeconds={seconds}
                    bpm={song?.bpm ? tempoOf(song.bpm) : null}
                    skin={skin}
                    onAdd={onAddMarker}
                    onMove={onMoveMarker}
                    onRename={onRenameMarker}
                    onDelete={onDeleteMarker}
                  />
                </div>
              </div>

              {/* Tracks and timeline scroll together — one set of rows. */}
              <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "auto" }}>
                <TrackList
                lanes={lanes}
                skin={skin}
                accent={accent.solid}
                laneHeight={look.laneHeight}
                muted={audible.muted}
                soloed={audible.soloed}
                armed={armedLane}
                onMute={toggleMute}
                onSolo={toggleSolo}
                onArm={toggleArm}
                onSelect={setSelected}
                onRename={renameLane}
                onRemove={(lane) =>
                  setPending({
                    kind: "remove-lane",
                    lane,
                    file: song?.files.find((f) => f.id === lane.fileId) ?? null,
                  })
                }
                onAddTrack={() => void addTrack("Take")}
                addBusy={busy || isRecording}
                selected={selected?.fileId ?? null}
              />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Timeline
                    lanes={lanes}
                    skin={skin}
                    accent={accent.solid}
                    laneHeight={look.laneHeight}
                    position={seconds}
                    duration={duration}
                    bpm={song?.bpm ? tempoOf(song.bpm) : null}
                    muted={audible.muted}
                    soloed={audible.soloed}
                    onScrub={transport.seek}
                    gutter={0}
                    zoom={zoom}
                    scroll={scroll}
                    onScroll={setScroll}
                  />
                </div>
              </div>
            </div>

            {song && (
              <div
                style={{
                  width: 250, flex: "0 0 auto", minHeight: 0,
                  display: "flex", flexDirection: "column", gap: 10,
                }}
              >
                <div style={{ flex: "0 0 auto" }}>
                  <Browser
                    song={song}
                    skin={skin}
                    loaded={new Set(lanes.map((l) => l.fileId))}
                    onDownload={(file) => void downloadFile(file)}
                    onDelete={(file) => setPending({ kind: "delete-file", file })}
                  />
                </div>
                {/* Below Idea Drop, filling the column the old form left empty. */}
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ChordsPanel skin={skin} text={song.lyricsChords} />
                </div>
              </div>
            )}
          </div>

          {/* The mixer takes the whole row now. A track's effects live inside
              it — click a track name to open its device panel (chain + params) —
              so there's no separate rack column floating over the lyrics. */}
          <div style={{ display: "flex", flex: "0 0 auto", minHeight: 0, overflow: "auto" }}>
            <Mixer
              project={session.project}
              lanes={lanes}
              skin={skin}
              accent={accent.solid}
              revision={mixRevision}
              onChanged={bump}
              inputDevices={devices}
              deviceId={deviceId}
              onChooseDevice={chooseDevice}
            />
          </div>

          <StatusBar
            skin={skin}
            project={session.project}
            audioContext={session.audioContext}
            position={seconds}
          />

          {/* The engine log lives at the very bottom now — it's a diagnostic you
              open when something's wrong, not something that earns space up top.
              Collapsed by default; the problem count still shows when collapsed. */}
          {logs.length > 0 && (
            <section
              style={{
                background: skin.surface,
                border: `1px solid ${skin.border}`,
                borderRadius: 6,
                flex: "0 0 auto",
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setShowLog((v) => !v)}
                style={{
                  width: "100%", textAlign: "left", cursor: "pointer",
                  background: "transparent", border: "none", padding: "8px 16px",
                  font: "600 11px ui-sans-serif, system-ui", letterSpacing: ".08em",
                  textTransform: "uppercase", color: skin.fgSubtle,
                }}
              >
                {showLog ? "▾" : "▸"} Engine log · {logs.length}
                {logs.some((l) => l.level === "error" || l.level === "warn") && (
                  <span style={{ color: "#C0453B" }}>
                    {" "}· {logs.filter((l) => l.level === "error" || l.level === "warn").length} problem
                    {logs.filter((l) => l.level === "error" || l.level === "warn").length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
              {showLog && (
                <div
                  style={{
                    maxHeight: 200, overflowY: "auto",
                    borderTop: `1px solid ${skin.border}`,
                    padding: "8px 16px 12px",
                    font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {logs.map((line) => (
                    <div
                      key={line.id}
                      style={{
                        color:
                          line.level === "error" || line.level === "warn"
                            ? "#C0453B"
                            : skin.fgMuted,
                        padding: "2px 0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {pending && (
            <Dialog
              skin={skin}
              onCancel={() => setPending(null)}
              title={
                pending.kind === "remove-lane"
                  ? `Remove “${pending.lane.name}”?`
                  : `Delete “${pending.file.name}”?`
              }
              message={
                pending.kind === "remove-lane"
                  ? pending.file
                    ? "Remove it from the arrangement, or also delete its file from Idea Drop? Deleting the file is permanent."
                    : "This removes the track from the arrangement. Any take you recorded stays in Idea Drop."
                  : "This permanently deletes the file from Idea Drop. There is no undo."
              }
              actions={
                pending.kind === "remove-lane"
                  ? [
                      {
                        label: "Remove from arrangement",
                        variant: "primary",
                        onClick: () => {
                          removeLaneFromArrangement(pending.lane);
                          setPending(null);
                        },
                      },
                      ...(pending.file
                        ? [
                            {
                              label: "Remove and delete file",
                              variant: "danger" as const,
                              onClick: () => {
                                const file = pending.file;
                                removeLaneFromArrangement(pending.lane);
                                if (file) void deleteFile(file);
                                setPending(null);
                              },
                            },
                          ]
                        : []),
                    ]
                  : [
                      {
                        label: "Delete permanently",
                        variant: "danger",
                        onClick: () => {
                          void deleteFile(pending.file);
                          setPending(null);
                        },
                      },
                    ]
              }
            />
          )}
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
