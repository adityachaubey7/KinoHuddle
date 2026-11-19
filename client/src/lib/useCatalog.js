import { useEffect, useState } from 'react';
import { api } from './api.js';

let cache = null;

/** Full catalog, fetched once per page load. Filtering happens client-side for instant results. */
export function useCatalog() {
  const [state, setState] = useState(cache ? { status: 'ready', ...cache } : { status: 'loading', items: [], genres: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (cache) return;
    let live = true;
    api
      .get('/catalog')
      .then((d) => {
        cache = { items: d.items, genres: d.genres };
        if (live) setState({ status: 'ready', ...cache });
      })
      .catch((e) => live && setState({ status: 'error', error: e.message, items: [], genres: [] }));
    return () => {
      live = false;
    };
  }, [attempt]);
  return { ...state, retry: () => { setState((s) => ({ ...s, status: 'loading' })); setAttempt((a) => a + 1); } };
}
