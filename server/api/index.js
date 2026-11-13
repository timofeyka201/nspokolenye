import express from 'express';
import qrcode from 'qrcode-generator';
import { get, all, run, tx, randomToken, randomCode, parseJson } from '../db.js';
import { config } from '../config.js';
import {
  verifyInitData, upsertTelegramUser, createSession, requireAuth, groupScope, ROLE_TITLES, STAFF_ROLES,
} from '../auth.js';
import { NOTIFY_KINDS } from '../notify.js';
import { addPoints, checkBadges, isProfileComplete } from '../points.js';
import { botInfo, startLink } from '../bot.js';
import { joinGroup } from '../membership.js';
import { str, dateOrNull, fail, userProfile } from './util.js';
import { groupRouter } from './group.js';
import { eventsRouter } from './events.js';
import { goalsRouter } from './goals.js';
import { contentRouter } from './content.js';
import { socialRouter } from './social.js';

export const api = express.Router();

api.get('/config', (req, res) => {
  res.json({ botUsername: botInfo().username, devLogin: config.devLogin, publicUrl: config.publicUrl });
});

// ---------- Вход ----------
// 1) Внутри Telegram Mini App: проверяем подпись initData
api.post('/auth/telegram', (req, res) => {
  const data = verifyInitData(req.body.initData);
  if (!data?.user) fail(401, 'Не удалось проверить данные Telegram. Откройте приложение заново из бота.');
  const user = upsertTelegramUser(data.user);
  res.json({ token: createSession(user.id), startParam: data.startParam });
});

// 2) В браузере: сайт создаёт одноразовый токен, человек подтверждает вход в боте, сайт забирает сессию
api.post('/auth/login/start', (req, res) => {
  if (!botInfo().username) fail(503, 'Бот ещё не подключён');
  const token = randomToken(18);
  run('INSERT INTO login_requests (token) VALUES (?)', token);
  const link = startLink(`login_${token}`);
  // QR-код — чтобы войти с компьютера, отсканировав его телефоном
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  res.json({ token, link, qr: qr.createSvgTag({ cellSize: 6, margin: 1, scalable: true }) });
});
api.get('/auth/login/poll', (req, res) => {
  const r = get('SELECT * FROM login_requests WHERE token = ?', String(req.query.token || ''));
  if (!r || Date.now() - Date.parse(r.created_at) > 15 * 60_000) return res.json({ status: 'expired' });
  if (!r.user_id) return res.json({ status: 'pending' });
  run('DELETE FROM login_requests WHERE token = ?', r.token);
  res.json({ status: 'ok', token: createSession(r.user_id) });
});

// 3) Только для проверки на своём компьютере (DEV_LOGIN=1)
api.post('/auth/dev', (req, res) => {
  if (!config.devLogin) fail(404, 'Not found');
  const name = str(req.body.name, 60) || 'Тестовый Пользователь';
  const tgId = -Math.abs(Number(req.body.tgId) || Math.floor(Math.random() * 1e9));
  const [first_name, ...rest] = name.split(' ');
  const user = upsertTelegramUser({ id: tgId, first_name, last_name: rest.join(' '), username: req.body.username }, { botStarted: true });
  if (req.body.admin) run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
  res.json({ token: createSession(user.id) });
});

api.use(requireAuth);

api.post('/auth/logout', (req, res) => {
  run('DELETE FROM sessions WHERE token = ?', req.token);
  res.json({ ok: true });
});

// ---------- Я ----------
function myGroups(userId, isAdmin) {
  return all(`SELECT g.id, g.name, g.chat_id IS NOT NULL AS chat_linked, m.role, m.status
    FROM members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? AND m.status != 'left' ORDER BY g.name`, userId)
    .map((g) => ({ ...g, chat_linked: !!g.chat_linked, role_title: ROLE_TITLES[g.role], is_staff: STAFF_ROLES.includes(g.role), is_curator: g.role === 'curator' || isAdmin }));
}

function mePayload(u) {
  let groups = myGroups(u.id, !!u.is_admin);
  // главный администратор видит все группы
  if (u.is_admin) {
    const mine = new Set(groups.map((g) => g.id));
    const others = all('SELECT id, name, chat_id IS NOT NULL AS chat_linked FROM groups ORDER BY name').filter((g) => !mine.has(g.id));
    groups = groups.concat(others.map((g) => ({ ...g, chat_linked: !!g.chat_linked, role: 'curator', status: 'active', role_title: 'Администратор', is_staff: true, is_curator: true, admin_view: true })));
  }
  const calHttp = `${config.publicUrl}/cal/${u.cal_token}.ics`;
  return {
    user: { ...userProfile(u, { self: true }), is_admin: !!u.is_admin, onboarded: !!u.onboarded, current_group: u.current_group, profile_complete: isProfileComplete(u) },
    groups,
    settings: { notify: { ...Object.fromEntries(Object.keys(NOTIFY_KINDS).map((k) => [k, true])), ...parseJson(u.notify, {}) }, quiet_from: u.quiet_from, quiet_to: u.quiet_to, tz: u.tz },
    notifyKinds: NOTIFY_KINDS,
    calendar: { http: calHttp, webcal: calHttp.replace(/^https?:/, 'webcal:') },
    bot: { username: botInfo().username, startLink: botInfo().username ? startLink('verify') : null },
  };
}

api.get('/me', (req, res) => res.json(mePayload(req.user)));

api.patch('/me', (req, res) => {
  const u = req.user;
  const b = req.body;
  const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map((t) => str(t, 30)).filter(Boolean))].slice(0, 15) : parseJson(u.tags, []);
  const next = {
    first_name: b.first_name !== undefined ? str(b.first_name, 40, { required: true, label: 'Имя' }) : u.first_name,
    last_name: b.last_name !== undefined ? str(b.last_name, 60) : u.last_name,
    birthdate: b.birthdate !== undefined ? dateOrNull(b.birthdate) : u.birthdate,
    bio: b.bio !== undefined ? str(b.bio, 1000) : u.bio,
    can_help: b.can_help !== undefined ? str(b.can_help, 500) : u.can_help,
    need_help: b.need_help !== undefined ? str(b.need_help, 500) : u.need_help,
    tags: JSON.stringify(tags),
  };
  const onboarded = b.onboarded ? 1 : u.onboarded;
  let current = u.current_group;
  if (b.current_group !== undefined) current = b.current_group ? +b.current_group : null;
  run(`UPDATE users SET first_name = ?, last_name = ?, birthdate = ?, bio = ?, can_help = ?, need_help = ?, tags = ?, onboarded = ?, current_group = ? WHERE id = ?`,
    next.first_name, next.last_name, next.birthdate, next.bio, next.can_help, next.need_help, next.tags, onboarded, current, u.id);
  const fresh = get('SELECT * FROM users WHERE id = ?', u.id);
  if (isProfileComplete(fresh)) {
    for (const g of myGroups(u.id, !!u.is_admin).filter((g) => g.status === 'active')) {
      addPoints(g.id, u.id, 'profile_complete');
      checkBadges(g.id, u.id);
    }
  }
  res.json(mePayload(fresh));
});

api.patch('/me/settings', (req, res) => {
  const u = req.user;
  const notify = { ...parseJson(u.notify, {}) };
  for (const k of Object.keys(NOTIFY_KINDS)) if (typeof req.body.notify?.[k] === 'boolean') notify[k] = req.body.notify[k];
  const time = (v) => (v && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const quiet_from = req.body.quiet_from !== undefined ? time(req.body.quiet_from) : u.quiet_from;
  const quiet_to = req.body.quiet_to !== undefined ? time(req.body.quiet_to) : u.quiet_to;
  let tz = u.tz;
  if (req.body.tz) {
    try { new Intl.DateTimeFormat('ru', { timeZone: req.body.tz }); tz = req.body.tz; } catch { fail(400, 'Неизвестный часовой пояс'); }
  }
  run('UPDATE users SET notify = ?, quiet_from = ?, quiet_to = ?, tz = ? WHERE id = ?', JSON.stringify(notify), quiet_from, quiet_to, tz, u.id);
  res.json(mePayload(get('SELECT * FROM users WHERE id = ?', u.id)));
});

api.post('/me/calendar/reset', (req, res) => {
  run('UPDATE users SET cal_token = ? WHERE id = ?', randomToken(18), req.user.id);
  res.json(mePayload(get('SELECT * FROM users WHERE id = ?', req.user.id)));
});

// ---------- Вступление в группу и создание группы ----------
api.post('/join', async (req, res) => {
  const r = await joinGroup(req.user, req.body.code);
  res.json({ status: r.status, group: { id: r.group.id, name: r.group.name }, me: mePayload(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

api.post('/groups', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Создавать группы может только главный администратор');
  const name = str(req.body.name, 80, { required: true, label: 'Название' });
  const id = tx(() => {
    const r = run('INSERT INTO groups (name, invite_code, tz) VALUES (?, ?, ?)', name, randomCode(10), req.user.tz || 'Europe/Moscow');
    run("INSERT INTO members (group_id, user_id, role, status) VALUES (?, ?, 'curator', 'active')", r.lastInsertRowid, req.user.id);
    run('UPDATE users SET current_group = ? WHERE id = ?', r.lastInsertRowid, req.user.id);
    return Number(r.lastInsertRowid);
  });
  res.json({ id, me: mePayload(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// ---------- Всё внутри группы ----------
const g = express.Router({ mergeParams: true });
g.use(groupScope);
g.use(groupRouter);
g.use(eventsRouter);
g.use(goalsRouter);
g.use(contentRouter);
g.use(socialRouter);
api.use('/g/:gid', g);

api.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
api.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' });
});
