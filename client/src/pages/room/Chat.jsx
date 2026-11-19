import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Avatar, Button } from '../../components/ui.jsx';
import { clock, timeOfDay } from '../../lib/format.js';

const MAX = 500;

export default function Chat({ me, messages, typing, onSend, onDiscard, onTyping, onLoadOlder, hasMore, disabled, muted, slowMode, onReport }) {
  const [text, setText] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const log = useRef(null);
  const input = useRef(null);
  const prevHeight = useRef(0);
  const prepending = useRef(false);

  // Keep pinned to the latest message unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    if (prepending.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prepending.current = false;
    } else if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, atBottom]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const onScroll = () => {
    const el = log.current;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || value.length > MAX || disabled || muted) return;
    setText('');
    setAtBottom(true);
    const res = await onSend(value);
    if (res?.ok === false && ['RATE_LIMITED', 'SLOW_MODE', 'MUTED'].includes(res.error?.code)) setText((t) => t || value);
  };

  const older = async () => {
    setLoadingOlder(true);
    prevHeight.current = log.current.scrollHeight;
    prepending.current = true;
    await onLoadOlder();
    setLoadingOlder(false);
  };

  const typers = Object.values(typing).map((t) => t.name);
  const visible = messages;

  return (
    <>
      <div className="chat-log" ref={log} onScroll={onScroll} aria-live="polite" aria-relevant="additions" role="log" aria-label="Room chat">
        {hasMore && (
          <div style={{ textAlign: 'center', paddingBottom: 8 }}>
            <Button variant="quiet" size="sm" onClick={older} loading={loadingOlder}>Load earlier messages</Button>
          </div>
        )}
        {!visible.some((m) => m.kind === 'text') && (
          <p className="chat-empty">No messages yet. Say hello — everyone in the room sees it instantly.</p>
        )}
        {visible.map((m, i) => {
          if (m.kind === 'system') return <div key={m.id} className="msg-system">{m.text}</div>;
          if (m.kind === 'reaction')
            return (
              <div key={m.id} className="msg-reaction">
                <span className="emoji" aria-hidden="true">{m.emoji}</span>
                <span>
                  {m.user?.id === me.id ? 'You' : m.user?.displayName} reacted
                  {m.videoTime != null && <> at {clock(m.videoTime)}</>}
                </span>
              </div>
            );
          const prev = visible[i - 1];
          const cont =
            prev && prev.kind === 'text' && prev.user?.id === m.user?.id && new Date(m.createdAt) - new Date(prev.createdAt) < 120000;
          return (
            <div key={m.id} className={`msg ${cont ? 'cont' : ''} ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}`}>
              {cont ? <span /> : <Avatar user={m.user} size={30} />}
              <div className="msg-head">
                <span className="msg-name">{m.user?.id === me.id ? 'You' : m.user?.displayName}</span>
                <time className="msg-time" dateTime={m.createdAt}>{timeOfDay(m.createdAt)}</time>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <p className="msg-text" style={{ flex: 1 }}>{m.text}</p>
                  {onReport && m.user && m.user.id !== me.id && !m.pending && (
                    <button className="btn btn-quiet btn-icon btn-sm msg-report" style={{ height: 24, width: 24 }} aria-label={`Report this message from ${m.user.displayName}`} title="Report this message" onClick={() => onReport(m)}>
                      <Icon name="flag" size={14} />
                    </button>
                  )}
                </div>
                {m.failed && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--t-xs)', color: 'var(--signal)' }}>
                    <span>{m.failed}</span>
                    <button className="btn btn-quiet btn-sm" style={{ height: 24 }} onClick={() => { onDiscard(m.id); onSend(m.text, m.clientId); }}>Retry</button>
                    <button className="btn btn-quiet btn-sm" style={{ height: 24 }} onClick={() => onDiscard(m.id)}>Discard</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!atBottom && (
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-sm"
            style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', boxShadow: 'var(--shadow-pop)' }}
            onClick={() => {
              setAtBottom(true);
              log.current.scrollTop = log.current.scrollHeight;
            }}
          >
            Jump to latest
          </button>
        </div>
      )}
      <div className="typing" aria-live="polite">
        {typers.length === 1 && `${typers[0]} is typing…`}
        {typers.length === 2 && `${typers[0]} and ${typers[1]} are typing…`}
        {typers.length > 2 && 'Several people are typing…'}
      </div>
      {muted && <div className="chat-notice" role="status">A moderator muted you in this room. You can still watch and read the chat.</div>}
      {!muted && slowMode > 0 && <div className="chat-notice" role="status">Slow mode is on: one message every {slowMode} second{slowMode === 1 ? '' : 's'}.</div>}
      <form className="chat-form" onSubmit={submit}>
        <div className="chat-input-row">
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <textarea
            id="chat-input"
            ref={input}
            className="chat-input"
            rows={1}
            placeholder={disabled ? 'Reconnecting…' : muted ? 'You’re muted in this room' : 'Message the room'}
            value={text}
            disabled={disabled || muted}
            maxLength={MAX + 50}
            onChange={(e) => {
              setText(e.target.value);
              onTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" className="btn btn-primary btn-icon" aria-label="Send message" disabled={!text.trim() || text.length > MAX || disabled || muted}>
            <Icon name="send" size={18} />
          </button>
        </div>
        <div className="chat-meta">
          <span>Enter to send, Shift+Enter for a new line</span>
          <span className={text.length > MAX ? 'over' : ''}>{text.length > MAX - 100 ? `${text.length}/${MAX}` : ''}</span>
        </div>
      </form>
    </>
  );
}
