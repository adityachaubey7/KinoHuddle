import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Button } from '../../components/ui.jsx';
import { clock } from '../../lib/format.js';
import { loadYouTubeApi, PLAYER_ERRORS } from '../../lib/youtube.js';

const TOLERANCE = 1.0; // seconds of drift we accept before correcting
const YTS = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * YouTube player that follows the room's authoritative playback state.
 * Native YouTube controls are hidden so every play/pause/seek goes through the room.
 */
const SyncPlayer = forwardRef(function SyncPlayer(
  { playback, canControl, serverNow, onControl, onResync, onEnded, onDuration, onUnavailable, onProgress, emptySlot, children },
  ref
) {
  const hostEl = useRef(null);
  const stageEl = useRef(null);
  const player = useRef(null);
  const ready = useRef(false);
  const target = useRef(playback);
  const loadedId = useRef(null);
  const stuckSince = useRef(null);

  const [apiError, setApiError] = useState(null);
  const [videoError, setVideoError] = useState(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [sync, setSync] = useState('idle'); // idle | synced | correcting | buffering
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(null); // seconds while dragging
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  const expected = useCallback(() => {
    const t = target.current;
    if (!t) return 0;
    if (!t.isPlaying) return t.position;
    return t.position + ((serverNow() - t.serverTime) / 1000) * (t.rate || 1);
  }, [serverNow]);

  /** Bring the local player in line with the target state. */
  const apply = useCallback(() => {
    const p = player.current;
    const t = target.current;
    if (!ready.current || !p || !t?.videoId) return;
    const want = Math.max(0, expected());

    if (loadedId.current !== t.videoId) {
      loadedId.current = t.videoId;
      reportedDuration.current = null;
      setVideoError(null);
      setDuration(0);
      if (t.isPlaying) p.loadVideoById({ videoId: t.videoId, startSeconds: want });
      else p.cueVideoById({ videoId: t.videoId, startSeconds: want });
      return;
    }
    if (p.getPlaybackRate?.() !== t.rate) p.setPlaybackRate?.(t.rate || 1);

    const cur = p.getCurrentTime?.() ?? 0;
    const state = p.getPlayerState?.();
    if (t.isPlaying) {
      if (Math.abs(cur - want) > TOLERANCE) p.seekTo(want, true);
      if (state !== YTS.PLAYING && state !== YTS.BUFFERING) p.playVideo();
    } else {
      if (state === YTS.PLAYING || state === YTS.BUFFERING) p.pauseVideo();
      if (Math.abs(cur - want) > 0.35) p.seekTo(want, true);
    }
  }, [expected]);

  useImperativeHandle(ref, () => ({
    receive(state) {
      target.current = state;
      apply();
    },
    currentTime: () => player.current?.getCurrentTime?.() ?? 0,
  }), [apply]);

  useEffect(() => {
    target.current = playback;
  }, [playback]);

  // Create the player once the API is available and there is something to play.
  const hasVideo = Boolean(playback?.videoId);
  useEffect(() => {
    if (!hasVideo || player.current) return;
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostEl.current) return;
        const mount = document.createElement('div');
        hostEl.current.appendChild(mount);
        player.current = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              ready.current = true;
              e.target.setVolume(volume);
              apply();
            },
            onStateChange: (e) => {
              if (e.data === YTS.PLAYING) {
                setNeedsGesture(false);
                stuckSince.current = null;
                setDuration(e.target.getDuration?.() || 0);
              }
              if (e.data === YTS.CUED) setDuration(e.target.getDuration?.() || 0);
              if (e.data === YTS.PLAYING || e.data === YTS.CUED) {
                // Tell the room how long this video is, so everyone's "it ended" report can be checked against the server clock.
                const id = target.current?.videoId;
                const d = e.target.getDuration?.() || 0;
                if (id && d > 0 && canControlRef.current && reportedDuration.current !== id) {
                  reportedDuration.current = id;
                  handlersRef.current.onDuration?.(id, d);
                }
              }
              if (e.data === YTS.ENDED && target.current?.videoId) {
                // Every viewer reports the end; the server advances the queue exactly once.
                handlersRef.current.onEnded?.(target.current.videoId);
              }
            },
            onError: (e) => {
              setVideoError(PLAYER_ERRORS[e.data] || 'This video can’t be played here.');
              if ([2, 100, 101, 150].includes(e.data) && target.current?.videoId) handlersRef.current.onUnavailable?.(target.current.videoId);
            },
            onAutoplayBlocked: () => setNeedsGesture(true),
          },
        });
      })
      .catch((err) => !cancelled && setApiError(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVideo]);

  useEffect(() => () => {
    try {
      player.current?.destroy?.();
    } catch {
      /* already gone */
    }
    player.current = null;
    ready.current = false;
  }, []);

  const reportedDuration = useRef(null);
  const handlersRef = useRef({});
  handlersRef.current = { onEnded, onDuration, onUnavailable, onProgress };
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;
  const onControlRef = useRef(onControl);
  onControlRef.current = onControl;

  // Drift detection + correction, and UI clock.
  useEffect(() => {
    const tick = setInterval(() => {
      const p = player.current;
      if (!ready.current || !p?.getCurrentTime) return;
      const t = target.current;
      const cur = p.getCurrentTime();
      setTime(cur);
      const d = p.getDuration?.();
      if (d) setDuration(d);
      if (!t?.videoId || videoError) return setSync('idle');
      const state = p.getPlayerState();

      if (state === YTS.BUFFERING) {
        setSync('buffering');
        return;
      }
      if (t.isPlaying) {
        if (state !== YTS.PLAYING) {
          // Autoplay may be blocked until the viewer interacts with the page.
          stuckSince.current ??= Date.now();
          if (Date.now() - stuckSince.current > 2500) setNeedsGesture(true);
          p.playVideo();
          return;
        }
        const drift = cur - expected();
        if (Math.abs(drift) > TOLERANCE) {
          setSync('correcting');
          p.seekTo(expected(), true);
        } else setSync('synced');
      } else {
        stuckSince.current = null;
        if (state === YTS.PLAYING) p.pauseVideo();
        setSync('synced');
      }
    }, 500);
    return () => clearInterval(tick);
  }, [expected, videoError]);

  // Personal watch progress, saved every 15 s while the video is actually playing.
  useEffect(() => {
    const t = setInterval(() => {
      const p = player.current;
      const id = target.current?.videoId;
      if (!ready.current || !p?.getCurrentTime || !id || p.getPlayerState?.() !== YTS.PLAYING) return;
      const d = p.getDuration?.() || 0;
      if (d > 0) handlersRef.current.onProgress?.(id, p.getCurrentTime(), d);
    }, 15000);
    return () => clearInterval(t);
  }, []);

  const run = async (action, payload) => {
    if (!canControl || busy) return;
    setBusy(true);
    await onControl(action, payload);
    setBusy(false);
  };

  const togglePlay = () => {
    const pos = player.current?.getCurrentTime?.() ?? expected();
    run(playback.isPlaying ? 'pause' : 'play', { position: Math.max(0, pos) });
  };
  const seekTo = (s) => run('seek', { position: Math.max(0, Math.min(s, duration || s)) });
  const skip = (delta) => seekTo((player.current?.getCurrentTime?.() ?? expected()) + delta);

  const joinPlayback = () => {
    setNeedsGesture(false);
    stuckSince.current = null;
    player.current?.playVideo?.();
    apply();
  };

  const toggleFullscreen = () => {
    const el = stageEl.current;
    if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };

  const setVol = (v) => {
    setVolume(v);
    player.current?.setVolume?.(v);
    if (v > 0 && muted) {
      setMuted(false);
      player.current?.unMute?.();
    }
  };
  const toggleMute = () => {
    if (muted) player.current?.unMute?.();
    else player.current?.mute?.();
    setMuted(!muted);
  };

  // Keyboard shortcuts (outside of text fields).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable || e.metaKey || e.ctrlKey) return;
      if (e.key === 'k' || (e.key === ' ' && tag !== 'BUTTON')) {
        if (!playback?.videoId) return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f') toggleFullscreen();
      else if (e.key === 'm') toggleMute();
      else if (e.key === 'ArrowRight' && canControl) skip(10);
      else if (e.key === 'ArrowLeft' && canControl) skip(-10);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = scrub ?? time;
  const pct = duration ? `${Math.min(100, (shown / duration) * 100)}%` : '0%';
  const lockedTip = canControl ? undefined : 'Only the host controls playback in this room';
  const syncChip = {
    synced: <span className="chip chip-sync"><span className="dot" /> In sync</span>,
    correcting: <span className="chip chip-warn"><Icon name="sync" size={13} /> Catching up</span>,
    buffering: <span className="chip chip-warn"><span className="spinner" style={{ width: 11, height: 11, borderWidth: 2 }} /> Buffering</span>,
    idle: null,
  }[sync];

  return (
    <div>
      <div className="stage" ref={stageEl}>
        <div className="stage-player" ref={hostEl} />
        {hasVideo && !videoError && !apiError && (
          <div
            className={`stage-shield ${canControl ? '' : 'locked'}`}
            onClick={canControl ? togglePlay : undefined}
            onDoubleClick={toggleFullscreen}
            aria-hidden="true"
          />
        )}
        {children}
        {!hasVideo && <div className="stage-overlay">{emptySlot}</div>}
        {hasVideo && apiError && (
          <div className="stage-overlay">
            <div className="inner">
              <h2>The YouTube player didn’t load</h2>
              <p>{apiError}. Check that youtube.com isn’t blocked by an extension or network filter, then reload.</p>
              <Button onClick={() => window.location.reload()}>Reload page</Button>
            </div>
          </div>
        )}
        {hasVideo && videoError && (
          <div className="stage-overlay">
            <div className="inner">
              <h2>Can’t play this video</h2>
              <p>{videoError}</p>
              {canControl ? <p className="faint">Use “Change video” below to pick something else.</p> : <p className="faint">The host can pick another video.</p>}
            </div>
          </div>
        )}
        {hasVideo && needsGesture && !videoError && (
          <div className="stage-overlay">
            <div className="inner">
              <h2>The room is already playing</h2>
              <p>Your browser needs a click before it plays sound.</p>
              <Button variant="primary" size="lg" icon="play" onClick={joinPlayback}>Join playback</Button>
            </div>
          </div>
        )}
      </div>

      {hasVideo && (
        <div className="controls" role="group" aria-label="Playback controls">
          <button
            className="ctrl ctrl-main"
            onClick={togglePlay}
            disabled={!canControl || busy || Boolean(videoError)}
            title={lockedTip}
            aria-label={playback.isPlaying ? 'Pause for everyone' : 'Play for everyone'}
          >
            <Icon name={playback.isPlaying ? 'pause' : 'play'} size={20} />
          </button>
          <span className="time">
            {clock(shown)} / {duration ? clock(duration) : '–:––'}
          </span>
          <div className="timeline">
            <label className="sr-only" htmlFor="seek">Seek</label>
            <input
              id="seek"
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={1}
              value={Math.floor(shown)}
              disabled={!canControl || !duration}
              title={lockedTip}
              style={{ '--pct': pct }}
              aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={(e) => {
                seekTo(Number(e.currentTarget.value));
                setScrub(null);
              }}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                  seekTo(Number(e.currentTarget.value));
                  setScrub(null);
                }
              }}
            />
          </div>
          <div className="right-ctrls">
            {syncChip && <span style={{ marginRight: 6 }} aria-live="polite">{syncChip}</span>}
            {canControl ? (
              <>
                <label className="sr-only" htmlFor="rate">Playback speed</label>
                <select
                  id="rate"
                  className="select"
                  style={{ height: 34, width: 'auto', paddingLeft: 10, fontSize: 'var(--t-sm)', minWidth: 0 }}
                  value={playback.rate || 1}
                  onChange={(e) => run('rate', { rate: Number(e.target.value) })}
                >
                  {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
                </select>
              </>
            ) : (
              <button className="ctrl" onClick={onResync} title="Jump back to the room’s position" aria-label="Resync with the room">
                <Icon name="sync" size={19} />
              </button>
            )}
            <button className="ctrl" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title="Your volume only">
              <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={20} />
            </button>
            <label className="sr-only" htmlFor="vol">Volume</label>
            <input
              id="vol"
              className="volume"
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              style={{ '--pct': `${muted ? 0 : volume}%` }}
              onChange={(e) => setVol(Number(e.target.value))}
            />
            <button className="ctrl" onClick={toggleFullscreen} aria-label="Full screen">
              <Icon name="fullscreen" size={19} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default SyncPlayer;
