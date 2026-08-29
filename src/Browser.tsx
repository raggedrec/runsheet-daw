/**
 * What's in this song's Idea Drop.
 *
 * The mockup called this "Project Files" with folders. There are no folders —
 * Run Sheet stores files against a song with a role, so this groups by role.
 * Inventing a folder tree to match a picture would mean inventing folders, and
 * then keeping two ideas of where a file lives in agreement forever.
 *
 * It shows everything, including what the DAW can't play: MIDI, links, notes.
 * "This song has a MIDI file I forgot about" is worth knowing, and a list that
 * silently omits things teaches you not to trust it.
 */
import { Download, Trash2 } from "lucide-react";
import { font, laneColorFor, radius, size, space, type Skin } from "./theme";
import { laneName } from "./naming";
import type { Song, SongFile } from "./runsheet";

export interface BrowserProps {
  song: Song;
  skin: Skin;
  /** fileIds currently open as lanes, so the list can say which are loaded. */
  loaded: ReadonlySet<string>;
  onDownload: (file: SongFile) => void;
  onDelete: (file: SongFile) => void;
}

/** Role order: what you'd reach for first, first. */
const ROLE_ORDER = ["stem", "mix", "midi", "other"] as const;
const ROLE_LABELS: Record<string, string> = {
  stem: "Stems",
  mix: "Mixes",
  midi: "MIDI",
  other: "Other",
};

export function Browser({ song, skin, loaded, onDownload, onDelete }: BrowserProps) {
  const groups = new Map<string, SongFile[]>();
  for (const file of song.files) {
    const role = ROLE_LABELS[file.role] ? file.role : "other";
    const list = groups.get(role) ?? [];
    list.push(file);
    groups.set(role, list);
  }

  const ordered = [...groups.entries()].sort(
    (a, b) => roleRank(a[0]) - roleRank(b[0]),
  );

  return (
    <section
      style={{
        background: skin.surface,
        border: `1px solid ${skin.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "baseline", gap: space[2],
          padding: `${space[3]}px ${space[4]}px`,
          borderBottom: `1px solid ${skin.border}`,
        }}
      >
        <h2
          style={{
            font: `600 ${size.xs}px ${font.body}`,
            letterSpacing: ".08em", textTransform: "uppercase",
            color: skin.fgSubtle, margin: 0,
          }}
        >
          Idea Drop
        </h2>
        <span style={{ font: `${size.sm}px ${font.body}`, color: skin.fgMuted }}>
          {song.files.length} {song.files.length === 1 ? "file" : "files"}
        </span>
      </header>

      <div style={{ padding: space[3], maxHeight: 280, overflowY: "auto" }}>
        {song.files.length === 0 && (
          <p style={{ font: `${size.sm}px ${font.body}`, color: skin.fgSubtle, margin: 0 }}>
            Nothing here yet. Add audio in Run Sheet.
          </p>
        )}

        {ordered.map(([role, files]) => (
          <div key={role} style={{ marginBottom: space[3] }}>
            <h3
              style={{
                font: `600 ${size.xs}px ${font.body}`,
                letterSpacing: ".08em", textTransform: "uppercase",
                color: skin.fgSubtle, margin: `0 0 ${space[2]}px`,
              }}
            >
              {ROLE_LABELS[role] ?? role} · {files.length}
            </h3>

            {files.map((file) => {
              const isLoaded = loaded.has(file.id);
              return (
                <div
                  key={file.id}
                  title={file.name}
                  style={{
                    display: "flex", alignItems: "center", gap: space[2],
                    padding: "4px 0",
                    font: `${size.sm}px ${font.body}`,
                    color: isLoaded ? skin.fg : skin.fgMuted,
                  }}
                >
                  <span
                    style={{
                      width: 3, height: 14, borderRadius: 2, flex: "0 0 auto",
                      background: laneColorFor(laneName(file.name)),
                      // Dimmed when it isn't open as a lane, so "what am I
                      // hearing" and "what exists" are visibly different.
                      opacity: isLoaded ? 1 : 0.35,
                    }}
                  />
                  <span
                    style={{
                      flex: 1, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </span>
                  {isLoaded && (
                    <span
                      style={{
                        font: `600 ${size.xs}px ${font.body}`,
                        letterSpacing: ".06em", textTransform: "uppercase",
                        color: skin.fgSubtle, flex: "0 0 auto",
                      }}
                    >
                      Open
                    </span>
                  )}
                  <button
                    onClick={() => onDownload(file)}
                    title={`Download ${file.name}`}
                    aria-label={`Download ${file.name}`}
                    style={iconBtn(skin)}
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={() => onDelete(file)}
                    title={`Delete ${file.name}`}
                    aria-label={`Delete ${file.name}`}
                    style={iconBtn(skin)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function roleRank(role: string): number {
  const i = (ROLE_ORDER as readonly string[]).indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

function iconBtn(skin: Skin): React.CSSProperties {
  return {
    width: 22, height: 22, flex: "0 0 auto",
    display: "grid", placeItems: "center",
    background: "transparent", color: skin.fgSubtle,
    border: `1px solid ${skin.border}`, borderRadius: radius.sm,
    cursor: "pointer", padding: 0,
  };
}
