import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Avatar, Button, Modal, Switch } from '../../components/ui.jsx';
import { relative } from '../../lib/format.js';

const BAN_OPTIONS = [
  ['60', '1 hour'],
  ['1440', '24 hours'],
  ['10080', '7 days'],
  ['perm', 'Permanently'],
];
const MUTE_OPTIONS = [
  ['10', '10 minutes'],
  ['60', '1 hour'],
  ['1440', '24 hours'],
  ['perm', 'Until unmuted'],
];
const SLOW = [[0, 'Off'], [5, '5 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute']];

export default function People({ room, me, isHost, canModerate, onUpdateSettings, onTransfer, onRestrict, onUnmute, onModerator, onReport, onOpenModeration, onLeave, onClose, onInvite }) {
  const [confirm, setConfirm] = useState(null); // { kind, member }
  const [working, setWorking] = useState(false);
  const [duration, setDuration] = useState('60');

  const act = async (fn) => {
    setWorking(true);
    try {
      await fn();
      setConfirm(null);
    } finally {
      setWorking(false);
    }
  };
  const minutes = () => (duration === 'perm' ? null : Number(duration));
  const open = (kind, member) => {
    setDuration(kind === 'ban' ? '1440' : '60');
    setConfirm({ kind, member });
  };

  const online = room.members.filter((m) => m.online).length;
  /** Hosts can act on anyone else; moderators only on ordinary members. */
  const canActOn = (m) => canModerate && m.id !== me.id && m.role !== 'host' && (isHost || m.role !== 'moderator');

  return (
    <>
      <div className="people">
        <p className="faint" style={{ fontSize: 'var(--t-xs)', padding: '4px 8px 8px' }}>
          {online} of {room.members.length} here now, {room.maxMembers} max
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {room.members.map((m) => (
            <li key={m.id} className="person">
              <Avatar user={m} size={36} online={m.online} />
              <div style={{ minWidth: 0 }}>
                <div className="person-name">
                  {m.displayName}
                  {m.id === me.id && <span className="faint" style={{ fontWeight: 400 }}> (you)</span>}
                </div>
                <div className="person-status">
                  {m.role === 'host' && <><Icon name="crown" size={12} /> Host, </>}
                  {m.role === 'moderator' && <><Icon name="shield" size={12} /> Moderator, </>}
                  {m.muted && <span style={{ color: 'var(--marquee)' }}>muted, </span>}
                  {m.online ? 'watching' : `last seen ${relative(m.lastSeenAt)}`}
                </div>
              </div>
              <div className="person-actions">
                {m.id !== me.id && (
                  <button className="btn btn-quiet btn-icon btn-sm" title={`Report ${m.displayName}`} aria-label={`Report ${m.displayName}`} onClick={() => onReport(m)}>
                    <Icon name="flag" size={16} />
                  </button>
                )}
                {canActOn(m) && (
                  <button
                    className="btn btn-quiet btn-icon btn-sm"
                    title={m.muted ? `Unmute ${m.displayName}` : `Mute ${m.displayName}`}
                    aria-label={m.muted ? `Unmute ${m.displayName}` : `Mute ${m.displayName}`}
                    onClick={() => (m.muted ? act(() => onUnmute(m.id)) : open('mute', m))}
                  >
                    <Icon name="mic" size={16} />
                  </button>
                )}
                {isHost && m.id !== me.id && (
                  <>
                    <button className="btn btn-quiet btn-icon btn-sm" title={m.role === 'moderator' ? `Remove ${m.displayName} as moderator` : `Make ${m.displayName} a moderator`} aria-label={m.role === 'moderator' ? `Remove ${m.displayName} as moderator` : `Make ${m.displayName} a moderator`} onClick={() => act(() => onModerator(m.id, m.role !== 'moderator'))}>
                      <Icon name="shield" size={16} />
                    </button>
                    <button className="btn btn-quiet btn-icon btn-sm" title={`Make ${m.displayName} the host`} aria-label={`Make ${m.displayName} the host`} onClick={() => open('transfer', m)}>
                      <Icon name="crown" size={16} />
                    </button>
                  </>
                )}
                {canActOn(m) && (
                  <button className="btn btn-quiet btn-icon btn-sm" title={`Remove ${m.displayName}`} aria-label={`Remove ${m.displayName} from the room`} onClick={() => open('ban', m)}>
                    <Icon name="remove" size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="people-foot">
        <Button variant="ghost" icon="link" onClick={onInvite} block>Invite people</Button>
        {canModerate && <Button variant="ghost" icon="shield" onClick={onOpenModeration} block>Moderation</Button>}
        {isHost && (
          <>
            <Switch
              checked={room.guestControl}
              onChange={(v) => onUpdateSettings({ guestControl: v })}
              label="Everyone controls playback"
              description="Off: only you can play, pause and seek."
            />
            <Switch
              checked={room.locked}
              onChange={(v) => onUpdateSettings({ locked: v })}
              label="Lock room"
              description="Stop new people joining with the code."
            />
            <div className="field">
              <label className="label" htmlFor="slow-mode">Slow mode</label>
              <select id="slow-mode" className="select" value={room.slowModeSeconds || 0} onChange={(e) => onUpdateSettings({ slowModeSeconds: Number(e.target.value) })}>
                {SLOW.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="hint">Limits how often each member can send a chat message. Moderators are exempt.</span>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <Button variant="ghost" icon="door" onClick={() => setConfirm({ kind: 'leave' })}>Leave room</Button>
          {isHost && <Button variant="danger" onClick={() => setConfirm({ kind: 'close' })}>Close room</Button>}
        </div>
      </div>

      {confirm?.kind === 'transfer' && (
        <Modal
          title={`Make ${confirm.member.displayName} the host?`}
          onClose={() => setConfirm(null)}
          actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" loading={working} onClick={() => act(() => onTransfer(confirm.member.id))}>Make host</Button></>}
        >
          <p className="muted">They’ll control playback and room settings. You’ll stay in the room as a member.</p>
        </Modal>
      )}
      {confirm?.kind === 'mute' && (
        <Modal
          title={`Mute ${confirm.member.displayName}?`}
          onClose={() => setConfirm(null)}
          actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" loading={working} onClick={() => act(() => onRestrict('mute', confirm.member.id, minutes()))}>Mute</Button></>}
        >
          <p className="muted" style={{ marginBottom: 'var(--s4)' }}>They can keep watching but can’t chat or react.</p>
          <label className="label" htmlFor="mute-for">For</label>
          <select id="mute-for" className="select" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {MUTE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Modal>
      )}
      {confirm?.kind === 'ban' && (
        <Modal
          title={`Remove ${confirm.member.displayName}?`}
          onClose={() => setConfirm(null)}
          actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={working} onClick={() => act(() => onRestrict('ban', confirm.member.id, minutes()))}>Remove</Button></>}
        >
          <p className="muted" style={{ marginBottom: 'var(--s4)' }}>They’ll be disconnected and can’t rejoin for the time you choose.</p>
          <label className="label" htmlFor="ban-for">Ban for</label>
          <select id="ban-for" className="select" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {BAN_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Modal>
      )}
      {confirm?.kind === 'leave' && (
        <Modal
          title="Leave this room?"
          onClose={() => setConfirm(null)}
          actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Stay</Button><Button variant="primary" loading={working} onClick={() => act(onLeave)}>Leave room</Button></>}
        >
          <p className="muted">
            {isHost
              ? room.members.length > 1
                ? 'Another member will become the host. You can rejoin later with the code.'
                : 'You’re the only one here, so leaving closes the room.'
              : 'You can rejoin later with the code while the room is open.'}
          </p>
        </Modal>
      )}
      {confirm?.kind === 'close' && (
        <Modal
          title="Close this room for everyone?"
          onClose={() => setConfirm(null)}
          actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={working} onClick={() => act(onClose)}>Close room</Button></>}
        >
          <p className="muted">Playback stops, everyone is sent out, and the code stops working. This can’t be undone.</p>
        </Modal>
      )}
    </>
  );
}
