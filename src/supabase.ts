/**
 * The same Supabase project Run Sheet uses, reached with the anon key.
 *
 * The anon key is public by design and safe in a public repository — row level
 * security is what protects the data, not the key. The service role key must
 * never appear in this app: it bypasses RLS entirely.
 *
 * Sessions are kept in a cookie rather than localStorage. localStorage is
 * per-origin, so an artist arriving from runsheet at daw.<domain> would be
 * signed out; a cookie scoped to the parent domain is readable by both. Run
 * Sheet needs the same storage adapter for this to work in both directions.
 */
import { createClient, type SupportedStorage } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const cookieDomain = import.meta.env.VITE_SESSION_COOKIE_DOMAIN as string | undefined;

export const isConfigured = Boolean(url && anonKey);

/**
 * Session storage backed by a cookie on the parent domain.
 *
 * Deliberately not HttpOnly — the Supabase client is JavaScript and has to
 * read it. That is the same exposure localStorage already has, so nothing is
 * lost; SameSite=Lax is what keeps it off other sites. Secure is omitted on
 * localhost only, because localhost has no TLS in dev.
 */
function cookieStorage(domain: string): SupportedStorage {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const attrs = `; Domain=${domain}; Path=/; SameSite=Lax${secure}`;

  return {
    getItem(key) {
      const match = document.cookie.match(
        new RegExp("(?:^|; )" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"),
      );
      return match ? decodeURIComponent(match[1]) : null;
    },
    setItem(key, value) {
      // A year: Supabase refreshes the token inside this and rewrites the
      // cookie, so the expiry only matters for a browser left closed.
      document.cookie = `${key}=${encodeURIComponent(value)}${attrs}; Max-Age=31536000`;
    },
    removeItem(key) {
      document.cookie = `${key}=${attrs}; Max-Age=0`;
    },
  };
}

export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder",
  cookieDomain
    ? { auth: { storage: cookieStorage(cookieDomain), storageKey: "runsheet-auth" } }
    : // No domain set means local dev: fall back to the default localStorage
      // rather than writing a cookie that can't be shared anyway.
      undefined,
);

/** Which song to open, from the URL Run Sheet linked to. */
export function requestedSong(): { sceneId: string | null; trackId: string | null } {
  const params = new URLSearchParams(location.search);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const scene = params.get("scene");
  const track = params.get("track");
  // Anything that isn't a UUID is treated as absent rather than passed to the
  // database — RLS would reject it, but a clean null gives a better message.
  return {
    sceneId: scene && uuid.test(scene) ? scene : null,
    trackId: track && uuid.test(track) ? track : null,
  };
}
