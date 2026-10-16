/**
 * Who else is in this song, and where their playhead is — live.
 *
 * One Supabase Realtime channel per song. Presence carries the roster (who's
 * here, their name and colour); a throttled broadcast carries the fast-moving
 * cursor (playhead position, playing, recording) so it doesn't thrash presence.
 * Nothing is persisted — this is awareness, not state; when you leave, you're
 * gone. The engine and the box graph stay the single source of truth for the
 * mix; this only ever draws ghosts on top.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export interface Peer {
  id: string;
  name: string;
  color: string;
  /** Seconds. Their playhead. */
  position: number;
  playing: boolean;
  recording: boolean;
}

export interface Me {
  id: string;
  name: string;
  color: string;
}

/** A stable, legible colour from a user id — same person, same colour, always. */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 72% 62%)`;
}

export function usePresence(
  songId: string | null,
  me: Me | null,
  live: { position: number; playing: boolean; recording: boolean },
): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  // The latest local state, read by the broadcast interval without re-subscribing.
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    if (!songId || !me) return;

    // Private: a realtime.messages RLS policy admits only members of the track's
    // scene (migration 0018). setAuth hands the socket the user's token so that
    // check can run.
    void supabase.realtime.setAuth();
    const channel = supabase.channel(`song-presence:${songId}`, {
      config: { private: true, presence: { key: me.id }, broadcast: { self: false } },
    });
    let subscribed = false;

    // Roster from presence. Keep each peer's last-known cursor across a re-sync so
    // a join/leave elsewhere doesn't snap everyone's playhead back to zero.
    const rebuild = () => {
      const state = channel.presenceState() as Record<string, Array<{ name?: string; color?: string }>>;
      setPeers((prev) =>
        Object.keys(state)
          .filter((key) => key !== me.id)
          .map((key) => {
            const meta = state[key][0] ?? {};
            const old = prev.find((p) => p.id === key);
            return {
              id: key,
              name: meta.name ?? "Someone",
              color: meta.color ?? colorForId(key),
              position: old?.position ?? 0,
              playing: old?.playing ?? false,
              recording: old?.recording ?? false,
            };
          }),
      );
    };

    channel.on("presence", { event: "sync" }, rebuild);
    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      const c = payload as { id: string; position: number; playing: boolean; recording: boolean };
      setPeers((prev) => prev.map((p) => (p.id === c.id ? { ...p, position: c.position, playing: c.playing, recording: c.recording } : p)));
    });

    // Broadcast my cursor, but only when it's worth sending: while it's moving,
    // when play/record flips, or once every few seconds so a late joiner catches
    // up. Idle sessions go quiet.
    let last = { position: -1e9, playing: false, recording: false, at: 0 };
    const interval = setInterval(() => {
      if (!subscribed) return;
      const l = liveRef.current;
      const now = Date.now();
      const moved = Math.abs(l.position - last.position) > 0.08;
      const flipped = l.playing !== last.playing || l.recording !== last.recording;
      if (!moved && !flipped && now - last.at < 3000) return;
      channel.send({ type: "broadcast", event: "cursor", payload: { id: me.id, ...l } });
      last = { position: l.position, playing: l.playing, recording: l.recording, at: now };
    }, 200);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        subscribed = true;
        void channel.track({ name: me.name, color: me.color });
      }
    });

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
      setPeers([]);
    };
  }, [songId, me?.id, me?.name, me?.color]);

  return peers;
}
