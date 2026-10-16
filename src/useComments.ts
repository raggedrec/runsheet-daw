/**
 * Timeline comments for a song, kept in sync across whoever's in it.
 *
 * The rows live in Supabase (the shared `feedback` table); this fetches them and
 * exposes add/remove. After a write it pings a Realtime broadcast channel so the
 * others refetch — a tiny nudge, not the data itself, which keeps us off the
 * postgres-changes publication (nothing to enable on the project).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { listComments, addComment, deleteComment, type Comment } from "./runsheet";

export function useComments(trackId: string | null, sceneId: string | null, author: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const refetch = useCallback(async () => {
    if (!trackId) {
      setComments([]);
      return;
    }
    try {
      setComments(await listComments(trackId));
    } catch (err) {
      console.error("comments fetch failed", err);
    }
  }, [trackId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!trackId) return;
    // Private: admitted only to scene members by realtime.messages RLS (0018).
    void supabase.realtime.setAuth();
    const channel = supabase.channel(`song-comments:${trackId}`, { config: { private: true } });
    channel.on("broadcast", { event: "changed" }, () => void refetch());
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [trackId, refetch]);

  const ping = () => channelRef.current?.send({ type: "broadcast", event: "changed", payload: {} });

  const add = useCallback(
    async (atSeconds: number, text: string) => {
      const body = text.trim();
      if (!trackId || !sceneId || body.length === 0) return;
      await addComment({ trackId, sceneId, atSeconds, text: body, author });
      await refetch();
      ping();
    },
    [trackId, sceneId, author, refetch],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteComment(id);
      await refetch();
      ping();
    },
    [refetch],
  );

  return { comments, add, remove };
}
