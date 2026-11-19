import { WatchEvent, endsAt } from '../models/WatchEvent.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { notify, withdrawUnread } from './notifications.js';

const uid = (u) => (u?._id || u).toString();

/**
 * Send "starting soon" reminders that are due. Designed to be called repeatedly (and by more than one process):
 *  - state lives in MongoDB (`reminderSentFor`), so a restart never loses or repeats a reminder;
 *  - each reminder has a unique dedupe key per person and start time, so a race cannot deliver it twice;
 *  - a party whose start time changed or that was cancelled is re-checked right before and after sending.
 * Returns how many events were processed.
 */
export async function runReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + 24 * 3600 * 1000);
  const due = await WatchEvent.find({
    status: 'scheduled',
    startsAt: { $lte: horizon },
    $expr: {
      $and: [
        { $lte: ['$startsAt', { $add: [now, { $multiply: ['$reminderLeadMinutes', 60_000] }] }] },
        { $ne: ['$reminderSentFor', '$startsAt'] },
      ],
    },
  }).limit(100);

  let processed = 0;
  for (const candidate of due) {
    try {
      const startsAt = new Date(candidate.startsAt);
      const mark = () => WatchEvent.updateOne({ _id: candidate._id, startsAt, status: 'scheduled' }, { $set: { reminderSentFor: startsAt } });

      // The party is already over (the server was down): nothing useful to say.
      if (now >= endsAt(candidate)) {
        await mark();
        continue;
      }
      // Re-read to be sure it still applies to exactly this start time.
      const fresh = await WatchEvent.findById(candidate._id);
      if (!fresh || fresh.status !== 'scheduled' || new Date(fresh.startsAt).getTime() !== startsAt.getTime()) continue;

      const minutes = Math.round((startsAt.getTime() - now.getTime()) / 60_000);
      const recipients = [uid(fresh.host), ...fresh.rsvps.filter((r) => r.status === 'going').map((r) => uid(r.user))];
      const when = minutes > 0 ? `starts in ${minutes} minute${minutes === 1 ? '' : 's'}` : minutes === 0 ? 'is starting now' : `started ${-minutes} minute${minutes === -1 ? '' : 's'} ago`;
      await Promise.all(
        [...new Set(recipients)].map((id) =>
          notify(id, {
            type: 'event_reminder',
            title: `“${fresh.title}” ${when}`,
            body: 'The room is open. Join when you’re ready.',
            link: `/events/${fresh._id}`,
            data: { eventId: fresh._id.toString(), startsAt: startsAt.toISOString() },
            dedupeKey: `event_reminder:${fresh._id}:${startsAt.getTime()}`,
          })
        )
      );
      await mark();

      // If the host changed or cancelled it while we were sending, take the stale reminders back.
      const after = await WatchEvent.findById(candidate._id).select('status startsAt');
      if (!after || after.status !== 'scheduled' || new Date(after.startsAt).getTime() !== startsAt.getTime()) {
        await withdrawUnread({ type: 'event_reminder', 'data.eventId': candidate._id.toString(), 'data.startsAt': startsAt.toISOString() });
      }
      processed += 1;
    } catch (err) {
      log.error('reminder failed', { eventId: candidate._id.toString(), message: err.message });
    }
  }
  return processed;
}

/** Start the periodic scheduler. Returns a function that stops it. Disabled when the interval is 0 (tests call runReminders directly). */
export function startScheduler() {
  if (!config.schedulerIntervalMs) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap two passes
    running = true;
    try {
      await runReminders();
    } catch (err) {
      log.error('scheduler pass failed', { message: err.message });
    } finally {
      running = false;
    }
  };
  tick(); // catch up immediately after a restart
  const timer = setInterval(tick, config.schedulerIntervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
