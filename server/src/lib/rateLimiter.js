/**
 * Small in-memory sliding-window limiter used for socket events.
 * (HTTP routes use express-rate-limit.) For multi-instance deployments,
 * replace with a shared store such as Redis.
 */
export function createLimiter({ limit, windowMs }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }, windowMs * 2);
  timer.unref?.();

  return {
    /** Returns true when allowed, false when over the limit. */
    take(key) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const list = (hits.get(key) || []).filter((t) => t > cutoff);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
  };
}
