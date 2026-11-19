const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

/**
 * Extract an 11-character video id from a supported YouTube URL (or a bare id).
 * Supported: youtube.com/watch?v=, youtu.be/, /embed/, /shorts/, /live/, /v/.
 * Returns { videoId, startSeconds } or null when unsupported.
 */
export function parseYouTube(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  if (ID_RE.test(raw)) return { videoId: raw, startSeconds: 0 };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  let id = null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (host.endsWith('youtu.be')) {
    id = parts[0] || null;
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
    id = parts[1] || null;
  }
  if (!id || !ID_RE.test(id)) return null;

  return { videoId: id, startSeconds: parseStart(url.searchParams.get('t') || url.searchParams.get('start')) };
}

function parseStart(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}
