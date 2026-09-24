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
 * ~4KB is the per-cookie limit; 3500 leaves room for the name, domain and
 * flags. This MUST match Run Sheet's value — the two apps share one cookie, so
 * they have to agree on where a session gets split.
 */
const MAX_COOKIE_VALUE = 3500;

function readCookieRaw(key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
  return match ? match[1] : null;
}

/** Decoding never throws out of here: a mangled cookie is worth a trip through
 *  the login screen, not an exception the client turns into a hard failure. */
function decode(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Join the raw parts BEFORE decoding. setItem splits the percent-encoded text at
 * a fixed length, so the boundary often lands mid-escape (%XX); decoding each
 * part alone throws URIError. Concatenating first makes it one clean decode.
 */
function readChunks(key: string): string | null {
  let raw = "";
  for (let i = 0; ; i += 1) {
    const part = readCookieRaw(`${key}.${i}`);
    if (part === null) break;
    raw += part;
  }
  return raw === "" ? null : decode(raw);
}

/** Chunks win over the single cookie — a chunked write deletes the base one. */
function readChunked(key: string): string | null {
  return readChunks(key) ?? decode(readCookieRaw(key));
}

/**
 * Drop Google's provider tokens before storing, exactly as Run Sheet does, so
 * both apps write the same bytes and a password session stays on the single-
 * cookie path rather than the chunked one.
 */
function withoutProviderTokens(value: string): string {
  if (!value.includes("provider_token") && !value.includes("provider_refresh_token")) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
    const session = parsed as Record<string, unknown>;
    if (!("provider_token" in session) && !("provider_refresh_token" in session)) return value;
    delete session.provider_token;
    delete session.provider_refresh_token;
    return JSON.stringify(session);
  } catch {
    return value; // not JSON, so not a session — store as-is
  }
}

/**
 * Session storage backed by a cookie on the parent domain.
 *
 * Deliberately not HttpOnly — the Supabase client is JavaScript and has to
 * read it. Same exposure localStorage already has; SameSite=Lax keeps it off
 * other sites, and Secure is omitted only on localhost (no TLS in dev).
 *
 * Chunk-aware, and it has to be: Run Sheet splits a session bigger than one
 * cookie across `key.0`, `key.1`, … and DELETES the base cookie. Reading only
 * the single cookie — as this did before — returns null for any chunked
 * session, which the Supabase client reads as "signed out". That's exactly what
 * made the DAW open anonymous and every RLS'd query ("tracks" via
 * is_scene_member) come back permission-denied. So this mirrors Run Sheet's
 * format byte for byte: chunks first, single cookie second.
 */
function cookieStorage(domain: string): SupportedStorage {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const attrs = `; Domain=${domain}; Path=/; SameSite=Lax${secure}`;

  const clearChunks = (key: string) => {
    for (let i = 0; readCookieRaw(`${key}.${i}`) !== null; i += 1) {
      document.cookie = `${key}.${i}=${attrs}; Max-Age=0`;
    }
  };

  return {
    getItem(key) {
      return readChunked(key);
    },
    setItem(key, value) {
      // A year: Supabase refreshes the token well inside that and rewrites the
      // cookie each time, so the expiry only matters to a browser left closed.
      const encoded = encodeURIComponent(withoutProviderTokens(value));
      // Clear the other representation first, so a session that grows or shrinks
      // can't leave a stale half that reads back as garbage.
      clearChunks(key);
      if (encoded.length <= MAX_COOKIE_VALUE) {
        document.cookie = `${key}=${encoded}${attrs}; Max-Age=31536000`;
        return;
      }
      document.cookie = `${key}=${attrs}; Max-Age=0`;
      for (let i = 0, at = 0; at < encoded.length; i += 1, at += MAX_COOKIE_VALUE) {
        const part = encoded.slice(at, at + MAX_COOKIE_VALUE);
        document.cookie = `${key}.${i}=${part}${attrs}; Max-Age=31536000`;
      }
    },
    removeItem(key) {
      document.cookie = `${key}=${attrs}; Max-Age=0`;
      clearChunks(key);
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
