import mongoose from 'mongoose';
import { Room, isBanned, isMuted } from '../models/Room.js';
import { Message } from '../models/Message.js';
import { Report } from '../models/Report.js';
import { ModLog } from '../models/ModLog.js';
import { HttpError } from '../lib/http.js';
import { notify } from './notifications.js';

export const MAX_RESTRICTION_MINUTES = 60 * 24 * 30; // temporary mutes/bans are capped at 30 days

const uid = (m) => (m.user?._id || m.user).toString();
const memberRecord = (room, userId) => room.members.find((m) => uid(m) === userId.toString());

export const logAction = (room, actor, action, target = null, details = {}) =>
  ModLog.create({ room: room._id, actor, action, target, details });

/**
 * Who may act on whom.
 *  - the host can moderate everyone else;
 *  - a moderator can moderate ordinary members only (never the host, other moderators or themselves).
 */
export function assertCanActOn(room, actorId, targetId, { allowLeft = false } = {}) {
  if (!room.canModerate(actorId)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can do that.');
  if (actorId.toString() === targetId.toString()) throw new HttpError(400, 'CANNOT_TARGET_SELF', 'You can’t do that to yourself.');
  if (room.isHost(targetId)) throw new HttpError(403, 'CANNOT_TARGET_HOST', 'Nobody can moderate the host.');
  const record = memberRecord(room, targetId);
  if (!record || (!allowLeft && record.leftAt)) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'That person isn’t in this room.');
  if (record.role === 'moderator' && !room.isHost(actorId)) {
    throw new HttpError(403, 'NOT_ALLOWED', 'Only the host can moderate another moderator.');
  }
  return record;
}

const minutesOrNull = (minutes) => {
  if (minutes == null) return null;
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_RESTRICTION_MINUTES) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a duration between 1 minute and 30 days.');
  }
  return new Date(Date.now() + Math.round(minutes) * 60_000);
};

const nameOf = (record) => record?.user?.displayName || 'A member';

export async function muteMember(room, actor, targetId, minutes) {
  const record = assertCanActOn(room, actor._id, targetId);
  const until = minutesOrNull(minutes);
  await Room.updateOne(
    { _id: room._id, 'members.user': targetId },
    { $set: { 'members.$.muted': true, 'members.$.mutedUntil': until } }
  );
  await logAction(room, actor._id, 'mute', targetId, { minutes: minutes ?? null });
  await notify(targetId, {
    type: 'moderation',
    title: `You were muted in “${room.name}”`,
    body: until ? `You can chat again in ${Math.round(minutes)} minute${minutes === 1 ? '' : 's'}.` : 'A moderator muted you until they unmute you.',
    link: `/room/${room.code}`,
    data: { roomCode: room.code, action: 'mute' },
  });
  return { target: nameOf(record), until };
}

export async function unmuteMember(room, actor, targetId) {
  assertCanActOn(room, actor._id, targetId);
  await Room.updateOne(
    { _id: room._id, 'members.user': targetId },
    { $set: { 'members.$.muted': false, 'members.$.mutedUntil': null } }
  );
  await logAction(room, actor._id, 'unmute', targetId);
  await notify(targetId, {
    type: 'moderation',
    title: `You were unmuted in “${room.name}”`,
    link: `/room/${room.code}`,
    data: { roomCode: room.code, action: 'unmute' },
  });
}

/** Ban (permanently when minutes is null). The person is also taken out of the room. */
export async function banMember(room, actor, targetId, minutes, { action = 'ban' } = {}) {
  const record = assertCanActOn(room, actor._id, targetId, { allowLeft: true });
  const until = minutesOrNull(minutes);
  const now = new Date();
  await Room.updateOne(
    { _id: room._id, 'members.user': targetId },
    {
      $set: {
        'members.$.removed': true,
        'members.$.bannedUntil': until,
        'members.$.bannedBy': actor._id,
        'members.$.leftAt': now,
        'members.$.role': 'member',
        'members.$.muted': false,
        'members.$.mutedUntil': null,
      },
    }
  );
  await logAction(room, actor._id, action, targetId, { minutes: minutes ?? null });
  await notify(targetId, {
    type: 'moderation',
    title: `You were removed from “${room.name}”`,
    body: until ? `You can rejoin after ${until.toUTCString()}.` : 'You can’t rejoin this room.',
    link: '/dashboard',
    data: { roomCode: room.code, action: 'ban' },
  });
  return { target: nameOf(record), until };
}

export async function unbanMember(room, actor, targetId) {
  if (!room.canModerate(actor._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can do that.');
  const record = memberRecord(room, targetId);
  if (!record || !isBanned(record)) throw new HttpError(404, 'NOT_BANNED', 'That person isn’t banned from this room.');
  // A moderator can't undo a decision the host made.
  if (record.bannedBy && room.isHost(record.bannedBy) && !room.isHost(actor._id)) {
    throw new HttpError(403, 'NOT_ALLOWED', 'Only the host can lift a ban the host issued.');
  }
  await Room.updateOne(
    { _id: room._id, 'members.user': targetId },
    { $set: { 'members.$.removed': false, 'members.$.bannedUntil': null, 'members.$.bannedBy': null } }
  );
  await logAction(room, actor._id, 'unban', targetId);
  await notify(targetId, {
    type: 'moderation',
    title: `You can rejoin “${room.name}”`,
    body: 'Your ban was lifted.',
    link: `/join/${room.code}`,
    data: { roomCode: room.code, action: 'unban' },
  });
}

export async function setModerator(room, actor, targetId, on) {
  if (!room.isHost(actor._id)) throw new HttpError(403, 'HOST_ONLY', 'Only the host can appoint moderators.');
  const record = assertCanActOn(room, actor._id, targetId);
  await Room.updateOne({ _id: room._id, 'members.user': targetId }, { $set: { 'members.$.role': on ? 'moderator' : 'member' } });
  await logAction(room, actor._id, on ? 'promote' : 'demote', targetId);
  await notify(targetId, {
    type: 'moderation',
    title: on ? `You’re now a moderator in “${room.name}”` : `You’re no longer a moderator in “${room.name}”`,
    link: `/room/${room.code}`,
    data: { roomCode: room.code, action: on ? 'promote' : 'demote' },
  });
  return { target: nameOf(record) };
}

// ----------------------------------------------------------------- reports

export async function createReport(room, reporter, { targetId, messageId, reason, details }) {
  if (!room.memberFor(reporter._id)) throw new HttpError(403, 'NOT_A_MEMBER', 'Join this room to report someone.');
  if (targetId === reporter._id.toString()) throw new HttpError(400, 'CANNOT_TARGET_SELF', 'You can’t report yourself.');
  if (!memberRecord(room, targetId)) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'That person isn’t in this room.');

  let messageText = '';
  let message = null;
  if (messageId) {
    if (!mongoose.isValidObjectId(messageId)) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'That message no longer exists.');
    const msg = await Message.findOne({ _id: messageId, room: room._id, user: targetId, kind: 'text' });
    if (!msg) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'That message no longer exists.');
    message = msg._id;
    messageText = msg.text;
  }
  const open = await Report.countDocuments({ room: room._id, reporter: reporter._id, status: 'open' });
  if (open >= 10) throw new HttpError(429, 'TOO_MANY_REPORTS', 'You already have several reports waiting for review in this room.');

  try {
    const report = await Report.create({ room: room._id, reporter: reporter._id, target: targetId, message, reason, details: details || '', messageText });
    return report;
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, 'ALREADY_REPORTED', 'You already reported this. A moderator will review it.');
    throw err;
  }
}

const serializeReport = (r) => ({
  id: r._id.toString(),
  reason: r.reason,
  details: r.details,
  messageText: r.messageText,
  status: r.status,
  resolution: r.resolution,
  createdAt: r.createdAt,
  handledAt: r.handledAt,
  reporter: r.reporter?._id ? { id: r.reporter._id.toString(), displayName: r.reporter.displayName } : { id: null, displayName: 'Deleted user' },
  target: r.target?._id ? { id: r.target._id.toString(), displayName: r.target.displayName } : { id: null, displayName: 'Deleted user' },
});

export async function listReports(room, actor, { status = 'open', limit = 30 } = {}) {
  if (!room.canModerate(actor._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can review reports.');
  const filter = { room: room._id };
  if (status !== 'all') filter.status = status;
  // Reports about the host are for moderators to see, never for the host themselves.
  if (room.isHost(actor._id)) filter.target = { $ne: actor._id };
  const docs = await Report.find(filter).sort({ createdAt: -1 }).limit(limit).populate('reporter target', 'displayName');
  return docs.map(serializeReport);
}

export async function resolveReport(room, actor, reportId, { decision, action = 'none', minutes = null, note = '' }) {
  if (!room.canModerate(actor._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can review reports.');
  if (!mongoose.isValidObjectId(reportId)) throw new HttpError(404, 'REPORT_NOT_FOUND', 'That report doesn’t exist.');
  const report = await Report.findOne({ _id: reportId, room: room._id });
  if (!report) throw new HttpError(404, 'REPORT_NOT_FOUND', 'That report doesn’t exist.');
  const targetId = report.target.toString();
  if (targetId === actor._id.toString()) throw new HttpError(403, 'NOT_ALLOWED', 'You can’t review a report about yourself.');
  if (report.status !== 'open') throw new HttpError(409, 'ALREADY_HANDLED', 'Someone already handled this report.');

  // Claim the report first so two reviewers can't both act on it.
  const claimed = await Report.findOneAndUpdate(
    { _id: report._id, status: 'open' },
    { $set: { status: decision === 'dismiss' ? 'dismissed' : 'actioned', handledBy: actor._id, handledAt: new Date(), resolution: note } },
    { returnDocument: 'after' }
  );
  if (!claimed) throw new HttpError(409, 'ALREADY_HANDLED', 'Someone already handled this report.');

  try {
    if (decision === 'action') {
      if (action === 'mute') await muteMember(room, actor, targetId, minutes);
      else if (action === 'ban') await banMember(room, actor, targetId, minutes);
    }
  } catch (err) {
    // The punishment was not allowed (for example a moderator acting on the host): put the report back.
    await Report.updateOne({ _id: report._id }, { $set: { status: 'open', handledBy: null, handledAt: null, resolution: '' } });
    throw err;
  }
  await logAction(room, actor._id, decision === 'dismiss' ? 'report_dismissed' : 'report_actioned', report.target, { reportId: report._id.toString(), action });
  await notify(report.reporter, {
    type: 'report_outcome',
    title: 'A moderator reviewed your report',
    body: `Your report in “${room.name}” was reviewed. Thank you for helping keep the room safe.`,
    link: `/room/${room.code}`,
    data: { roomCode: room.code },
    dedupeKey: `report:${report._id}`,
  });
  return serializeReport(await Report.findById(report._id).populate('reporter target', 'displayName'));
}

// ----------------------------------------------------------------- overview + log

export function moderationOverview(room, actor) {
  if (!room.canModerate(actor._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can see this.');
  const brief = (m) => ({
    id: uid(m),
    displayName: m.user?.displayName || 'Deleted user',
    until: null,
  });
  return {
    muted: room.members.filter((m) => !m.leftAt && isMuted(m)).map((m) => ({ ...brief(m), until: m.mutedUntil })),
    banned: room.members
      .filter((m) => isBanned(m))
      .map((m) => ({ ...brief(m), until: m.bannedUntil, byHost: Boolean(m.bannedBy && room.isHost(m.bannedBy)) })),
    moderators: room.members.filter((m) => !m.leftAt && m.role === 'moderator').map(brief),
  };
}

export async function listLog(room, actor, { limit = 50, before } = {}) {
  if (!room.canModerate(actor._id)) throw new HttpError(403, 'NOT_ALLOWED', 'Only the host or a moderator can see the log.');
  const filter = { room: room._id };
  if (before) filter.createdAt = { $lt: new Date(before) };
  const rows = await ModLog.find(filter).sort({ createdAt: -1 }).limit(limit).populate('actor target', 'displayName');
  return rows.map((r) => ({
    id: r._id.toString(),
    action: r.action,
    actor: r.actor?.displayName || 'Deleted user',
    target: r.target?.displayName || (r.target ? 'Deleted user' : null),
    details: r.details || {},
    createdAt: r.createdAt,
  }));
}
