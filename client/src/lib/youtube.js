const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com'];

/** Mirrors the server parser so we can give instant feedback. The server re-validates. */
export function parseYouTube(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return raw;
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.includes(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (host.endsWith('youtu.be')) id = parts[0];
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
  return id && ID_RE.test(id) ? id : null;
}

export const thumb = (id, quality = 'maxresdefault') => `https://i.ytimg.com/vi/${id}/${quality}.jpg`;

let apiPromise = null;
/** Load the official YouTube IFrame Player API once. */
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('YouTube player failed to load'));
    };
    document.head.appendChild(s);
    setTimeout(() => {
      if (!window.YT?.Player) {
        apiPromise = null;
        reject(new Error('YouTube player took too long to load'));
      }
    }, 15000);
  });
  return apiPromise;
}

export const PLAYER_ERRORS = {
  2: 'This video link isn’t valid.',
  5: 'This video can’t play in the browser’s HTML5 player.',
  100: 'This video was removed or is private.',
  101: 'The owner doesn’t allow this video to be played on other sites.',
  150: 'The owner doesn’t allow this video to be played on other sites.',
  153: 'YouTube blocked playback for this embed. Try another video.',
};
