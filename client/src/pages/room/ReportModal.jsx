import { useState } from 'react';
import { Button, Field, Modal } from '../../components/ui.jsx';

const REASONS = [
  ['spam', 'Spam or advertising'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hateful content'],
  ['inappropriate', 'Inappropriate content'],
  ['other', 'Something else'],
];

/** Report a person, or one of their messages, to the room's moderators. */
export default function ReportModal({ target, message, onSubmit, onClose }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await onSubmit({ userId: target.id, messageId: message?.id, reason, details: details.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err.fields?.details || err.message);
      setSending(false);
    }
  };

  return (
    <Modal
      title={message ? 'Report this message' : `Report ${target.displayName}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="report-form" loading={sending}>Send report</Button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 'var(--s4)' }}>
        Only the room’s host and moderators see this. {message ? 'The message text is attached so they can review it.' : 'Nothing else from your account is shared.'}
      </p>
      {message && <blockquote className="mod-quote">{message.text}</blockquote>}
      <form id="report-form" onSubmit={submit} noValidate>
        <Field label="Reason">
          {(p) => (
            <select {...p} className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </Field>
        <Field label="Details (optional)" hint="Up to 300 characters." error={error}>
          {(p) => <textarea {...p} className="textarea" maxLength={300} value={details} onChange={(e) => setDetails(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}
