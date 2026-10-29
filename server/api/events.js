import express from 'express';
import qrcode from 'qrcode-generator';
import { get, all, run, nowIso, randomCode } from '../db.js';
import { requireStaff } from '../auth.js';
import { addPoints, removePoints, checkBadges } from '../points.js';
import { notifyMembers, notifyGroupChat } from '../notify.js';
import { feedbackAuthorHash } from '../anon.js';
import { eventIcsUrl, googleCalendarUrl } from '../ical.js';
import { startLink, botInfo } from '../bot.js';
import { humanDateTime, localDate } from '../time.js';
import { fail, str, isoOrNull, url, userCard, esc } from './util.js';

export const eventsRouter = express.Router({ mergeParams: true });
const r = eventsRouter;

export const KIND_TITLES = { meeting: 'Встреча', stream: 'Эфир', deadline: 'Дедлайн', other: 'Событие' };
const KIND_EMOJI = { meeting: '🤝', stream: '📺', deadline: '⏰', other: '📌' };

// Отметиться можно за 30 минут до начала и до 1 часа после окончания
export function checkinWindow(e) {
  const start = Date.parse(e.starts_at) - 30 * 60_000;
  const end = Date.parse(e.ends_at || e.starts_at) + (e.ends_at ? 60 : 180) * 60_000;
  const now = Date.now();
  return { open: now >= start && now <= end, start, end };
}

function eventJson(e, req) {
  const checkedIn = !!get('SELECT 1 FROM attendance WHERE event_id = ? AND user_id = ?', e.id, req.user.id);
  const ended = Date.parse(e.ends_at || e.starts_at) <= Date.now();
  const res = {
    id: e.id, kind: e.kind, kind_title: KIND_TITLES[e.kind], title: e.title, description: e.description, location: e.location, url: e.url,
    starts_at: e.starts_at, ends_at: e.ends_at, cancelled: !!e.cancelled, ended,
    checked_in: checkedIn,
    can_checkin: e.kind === 'meeting' && !e.cancelled && !checkedIn && checkinWindow(e).open,
    attendees: get('SELECT COUNT(*) AS n FROM attendance WHERE event_id = ?', e.id).n,
    feedback_done: e.kind === 'meeting' ? !!get('SELECT 1 FROM feedback WHERE event_id = ? AND author_hash = ?', e.id, feedbackAuthorHash(e.id, req.user.id)) : null,
    can_feedback: e.kind === 'meeting' && !e.cancelled && ended && req.role === 'participant',
    ics_url: eventIcsUrl(e.id),
    google_url: googleCalendarUrl(e),
  };
  if (req.isStaff) res.checkin_code = e.checkin_code;
  return res;
}

const loadEvent = (req) => {
  const e = get('SELECT * FROM events WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!e) fail(404, 'Событие не найдено');
  return e;
};

r.get('/events', (req, res) => {
  const from = isoOrNull(req.query.from) || new Date(Date.now() - 45 * 86400_000).toISOString();
  const to = isoOrNull(req.query.to) || new Date(Date.now() + 180 * 86400_000).toISOString();
  const events = all('SELECT * FROM events WHERE group_id = ? AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at', req.group.id, from, to)
    .map((e) => eventJson(e, req));
  const tasks = all(`SELECT t.id, t.title, t.due_at, (SELECT 1 FROM task_done d WHERE d.task_id = t.id AND d.user_id = ?) AS done
    FROM tasks t WHERE t.group_id = ? AND t.due_at >= ? AND t.due_at <= ? ORDER BY t.due_at`, req.user.id, req.group.id, from, to)
    .map((t) => ({ ...t, done: !!t.done }));
  res.json({ events, tasks });
});

function readEventBody(b, prev = {}) {
  const kind = b.kind ?? prev.kind ?? 'meeting';
  if (!KIND_TITLES[kind]) fail(400, 'Неизвестный тип события');
  const starts_at = b.starts_at !== undefined ? isoOrNull(b.starts_at, 'Начало') : prev.starts_at;
  if (!starts_at) fail(400, 'Укажите дату и время начала');
  const ends_at = b.ends_at !== undefined ? isoOrNull(b.ends_at, 'Окончание') : prev.ends_at ?? null;
  if (ends_at && ends_at < starts_at) fail(400, 'Окончание раньше начала');
  return {
    kind,
    title: b.title !== undefined ? str(b.title, 120, { required: true, label: 'Название' }) : prev.title,
    description: b.description !== undefined ? str(b.description, 3000) : prev.description ?? '',
    location: b.location !== undefined ? str(b.location, 300) : prev.location ?? '',
    url: b.url !== undefined ? url(b.url) : prev.url ?? '',
    starts_at, ends_at,
  };
}

function announceEvent(group, e, verb) {
  const when = humanDateTime(e.starts_at, group.tz);
  const text = `${KIND_EMOJI[e.kind]} ${verb}: <b>${esc(e.title)}</b>\n🗓 ${when}${e.location ? `\n📍 ${esc(e.location)}` : ''}`;
  return { text, buttons: [[{ text: 'Подробнее', app: `/event/${e.id}` }]] };
}

r.post('/events', requireStaff, (req, res) => {
  const d = readEventBody(req.body);
  const r2 = run(`INSERT INTO events (group_id, kind, title, description, location, url, starts_at, ends_at, checkin_code, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.group.id, d.kind, d.title, d.description, d.location, d.url, d.starts_at, d.ends_at, randomCode(4).toUpperCase(), req.user.id);
  const e = get('SELECT * FROM events WHERE id = ?', r2.lastInsertRowid);
  if (req.body.notify !== false && Date.parse(e.starts_at) > Date.now()) {
    const a = announceEvent(req.group, e, `Новое: ${KIND_TITLES[e.kind].toLowerCase()}`);
    notifyMembers(req.group.id, a.text, { kind: e.kind === 'deadline' ? 'deadlines' : 'meetings', buttons: a.buttons, except: req.user.id });
    if (req.body.toChat) notifyGroupChat(req.group.id, a.text, { buttons: a.buttons });
  }
  res.json(eventJson(e, req));
});

r.get('/events/:id', (req, res) => {
  const e = loadEvent(req);
  const out = eventJson(e, req);
  if (req.isStaff) {
    out.attendance = all(`SELECT u.*, m.role, a.at FROM members m JOIN users u ON u.id = m.user_id
      LEFT JOIN attendance a ON a.event_id = ? AND a.user_id = u.id
      WHERE m.group_id = ? AND m.status = 'active' AND m.role = 'participant' ORDER BY a.at IS NULL, u.first_name`, e.id, req.group.id)
      .map((u) => ({ ...userCard(u), present: !!u.at }));
  }
  res.json(out);
});

r.patch('/events/:id', requireStaff, (req, res) => {
  const prev = loadEvent(req);
  const d = readEventBody(req.body, prev);
  const moved = d.starts_at !== prev.starts_at;
  run(`UPDATE events SET kind = ?, title = ?, description = ?, location = ?, url = ?, starts_at = ?, ends_at = ?, updated_at = ?,
    reminded_day = CASE WHEN ? THEN 0 ELSE reminded_day END, reminded_hour = CASE WHEN ? THEN 0 ELSE reminded_hour END WHERE id = ?`,
    d.kind, d.title, d.description, d.location, d.url, d.starts_at, d.ends_at, nowIso(), moved ? 1 : 0, moved ? 1 : 0, prev.id);
  const e = get('SELECT * FROM events WHERE id = ?', prev.id);
  if (moved && !e.cancelled && Date.parse(e.starts_at) > Date.now()) {
    const a = announceEvent(req.group, e, 'Перенесено');
    notifyMembers(req.group.id, a.text, { kind: 'meetings', buttons: a.buttons, except: req.user.id });
    if (req.body.toChat) notifyGroupChat(req.group.id, a.text, { buttons: a.buttons });
  }
  res.json(eventJson(e, req));
});

r.post('/events/:id/cancel', requireStaff, (req, res) => {
  const e = loadEvent(req);
  const cancelled = req.body.cancelled !== false;
  run('UPDATE events SET cancelled = ?, updated_at = ? WHERE id = ?', cancelled ? 1 : 0, nowIso(), e.id);
  if (cancelled && Date.parse(e.starts_at) > Date.now()) {
    const text = `❌ Отменено: <b>${esc(e.title)}</b> (${humanDateTime(e.starts_at, req.group.tz)})`;
    notifyMembers(req.group.id, text, { kind: 'meetings', except: req.user.id });
    if (req.body.toChat) notifyGroupChat(req.group.id, text);
  }
  res.json(eventJson(get('SELECT * FROM events WHERE id = ?', e.id), req));
});

r.delete('/events/:id', requireStaff, (req, res) => {
  const e = loadEvent(req);
  run('DELETE FROM activity WHERE group_id = ? AND kind = ? AND ref = ?', req.group.id, 'attend', String(e.id));
  run('DELETE FROM events WHERE id = ?', e.id);
  res.json({ ok: true });
});

// ---------- Отметка на встрече ----------
export function checkIn(group, event, userId) {
  run('INSERT OR IGNORE INTO attendance (event_id, user_id) VALUES (?, ?)', event.id, userId);
  addPoints(group.id, userId, 'attend', event.id);
  checkBadges(group.id, userId);
}

r.post('/events/:id/checkin', (req, res) => {
  const e = loadEvent(req);
  if (e.kind !== 'meeting' || e.cancelled) fail(400, 'На это событие отмечаться не нужно');
  if (!checkinWindow(e).open) fail(400, 'Отметиться можно за 30 минут до начала встречи и в течение часа после');
  if (String(req.body.code || '').trim().toUpperCase() !== e.checkin_code) fail(400, 'Неверный код. Спросите его у наставника или отсканируйте QR-код.');
  checkIn(req.group, e, req.user.id);
  res.json(eventJson(e, req));
});

// Ручная отметка командой (если у человека не получилось отсканировать)
r.post('/events/:id/attendance', requireStaff, (req, res) => {
  const e = loadEvent(req);
  const uid = +req.body.user_id;
  if (!get("SELECT 1 FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", req.group.id, uid)) fail(404, 'Человек не найден');
  if (req.body.present) checkIn(req.group, e, uid);
  else {
    run('DELETE FROM attendance WHERE event_id = ? AND user_id = ?', e.id, uid);
    removePoints(req.group.id, uid, 'attend', e.id);
  }
  res.json({ ok: true });
});

r.get('/events/:id/qr', requireStaff, (req, res) => {
  const e = loadEvent(req);
  const payload = `ci_${e.id}_${e.checkin_code}`;
  const link = botInfo().username ? startLink(payload) : payload;
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  res.json({ code: e.checkin_code, link, svg: qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }) });
});

// ---------- Анонимная обратная связь ----------
r.post('/events/:id/feedback', (req, res) => {
  const e = loadEvent(req);
  if (e.kind !== 'meeting' || e.cancelled) fail(400, 'Отзыв можно оставить только о встрече');
  if (Date.parse(e.starts_at) > Date.now()) fail(400, 'Встреча ещё не началась');
  if (req.role !== 'participant') fail(403, 'Отзывы оставляют участники');
  const rating = Math.round(+req.body.rating);
  if (!(rating >= 1 && rating <= 5)) fail(400, 'Поставьте оценку от 1 до 5');
  const hash = feedbackAuthorHash(e.id, req.user.id);
  const r2 = run(`INSERT OR IGNORE INTO feedback (event_id, group_id, rating, liked, improve, author_hash, created_day)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, e.id, req.group.id, rating, str(req.body.liked, 2000), str(req.body.improve, 2000), hash, localDate(new Date(), req.group.tz));
  if (!r2.changes) fail(400, 'Вы уже оставили отзыв об этой встрече');
  res.json({ ok: true });
});

function feedbackSummary(eventId) {
  const rows = all('SELECT rating, liked, improve FROM feedback WHERE event_id = ?', eventId);
  const dist = [1, 2, 3, 4, 5].map((n) => rows.filter((x) => x.rating === n).length);
  // случайный порядок, без времени — чтобы по очерёдности нельзя было угадать автора
  const comments = rows.filter((x) => x.liked || x.improve).map((x) => ({ rating: x.rating, liked: x.liked, improve: x.improve }))
    .sort(() => Math.random() - 0.5);
  return { count: rows.length, avg: rows.length ? Math.round((rows.reduce((s, x) => s + x.rating, 0) / rows.length) * 10) / 10 : null, dist, comments };
}

r.get('/events/:id/feedback', requireStaff, (req, res) => {
  const e = loadEvent(req);
  res.json({ event: { id: e.id, title: e.title, starts_at: e.starts_at }, ...feedbackSummary(e.id) });
});

r.get('/feedback', requireStaff, (req, res) => {
  const events = all(`SELECT e.id, e.title, e.starts_at, COUNT(f.id) AS count, ROUND(AVG(f.rating), 1) AS avg,
      (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS attendees
    FROM events e LEFT JOIN feedback f ON f.event_id = e.id
    WHERE e.group_id = ? AND e.kind = 'meeting' AND e.cancelled = 0 AND e.starts_at <= ?
    GROUP BY e.id ORDER BY e.starts_at DESC LIMIT 50`, req.group.id, nowIso());
  const total = get('SELECT COUNT(*) AS n, ROUND(AVG(rating), 2) AS avg FROM feedback WHERE group_id = ?', req.group.id);
  res.json({ events, total });
});
