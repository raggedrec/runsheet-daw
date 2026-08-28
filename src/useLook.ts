/**
 * The user's look choices, remembered between visits.
 *
 * localStorage rather than the session cookie: this is a per-browser
 * preference, not account data, and putting it in the cookie would send it to
 * Supabase on every request for no reason.
 *
 * Everything read back is passed through sanitizeLook, because a value written
 * by an older build — or edited by hand — must not be able to produce an
 * unusable screen.
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOOK, sanitizeLook, type Look } from "./theme";

const KEY = "runsheet-daw-look";

export function useLook(): [Look, (patch: Partial<Look>) => void] {
  const [look, setLook] = useState<Look>(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? sanitizeLook(JSON.parse(raw)) : DEFAULT_LOOK;
    } catch {
      // Private browsing, or corrupt JSON. Neither is worth failing over.
      return DEFAULT_LOOK;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(look));
    } catch {
      /* see above */
    }
  }, [look]);

  const update = useCallback((patch: Partial<Look>) => {
    setLook((current) => sanitizeLook({ ...current, ...patch }));
  }, []);

  return [look, update];
}
