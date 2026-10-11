// A small in-memory "N attempts per window per key" limiter (task 6.0), for login + sign-up.
// One server process, so memory is enough (Phase 8 with several servers would move it to the DB).
// Fixed windows: the first attempt starts a window; after `limit` attempts in it → refused until
// it ends. Old windows are swept on use, so the map can't grow without bound.
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();
  return {
    // → null when allowed, else the seconds to wait
    hit(key: string): number | null {
      const t = now();
      if (t - lastSweep > windowMs) {
        for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
        lastSweep = t;
      }
      const w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        windows.set(key, { start: t, count: 1 });
        return null;
      }
      if (w.count >= limit) return Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
      w.count++;
      return null;
    },
    size: () => windows.size,
  };
}
