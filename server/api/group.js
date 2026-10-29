import express from 'express';
import { get, all, run, randomCode, parseJson, nowIso } from '../db.js';
import { requireStaff, requireCurator, ROLE_TITLES, STAFF_ROLES } from '../auth.js';
import { ratings, userActivity, userBadges } from '../points.js';
import { notifyUser } from '../notify.js';
import { feedbackAuthorHash, questionAuthorHash } from '../anon.js';
import { startLink, appLink, botInfo } from '../bot.js';
import { localParts } from '../time.js';
import { checkinWindow } from './events.js';
import { eventIcsUrl, googleCalendarUrl } from '../ical.js';
import { fail, str, userCard, userProfile } from './util.js';

export const groupRouter = express.Router({ mergeParams: true });
const r = groupRouter;

const groupInfo = (req) => ({
  id: req.group.id, name: req.group.name, tz: req.group.tz, chat_linked: !!req.group.chat_id, chat_title: req.group.chat_title,
  role: req.role, role_title: ROLE_TITLES[req.role], is_staff: req.isStaff, is_curator: req.isCurator,
});

// Дни рождения в ближайшие 7 дней (по поясу группы)
function upcomingBirthdays(groupId, tz) {
  const today = localParts(new Date(), tz);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    days.push({ md: d.toISOString().slice(5, 10), in: i });
  }
  const people = all(`SELECT u.* FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' AND u.birthdate IS NOT NULL`, groupId);
  const res = [];
  for (const d of days) for (const u of people) if (u.birthdate.slice(5) === d.md) res.push({ ...userCard(u), in_days: d.in, birthday: d.md });
  return res;
}

// ---------- Главная ----------
r.get('/home', (req, res) => {
  const gid = req.group.id, me = req.user.id, now = nowIso();
  const events = all(`SELECT e.*, (SELECT 1 FROM attendance a WHERE a.event_id = e.id AND a.user_id = ?) AS checked_in
    FROM events e WHERE e.group_id = ? AND e.cancelled = 0 AND COALESCE(e.ends_at, e.starts_at) >= ? ORDER BY e.starts_at LIMIT 4`, me, gid, now)
    .map(({ checkin_code, ...e }) => ({
      ...e, checked_in: !!e.checked_in, cancelled: !!e.cancelled,
      can_checkin: e.kind === 'meeting' && !e.checked_in && checkinWindow(e).open,
      ics_url: eventIcsUrl(e.id), google_url: googleCalendarUrl(e),
    }));

  const polls = all(`SELECT p.id, p.question, p.closes_at,
      (SELECT COUNT(DISTINCT user_id) FROM poll_votes v WHERE v.poll_id = p.id) AS voters
    FROM polls p WHERE p.group_id = ? AND p.closed = 0
      AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = p.id AND v.user_id = ?)
    ORDER BY p.created_at DESC LIMIT 3`, gid, me);

  const tasks = all(`SELECT t.id, t.title, t.due_at FROM tasks t WHERE t.group_id = ?
      AND NOT EXISTS (SELECT 1 FROM task_done d WHERE d.task_id = t.id AND d.user_id = ?)
      AND (t.due_at IS NULL OR t.due_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'))
    ORDER BY t.due_at IS NULL, t.due_at LIMIT 3`, gid, me);

  const posts = all(`SELECT p.*, u.first_name, u.last_name, u.username, u.photo_url FROM posts p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.group_id = ? ORDER BY p.pinned DESC, p.created_at DESC LIMIT 3`, gid)
    .map((p) => ({ id: p.id, text: p.text, pinned: !!p.pinned, created_at: p.created_at, author: userCard({ ...p, id: p.created_by }) }));

  // Встречи за последние 3 дня, на которые я ещё не оставил отзыв (только участникам)
  const feedbackDue = req.role === 'participant' ? all(`SELECT id, title, starts_at FROM events WHERE group_id = ? AND kind = 'meeting' AND cancelled = 0
      AND COALESCE(ends_at, starts_at) <= ? AND starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days') ORDER BY starts_at DESC`, gid, now)
    .filter((e) => !get('SELECT 1 FROM feedback WHERE event_id = ? AND author_hash = ?', e.id, feedbackAuthorHash(e.id, me))) : [];

  const coffeeRound = get('SELECT * FROM coffee_rounds WHERE group_id = ? ORDER BY week DESC LIMIT 1', gid);
  let coffee = null;
  if (coffeeRound) {
    const p = get('SELECT * FROM coffee_pairs WHERE round_id = ? AND ? IN (a, b, c)', coffeeRound.id, me);
    if (p) {
      const partners = [p.a, p.b, p.c].filter((x) => x && x !== me).map((id) => userCard(get('SELECT * FROM users WHERE id = ?', id)));
      coffee = { pair_id: p.id, week: coffeeRound.week, met: !!p.met, partners };
    }
  }

  const rt = ratings(req.group);
  const mine = rt.rows.find((x) => x.user_id === me);
  const act = userActivity(req.group, me);

  const goals = get(`SELECT COUNT(*) AS active, COALESCE(ROUND(AVG(progress)), 0) AS avg FROM goals WHERE group_id = ? AND user_id = ? AND status = 'active'`, gid, me);

  const inbox = get('SELECT COUNT(*) AS n FROM questions WHERE group_id = ? AND to_user = ? AND answer IS NULL AND hidden = 0', gid, me).n;
  const newAnswers = get(`SELECT COUNT(*) AS n FROM questions WHERE group_id = ? AND author_hash = ? AND answer IS NOT NULL
    AND answered_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`, gid, questionAuthorHash(gid, me)).n;

  const staff = req.isStaff ? {
    pending: get("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'pending'", gid).n,
    members: get("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'active'", gid).n,
    feedback_week: get(`SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM feedback WHERE group_id = ? AND created_day >= date('now','-7 days')`, gid),
  } : null;

  res.json({
    group: groupInfo(req),
    events, polls, tasks, posts, feedbackDue, coffee,
    goals,
    questions: { inbox, newAnswers },
    activity: { points: act.points, level: act.level, chat: act.chat, rank: mine?.rank ?? null, total: rt.rows.length },
    top: rt.rows.filter((x) => x.points > 0).slice(0, 5).map((x) => ({ ...userCard(x), points: x.points, rank: x.rank })),
    birthdays: upcomingBirthdays(gid, req.group.tz),
    staff,
  });
});

// ---------- Люди ----------
r.get('/members', (req, res) => {
  const rows = all(`SELECT u.*, m.role, m.status, m.coffee, m.joined_at FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status ${req.isStaff ? "IN ('active','pending')" : "= 'active'"}
    ORDER BY CASE m.role WHEN 'nastavnik' THEN 0 WHEN 'mentor' THEN 1 WHEN 'curator' THEN 2 ELSE 3 END, u.first_name`, req.group.id);
  res.json({
    members: rows.filter((u) => u.status === 'active').map((u) => ({ ...userCard(u), role: u.role, role_title: ROLE_TITLES[u.role], tags: parseJson(u.tags, []), verified: !!u.bot_started, can_help: u.can_help })),
    pending: req.isStaff ? rows.filter((u) => u.status === 'pending').map((u) => ({ ...userCard(u), joined_at: u.joined_at, verified: !!u.bot_started })) : [],
    roles: ROLE_TITLES,
  });
});

r.get('/members/:uid', (req, res) => {
  const uid = +req.params.uid;
  const u = get(`SELECT u.*, m.role, m.status, m.coffee FROM members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.user_id = ?`, req.group.id, uid);
  if (!u || (u.status !== 'active' && !req.isStaff)) fail(404, 'Человек не найден');
  const self = uid === req.user.id;
  const goals = all(`SELECT id, title, status, progress, due_date, updated_at FROM goals WHERE group_id = ? AND user_id = ? AND status != 'archived'
    ORDER BY status = 'done', updated_at DESC`, req.group.id, uid);
  const act = userActivity(req.group, uid);
  const rt = ratings(req.group).rows.find((x) => x.user_id === uid);
  const thanks = all(`SELECT t.text, t.created_at, f.first_name, f.last_name, f.username, f.photo_url, f.id FROM thanks t JOIN users f ON f.id = t.from_user
    WHERE t.group_id = ? AND t.to_user = ? ORDER BY t.created_at DESC LIMIT 20`, req.group.id, uid)
    .map((t) => ({ text: t.text, created_at: t.created_at, from: userCard(t) }));
  res.json({
    profile: { ...userProfile(u, { self, staff: req.isStaff }), role: u.role, role_title: ROLE_TITLES[u.role], status: u.status, coffee: !!u.coffee },
    goals,
    activity: { level: act.level, chat: act.chat, ...(self || req.isStaff ? { points: act.points, rank: rt?.rank ?? null, byKind: act.byKind } : {}) },
    badges: userBadges(req.group.id, uid).filter((b) => b.at),
    thanks,
    self,
  });
});

r.post('/members/:uid/approve', requireStaff, (req, res) => {
  const uid = +req.params.uid;
  const ch = run("UPDATE members SET status = 'active' WHERE group_id = ? AND user_id = ? AND status = 'pending'", req.group.id, uid);
  if (!ch.changes) fail(404, 'Заявка не найдена');
  run('UPDATE users SET current_group = COALESCE(current_group, ?) WHERE id = ?', req.group.id, uid);
  notifyUser(uid, `🎉 Добро пожаловать в группу «${req.group.name}»! Заявку одобрили.`, {
    quiet: false, buttons: [[{ text: 'Открыть приложение', app: '/' }]],
  });
  res.json({ ok: true });
});

r.delete('/members/:uid', requireStaff, (req, res) => {
  const uid = +req.params.uid;
  const m = get('SELECT * FROM members WHERE group_id = ? AND user_id = ?', req.group.id, uid);
  if (!m) fail(404, 'Человек не найден');
  if (STAFF_ROLES.includes(m.role) && !req.isCurator) fail(403, 'Удалить из команды может только куратор');
  if (uid === req.user.id) fail(400, 'Чтобы выйти из группы, используйте «Покинуть группу»');
  run(m.status === 'pending' ? 'DELETE FROM members WHERE group_id = ? AND user_id = ?' : "UPDATE members SET status = 'left', coffee = 0 WHERE group_id = ? AND user_id = ?", req.group.id, uid);
  res.json({ ok: true });
});

r.patch('/members/:uid', requireCurator, (req, res) => {
  const uid = +req.params.uid;
  const role = String(req.body.role || '');
  if (!ROLE_TITLES[role]) fail(400, 'Неизвестная роль');
  const m = get("SELECT * FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", req.group.id, uid);
  if (!m) fail(404, 'Человек не найден');
  if (m.role === 'curator' && role !== 'curator') {
    const curators = get("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND role = 'curator' AND status = 'active'", req.group.id).n;
    if (curators <= 1) fail(400, 'В группе должен остаться хотя бы один куратор');
  }
  run('UPDATE members SET role = ? WHERE group_id = ? AND user_id = ?', role, req.group.id, uid);
  if (role !== m.role) notifyUser(uid, `Ваша роль в группе «${req.group.name}»: <b>${ROLE_TITLES[role]}</b>`, { quiet: false });
  res.json({ ok: true });
});

r.post('/leave', (req, res) => {
  if (req.role === 'curator') {
    const curators = get("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND role = 'curator' AND status = 'active'", req.group.id).n;
    if (curators <= 1) fail(400, 'Вы единственный куратор. Сначала назначьте другого куратора.');
  }
  run("UPDATE members SET status = 'left', coffee = 0 WHERE group_id = ? AND user_id = ?", req.group.id, req.user.id);
  run('UPDATE users SET current_group = NULL WHERE id = ? AND current_group = ?', req.user.id, req.group.id);
  res.json({ ok: true });
});

// ---------- Настройки группы ----------
function adminPayload(req) {
  const g = get('SELECT * FROM groups WHERE id = ?', req.group.id);
  return {
    group: { id: g.id, name: g.name, tz: g.tz, chat_linked: !!g.chat_id, chat_title: g.chat_title },
    invite: { code: g.invite_code, bot: botInfo().username ? startLink(`join_${g.invite_code}`) : null, app: botInfo().username ? appLink(`join_${g.invite_code}`) : null },
    link_code: req.isCurator ? g.link_code : null,
    bot_username: botInfo().username,
    can_edit: req.isCurator,
  };
}
r.get('/admin', requireStaff, (req, res) => res.json(adminPayload(req)));

r.patch('/admin', requireCurator, (req, res) => {
  const name = req.body.name !== undefined ? str(req.body.name, 80, { required: true, label: 'Название' }) : req.group.name;
  let tz = req.group.tz;
  if (req.body.tz) {
    try { new Intl.DateTimeFormat('ru', { timeZone: req.body.tz }); tz = req.body.tz; } catch { fail(400, 'Неизвестный часовой пояс'); }
  }
  run('UPDATE groups SET name = ?, tz = ? WHERE id = ?', name, tz, req.group.id);
  req.group = get('SELECT * FROM groups WHERE id = ?', req.group.id);
  res.json(adminPayload(req));
});

r.post('/admin/invite-reset', requireCurator, (req, res) => {
  run('UPDATE groups SET invite_code = ? WHERE id = ?', randomCode(10), req.group.id);
  res.json(adminPayload(req));
});

// Код для привязки чата: в чате нужно отправить боту /setup КОД
r.post('/admin/link-code', requireCurator, (req, res) => {
  run('UPDATE groups SET link_code = ? WHERE id = ?', randomCode(6).toUpperCase(), req.group.id);
  res.json(adminPayload(req));
});

r.post('/admin/unlink-chat', requireCurator, (req, res) => {
  run('UPDATE groups SET chat_id = NULL, chat_title = NULL WHERE id = ?', req.group.id);
  req.group = get('SELECT * FROM groups WHERE id = ?', req.group.id);
  res.json(adminPayload(req));
});

