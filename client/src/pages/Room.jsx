import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button, ButtonLink, Modal, PageLoading, State } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { newClientId } from '../lib/socket.js';
import { RoomProblem } from './JoinRoom.jsx';
import Chat from './room/Chat.jsx';
import People from './room/People.jsx';
import Queue from './room/Queue.jsx';
import ReportModal from './room/ReportModal.jsx';
import ModerationPanel from './room/ModerationPanel.jsx';
import SyncPlayer from './room/SyncPlayer.jsx';
import VideoPicker, { LinkForm } from './room/VideoPicker.jsx';
import { useRoom } from './room/useRoom.js';

function InviteModal({ code, onClose }) {
  const link = `${window.location.origin}/join/${code}`;
  const [copied, setCopied] = useState(null);
  const copy = async (what, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('failed');
    }
  };
  return (
    <Modal title="Invite people" onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="muted" style={{ marginBottom: 'var(--s4)' }}>Anyone with this link or code can join after signing in, until the room is full or locked.</p>
      <div className="code-display" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--s4)' }}>
        <label htmlFor="invite-link" className="sr-only">Invite link</label>
        <input id="invite-link" className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button icon={copied === 'link' ? 'check' : 'copy'} onClick={() => copy('link', link)}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
        <Button variant="quiet" size="sm" icon={copied === 'code' ? 'check' : 'copy'} onClick={() => copy('code', code)}>
          {copied === 'code' ? 'Code copied' : 'Copy code only'}
        </Button>
        {navigator.share && (
          <Button variant="quiet" size="sm" icon="link" onClick={() => navigator.share({ title: 'Join my SyncSpace room', url: link }).catch(() => {})}>
            Share…
          </Button>
        )}
      </div>
      {copied === 'failed' && <p className="field-error" style={{ marginTop: 8 }}>Your browser blocked copying. Select the link and copy it manually.</p>}
    </Modal>
  );
}

function Floaters({ items }) {
  return (
    <div className="floaters" aria-hidden="true">
      {items.map((f) => (
        <div key={f.key} className="floater" style={{ left: `${f.left}%` }}>
          <span>{f.emoji}</span>
          <small>{f.name}</small>
        </div>
      ))}
    </div>
  );
}

export default function Room() {
  const { code: rawCode } = useParams();
  const code = (rawCode || '').toUpperCase();
  const { user } = useAuth();
  const { toast, error: toastError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const playerRef = useRef(null);
  const [tab, setTab] = useState('chat');
  const [invite, setInvite] = useState(Boolean(location.state?.justCreated));
  const [picker, setPicker] = useState(false);
  const [floaters, setFloaters] = useState([]);
  const [report, setReport] = useState(null); // { target, message? }
  const [moderation, setModeration] = useState(false);
  const showReactions = user.preferences?.showReactions !== false;

  const onReaction = useCallback(
    (r) => {
      if (!showReactions) return;
      const key = r.id;
      setFloaters((f) => [...f.slice(-14), { key, emoji: r.emoji, name: r.user?.id === user.id ? 'You' : r.user?.displayName, left: 8 + Math.random() * 80 }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.key !== key)), 3300);
    },
    [showReactions, user.id]
  );
  const onPlayerState = useCallback((state) => playerRef.current?.receive(state), []);

  const R = useRoom(code, { onPlayerState, onReaction });
  const { room, status } = R;

  // Clear the "just created" flag so a refresh doesn't reopen the invite dialog.
  useEffect(() => {
    if (location.state?.justCreated) navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  if (status === 'connecting') return <PageLoading label="Connecting to room" />;
  if (status === 'closed') return <RoomProblem code="ROOM_CLOSED" />;
  if (status === 'expired') return <RoomProblem code="ROOM_EXPIRED" />;
  if (status === 'removed') return <RoomProblem code="REMOVED" />;
  if (status === 'error') {
    if (R.error?.code === 'NOT_A_MEMBER') {
      return (
        <State icon="lock" title="You’re not in this room yet" actions={<ButtonLink to={`/join/${code}`} variant="primary">Join this room</ButtonLink>}>
          Join it first, then you’ll see what’s playing and the chat.
        </State>
      );
    }
    if (R.error?.code === 'UNAUTHENTICATED') {
      return <State icon="lock" title="Your session ended" actions={<ButtonLink to="/signin" state={{ from: location.pathname }} variant="primary">Sign in again</ButtonLink>}>Sign in to get back to the room.</State>;
    }
    return <RoomProblem code={R.error?.code} message={R.error?.message} />;
  }

  const me = room.members.find((m) => m.id === user.id) || { id: user.id };
  const isHost = room.hostId === user.id;
  const canControl = isHost || room.guestControl;
  const canModerate = isHost || me.role === 'moderator';
  const iAmMuted = Boolean(me.muted);
  const offline = R.connection !== 'online';

  const loadVideo = async (url, title) => {
    const res = await R.control('load', { url, title });
    if (!res?.ok && res?.error?.code !== 'INVALID_VIDEO_URL') toastError(res?.error?.message || 'Couldn’t change the video.');
    return res;
  };

  const control = async (action, payload) => {
    const res = await R.control(action, payload);
    if (!res?.ok) toastError(res?.error?.message || 'Playback update failed.');
    return res;
  };

  const restCall = async (fn, success) => {
    try {
      const d = await fn();
      if (success) toast(success);
      return d;
    } catch (e) {
      toastError(e.message);
      throw e;
    }
  };

  const loadOlder = async () => {
    const first = R.messages.find((m) => !m.pending);
    if (!first) return;
    try {
      const d = await api.get(`/rooms/${code}/messages?before=${encodeURIComponent(first.createdAt)}&limit=50`);
      R.mergeMessages(d.messages);
      R.setHasMore(d.hasMore);
    } catch (e) {
      toastError(e.message);
    }
  };

  const react = async (emoji) => {
    const res = await R.sendReaction(emoji);
    if (!res?.ok && res?.error) toastError(res.error.message);
  };

  // ----- queue: every call is validated again by the server; failures are shown, successes arrive as a broadcast.
  const queueCall = async (event, payload, failure = 'That didn’t work.') => {
    const res = await R.emitRoom(event, payload);
    if (!res?.ok) toastError(res?.error?.message || failure);
    return res;
  };
  const queueActions = {
    onAdd: async (url) => {
      const res = await R.emitRoom('queue:add', { url });
      if (res?.ok && res.duplicate) toast('That video was already queued, so your vote was added.');
      return res;
    },
    onVote: (itemId, on) => queueCall('queue:vote', { itemId, on }),
    onRemove: (itemId) => queueCall('queue:remove', { itemId }),
    onMove: (itemId, toIndex) => queueCall('queue:move', { itemId, toIndex }),
    onMode: (mode) => queueCall('queue:mode', { mode }),
    onPlayNow: (itemId) => queueCall('queue:next', { itemId }),
    onSkip: () => queueCall('queue:next', {}),
  };

  const sendChat = async (text, existingId) => {
    const clientId = existingId || newClientId();
    const res = await R.sendMessage(text, user, clientId);
    if (!res?.ok && ['SLOW_MODE', 'MUTED', 'RATE_LIMITED'].includes(res?.error?.code)) {
      R.discardMessage(`pending-${clientId}`);
      toastError(res.error.message);
    }
    return res;
  };

  const restrict = (kind, userId, minutes) =>
    restCall(() => api.post(`/rooms/${code}/${kind}`, { userId, minutes }).then((d) => R.setRoom((r) => ({ ...d.room, playback: r.playback }))), kind === 'mute' ? 'Muted' : 'Removed from the room');

  const textCount = R.messages.filter((m) => m.kind === 'text').length;

  return (
    <div className="room">
      <section aria-label="Player">
        <div className="room-bar">
          <h1>
            <span>{room.name}</span>
          </h1>
          {offline ? (
            <span className="chip chip-warn"><span className="spinner" style={{ width: 11, height: 11, borderWidth: 2 }} /> Reconnecting</span>
          ) : (
            <span className="chip chip-sync"><span className="dot dot-live" /> Live</span>
          )}
          <button className="room-code-btn" onClick={() => setInvite(true)} aria-label={`Room code ${code}. Open invite options`}>
            {code}
          </button>
          <Button variant="primary" size="sm" icon="link" onClick={() => setInvite(true)}>Invite</Button>
        </div>

        {offline && (
          <div className="conn-banner" role="status">
            <Icon name="wifiOff" size={18} />
            Connection lost. Reconnecting — you’ll jump back to the room’s position automatically.
          </div>
        )}

        <SyncPlayer
          ref={playerRef}
          playback={room.playback}
          canControl={canControl && !offline}
          serverNow={R.serverNow}
          onControl={control}
          onEnded={(videoId) => R.emitRoom('player:ended', { videoId })}
          onDuration={(videoId, duration) => R.emitRoom('player:duration', { videoId, duration })}
          onUnavailable={(videoId) => R.emitRoom('queue:unavailable', { videoId })}
          onProgress={(videoId, position, duration) => R.emitRoom('history:progress', { videoId, position, duration })}
          onResync={async () => {
            const r = await R.resync();
            if (r?.ok) toast('Back in sync with the room');
          }}
          emptySlot={
            canControl ? (
              <LinkForm onLoad={loadVideo} onBrowse={() => setPicker(true)} />
            ) : (
              <div className="inner">
                <h2>Waiting for the host</h2>
                <p>Nothing’s playing yet. When the host picks a video it’ll appear here for you too.</p>
              </div>
            )
          }
        >
          <Floaters items={floaters} />
        </SyncPlayer>

        <div className="reactions" role="group" aria-label="Send a reaction">
          {R.reactions.map((e) => (
            <button key={e} className="reaction-btn" onClick={() => react(e)} disabled={offline} aria-label={`React with ${e}`}>
              {e}
            </button>
          ))}
          {!showReactions && <span className="faint" style={{ fontSize: 'var(--t-xs)', marginLeft: 8 }}>Floating reactions are off in your settings.</span>}
        </div>

        <div className="now-playing">
          <div style={{ minWidth: 0 }}>
            <div className="np-title">{room.playback.videoId ? room.playback.videoTitle || 'YouTube video' : 'Nothing playing'}</div>
            <div className="np-sub">
              {canControl
                ? isHost
                  ? 'You’re the host. Play, pause and seek apply to everyone.'
                  : 'Everyone can control playback in this room.'
                : 'The host controls playback. Your volume and full screen are your own.'}
            </div>
          </div>
          <div className="np-actions">
            {room.playback.videoId && (
              <a className="btn btn-quiet btn-sm" href={`https://www.youtube.com/watch?v=${room.playback.videoId}`} target="_blank" rel="noreferrer">
                Open on YouTube
              </a>
            )}
            {canControl && room.playback.videoId && (
              <Button size="sm" icon="film" onClick={() => setPicker(true)} disabled={offline}>Change video</Button>
            )}
          </div>
        </div>
      </section>

      <aside className="panel side" aria-label="Room sidebar">
        <div className="side-tabs" role="tablist">
          <button role="tab" id="tab-chat" aria-controls="panel-chat" aria-selected={tab === 'chat'} className="side-tab" onClick={() => setTab('chat')}>
            <Icon name="chat" size={17} /> Chat {textCount > 0 && <span className="count">{textCount}</span>}
          </button>
          <button role="tab" id="tab-queue" aria-controls="panel-queue" aria-selected={tab === 'queue'} className="side-tab" onClick={() => setTab('queue')}>
            <Icon name="list" size={17} /> Queue {(R.queue?.items.length || 0) > 0 && <span className="count">{R.queue.items.length}</span>}
          </button>
          <button role="tab" id="tab-people" aria-controls="panel-people" aria-selected={tab === 'people'} className="side-tab" onClick={() => setTab('people')}>
            <Icon name="users" size={17} /> People <span className="count">{room.members.filter((m) => m.online).length}/{room.members.length}</span>
          </button>
        </div>
        <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" hidden={tab !== 'chat'} style={{ display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Chat
            me={me}
            messages={R.messages}
            typing={R.typing}
            hasMore={R.hasMore}
            disabled={offline}
            muted={iAmMuted}
            slowMode={room.slowModeSeconds}
            onReport={(m) => setReport({ target: m.user, message: m })}
            onSend={sendChat}
            onDiscard={R.discardMessage}
            onTyping={R.notifyTyping}
            onLoadOlder={loadOlder}
          />
        </div>
        <div role="tabpanel" id="panel-queue" aria-labelledby="tab-queue" hidden={tab !== 'queue'} style={{ display: tab === 'queue' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Queue
            queue={R.queue}
            me={me}
            isHost={isHost}
            canModerate={canModerate}
            canControl={canControl}
            offline={offline}
            nowPlaying={room.playback.videoTitle}
            {...queueActions}
          />
        </div>
        <div role="tabpanel" id="panel-people" aria-labelledby="tab-people" hidden={tab !== 'people'} style={{ display: tab === 'people' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <People
            room={room}
            me={me}
            isHost={isHost}
            canModerate={canModerate}
            onInvite={() => setInvite(true)}
            onReport={(m) => setReport({ target: m })}
            onOpenModeration={() => setModeration(true)}
            onRestrict={restrict}
            onUnmute={(userId) => restCall(() => api.post(`/rooms/${code}/unmute`, { userId }).then((d) => R.setRoom((r) => ({ ...d.room, playback: r.playback }))), 'Unmuted')}
            onModerator={(userId, moderator) => restCall(() => api.post(`/rooms/${code}/moderators`, { userId, moderator }).then((d) => R.setRoom((r) => ({ ...d.room, playback: r.playback }))), moderator ? 'Moderator added' : 'Moderator removed')}
            onUpdateSettings={(patch) =>
              restCall(() => api.patch(`/rooms/${code}`, patch).then((d) => R.setRoom((r) => ({ ...d.room, playback: r.playback }))), 'Room settings saved').catch(() => {})
            }
            onTransfer={(userId) => restCall(() => api.post(`/rooms/${code}/transfer`, { userId }), 'Host changed').catch(() => {})}
            onLeave={async () => {
              await restCall(() => api.post(`/rooms/${code}/leave`)).catch(() => null);
              navigate('/dashboard');
            }}
            onClose={async () => {
              await restCall(() => api.post(`/rooms/${code}/close`)).catch(() => null);
              navigate('/dashboard');
            }}
          />
        </div>
      </aside>

      {report && (
        <ReportModal
          target={report.target}
          message={report.message}
          onClose={() => setReport(null)}
          onSubmit={(body) => api.post(`/rooms/${code}/reports`, body).then(() => toast('Report sent to the moderators'))}
        />
      )}
      {moderation && <ModerationPanel code={code} isHost={isHost} onClose={() => setModeration(false)} />}
      {invite && <InviteModal code={code} onClose={() => setInvite(false)} />}
      {picker && <VideoPicker onLoad={loadVideo} onClose={() => setPicker(false)} />}
    </div>
  );
}
