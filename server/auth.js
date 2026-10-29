import crypto from 'node:crypto';
import { get, run, nowIso, randomToken } from './db.js';
import { config } from './config.js';

export const ROLE_TITLES = { participant: 'Участник', mentor: 'Ментор', nastavnik: 'Наставник', curator: 'Куратор' };
export const STAFF_ROLES = ['mentor', 'nastavnik', 'curator'];

// Проверка данных, которые Telegram передаёт в Mini App (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
export function verifyInitData(initData, maxAgeSec = 86400) {
  if (!config.botToken || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = +params.get('auth_date');
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    return { user: JSON.parse(params.get('user')), startParam: params.get('start_param') || '' };
  } catch {
    return null;
  }
}

// Создать или обновить пользователя по данным Telegram. Имя и фамилию из Telegram берём,
// только пока человек не заполнил их сам в профиле.
export function upsertTelegramUser(tg, { botStarted = false } = {}) {
  let u = get('SELECT * FROM users WHERE tg_id = ?', tg.id);
  const isAdmin = config.adminIds.includes(Number(tg.id)) ? 1 : 0;
  if (!u) {
    run(`INSERT INTO users (tg_id, username, first_name, last_name, photo_url, is_admin, bot_started, cal_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      tg.id, tg.username || null, tg.first_name || '', tg.last_name || '', tg.photo_url || null, isAdmin, botStarted ? 1 : 0, randomToken(18));
  } else {
    run(`UPDATE users SET username = ?, photo_url = COALESCE(?, photo_url),
        first_name = CASE WHEN first_name = '' THEN ? ELSE first_name END,
        last_name = CASE WHEN last_name = '' THEN ? ELSE last_name END,
        is_admin = MAX(is_admin, ?), bot_started = MAX(bot_started, ?) WHERE id = ?`,
      tg.username || null, tg.photo_url || null, tg.first_name || '', tg.last_name || '', isAdmin, botStarted ? 1 : 0, u.id);
  }
  return get('SELECT * FROM users WHERE tg_id = ?', tg.id);
}

export function createSession(userId) {
  const token = randomToken(32);
  run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, userId);
  return token;
}

export function userBySession(token) {
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token = ?', token);
  if (!s) return null;
  // last_seen обновляем не чаще раза в 10 минут, чтобы не писать в базу на каждый запрос
  if (Date.now() - Date.parse(s.last_seen) > 600_000) run('UPDATE sessions SET last_seen = ? WHERE token = ?', nowIso(), token);
  return get('SELECT * FROM users WHERE id = ?', s.user_id);
}

export function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = userBySession(token);
  if (!user) return res.status(401).json({ error: 'Нужно войти' });
  req.user = user;
  req.token = token;
  next();
}

// Доступ к группе: /api/g/:gid/... Главный администратор видит любую группу с правами куратора.
export function groupScope(req, res, next) {
  const gid = +req.params.gid;
  const group = get('SELECT * FROM groups WHERE id = ?', gid);
  if (!group) return res.status(404).json({ error: 'Группа не найдена' });
  const m = get('SELECT * FROM members WHERE group_id = ? AND user_id = ?', gid, req.user.id);
  if (m?.status === 'active') req.role = m.role;
  else if (req.user.is_admin) req.role = 'curator';
  else return res.status(403).json({ error: m?.status === 'pending' ? 'Заявка ещё не одобрена' : 'Вы не состоите в этой группе' });
  req.group = group;
  req.member = m;
  req.isStaff = STAFF_ROLES.includes(req.role);
  req.isCurator = req.role === 'curator' || !!req.user.is_admin;
  next();
}

export function requireStaff(req, res, next) {
  if (!req.isStaff) return res.status(403).json({ error: 'Доступно наставникам, менторам и кураторам' });
  next();
}
export function requireCurator(req, res, next) {
  if (!req.isCurator) return res.status(403).json({ error: 'Доступно только куратору' });
  next();
}
