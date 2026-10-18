/**
 * The user's look choices, remembered between visits.
 *
 * localStorage rather than the session cookie: this is a per-browser
 * preference, not account data, and putting it in the cookie would send it to
 * Supabase on every request for no reason.
 *
 * Everything read back is passed through sanitizeLook, because a value written
 * by an older build — or edited by hand — must not be able to produce an
 * unusable screen. On top of that, migrateLook runs once per browser (keyed by
 * REV_KEY) to move a look saved before the current refresh onto the new
 * default; see theme.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOOK, LOOK_REV, migrateLook, sanitizeLook, type Look } from "./theme";

const KEY = "runsheet-daw-look";
const REV_KEY = "runsheet-daw-look-rev";

export function useLook(): [Look, (patch: Partial<Look>) => void] {
  const [look, setLook] = useState<Look>(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      const stored = raw ? sanitizeLook(JSON.parse(raw)) : DEFAULT_LOOK;
      const rev = Number(window.localStorage.getItem(REV_KEY) ?? 0);
      return migrateLook(stored, Number.isFinite(rev) ? rev : 0);
    } catch {
      // Private browsing, or corrupt JSON. Neither is worth failing over.
      return DEFAULT_LOOK;
    }
  });

  // Record the migration once, so it can't re-fire on a later visit. If this
  // write fails (private browsing), the migration simply runs again next time,
  // which is harmless — it only ever rewrites to the same default.
  useEffect(() => {
    try {
      window.localStorage.setItem(REV_KEY, String(LOOK_REV));
    } catch {
      /* see above */
    }
  }, []);

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
