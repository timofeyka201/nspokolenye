import { get, all, run, nowIso, parseJson } from './db.js';
import { localParts, zonedToUtc } from './time.js';

// Все сообщения бота идут через очередь: так соблюдаются «тихие часы»,
// лимиты Telegram и повторы при ошибках сети. Отправку подключает bot.js через setSender.
let sender = null;
export const setSender = (fn) => { sender = fn; };

// Виды уведомлений, которые можно отключить в настройках
export const NOTIFY_KINDS = {
  meetings: 'Напоминания о встречах и эфирах',
  deadlines: 'Дедлайны и задания',
  polls: 'Новые опросы',
  coffee: 'Random Coffee',
  questions: 'Анонимные вопросы и ответы',
  posts: 'Объявления',
  feedback: 'Просьба оценить встречу',
  badges: 'Новые достижения',
};

export function wantsNotify(user, kind) {
  if (!kind) return true;
  return parseJson(user.notify, {})[kind] !== false;
}

// buttons: [[{ text, url } | { text, app: '/path' } | { text, data }]]
export function notifyUser(userId, text, { buttons = null, kind = null, quiet = true, delayMs = 0 } = {}) {
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  if (!u?.tg_id || !u.bot_started || !wantsNotify(u, kind)) return;
  run('INSERT INTO notifications (user_id, text, buttons, send_after, respect_quiet) VALUES (?, ?, ?, ?, ?)',
    userId, text, buttons ? JSON.stringify(buttons) : null, new Date(Date.now() + delayMs).toISOString(), quiet ? 1 : 0);
}

export function notifyGroupChat(groupId, text, { buttons = null } = {}) {
  const g = get('SELECT chat_id FROM groups WHERE id = ?', groupId);
  if (!g?.chat_id) return;
  run('INSERT INTO notifications (chat_id, text, buttons, respect_quiet) VALUES (?, ?, ?, 0)',
    g.chat_id, text, buttons ? JSON.stringify(buttons) : null);
}

export function notifyMembers(groupId, text, { kind = null, buttons = null, roles = null, except = null } = {}) {
  const members = all("SELECT user_id, role FROM members WHERE group_id = ? AND status = 'active'", groupId);
  for (const m of members) {
    if (roles && !roles.includes(m.role)) continue;
    if (m.user_id === except) continue;
    notifyUser(m.user_id, text, { kind, buttons });
  }
}

// Если сейчас «тихие часы» пользователя — вернуть момент, когда они закончатся
function quietUntil(user, now = new Date()) {
  if (!user?.quiet_from || !user?.quiet_to) return null;
  const tz = user.tz || 'Europe/Moscow';
  const p = localParts(now, tz);
  const cur = p.hour * 60 + p.minute;
  const [fh, fm] = user.quiet_from.split(':').map(Number);
  const [th, tm] = user.quiet_to.split(':').map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  const inQuiet = from <= to ? cur >= from && cur < to : cur >= from || cur < to;
  if (!inQuiet) return null;
  const end = zonedToUtc(p.year, p.month, p.day, th, tm, tz);
  if (end <= now) end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

let flushing = false;
export async function flushNotifications() {
  if (flushing || !sender) return;
  flushing = true;
  try {
    const now = new Date();
    const rows = all(`SELECT n.*, u.tg_id, u.quiet_from, u.quiet_to, u.tz FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      WHERE n.sent_at IS NULL AND n.send_after <= ? AND n.attempts < 5 ORDER BY n.id LIMIT 60`, now.toISOString());
    for (const n of rows) {
      if (n.user_id && n.respect_quiet) {
        const until = quietUntil(n, now);
        if (until) { run('UPDATE notifications SET send_after = ? WHERE id = ?', until.toISOString(), n.id); continue; }
      }
      const chatId = n.chat_id ?? n.tg_id;
      if (!chatId) { run('UPDATE notifications SET sent_at = ? WHERE id = ?', nowIso(), n.id); continue; }
      try {
        await sender(chatId, n.text, parseJson(n.buttons, null));
        run('UPDATE notifications SET sent_at = ? WHERE id = ?', nowIso(), n.id);
      } catch (e) {
        const code = e?.error_code;
        // 403: пользователь заблокировал бота — больше не пишем ему
        if (code === 403 && n.user_id) {
          run('UPDATE users SET bot_started = 0 WHERE id = ?', n.user_id);
          run('UPDATE notifications SET sent_at = ? WHERE id = ?', nowIso(), n.id);
        } else {
          const retry = new Date(Date.now() + 60_000 * (n.attempts + 1)).toISOString();
          run('UPDATE notifications SET attempts = attempts + 1, send_after = ? WHERE id = ?', retry, n.id);
          console.error('Не удалось отправить уведомление', n.id, e?.description || e?.message);
        }
      }
      await new Promise((r) => setTimeout(r, 45)); // не больше ~20 сообщений в секунду
    }
    run("DELETE FROM notifications WHERE sent_at IS NOT NULL AND sent_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')");
  } finally {
    flushing = false;
  }
}
