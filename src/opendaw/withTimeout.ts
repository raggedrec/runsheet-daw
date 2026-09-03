/**
 * Timeouts for the load path, so a stall fails loudly instead of hanging.
 *
 * Every await in the loader used to wait forever. A stuck engine, a stalled
 * fetch, or a tab left in the background all looked identical from outside: the
 * loader sat on "Loading…" with nothing to read. These give each wait a ceiling
 * and a message, which is the difference between "it hangs" and "it says why".
 */

/**
 * Rejects if `promise` hasn't settled within a budget of *visible* time.
 *
 * The budget only counts down while the tab is on screen. This is deliberate:
 * the engine's readiness is reported through openDAW's AnimationFrame pump,
 * which reads the worklet's SharedArrayBuffer — and requestAnimationFrame is
 * paused by the browser whenever the tab is hidden. So a song loaded while you
 * glance at another tab isn't stuck, it's waiting for a pump that can't run; it
 * should resume when you come back, not fail. A genuine stall — the tab in front
 * and the engine still not ready — trips the budget and throws.
 */
export function withVisibleTimeout<T>(promise: Promise<T>, budgetMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let remaining = budgetMs;
    let last = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      // Only spend the budget while the page is actually visible.
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        remaining -= now - last;
      }
      last = now;
      if (remaining <= 0 && !settled) {
        settled = true;
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 500);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        reject(err);
      },
    );
  });
}

/**
 * Fetch with an abort timeout — network waits don't pause when hidden, so this
 * is a plain wall-clock ceiling. Names the resource so a stuck stem is obvious.
 */
export async function fetchWithTimeout(url: string, label: string, ms = 60000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Timed out fetching ${label} after ${Math.round(ms / 1000)}s — the network stalled.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
