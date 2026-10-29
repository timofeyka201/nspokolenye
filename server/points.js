import { get, all, run, parseJson } from './db.js';
import { monthStart } from './time.js';
import { notifyUser } from './notify.js';

// Сколько баллов активности даёт каждое действие. Анонимные действия (отзывы, вопросы) баллов не дают:
// иначе по начислению можно было бы понять, кто оставил отзыв.
export const POINTS = {
  chat_message: { points: 1, title: 'Сообщение в чате', note: 'до 10 в день' },
  attend: { points: 10, title: 'Пришёл на встречу' },
  poll_vote: { points: 2, title: 'Голос в опросе' },
  task_done: { points: 5, title: 'Выполнил задание' },
  goal_update: { points: 3, title: 'Отметил прогресс по цели', note: 'раз в день по каждой цели' },
  goal_step: { points: 2, title: 'Выполнил шаг цели' },
  goal_done: { points: 15, title: 'Достиг цели' },
  coffee_met: { points: 5, title: 'Встреча Random Coffee' },
  thanks_received: { points: 3, title: 'Получил «спасибо»' },
  thanks_given: { points: 1, title: 'Сказал «спасибо»', note: 'до 3 в день' },
  profile_complete: { points: 10, title: 'Заполнил профиль', note: 'один раз' },
};
export const CHAT_DAILY_CAP = 10;

export function addPoints(groupId, userId, kind, ref = '') {
  const p = POINTS[kind];
  if (!p || !groupId || !userId) return false;
  const r = run('INSERT OR IGNORE INTO activity (group_id, user_id, kind, ref, points) VALUES (?, ?, ?, ?, ?)',
    groupId, userId, kind, String(ref), p.points);
  return r.changes > 0;
}
export function removePoints(groupId, userId, kind, ref = '') {
  run('DELETE FROM activity WHERE group_id = ? AND user_id = ? AND kind = ? AND ref = ?', groupId, userId, kind, String(ref));
}

export const LEVELS = [
  { min: 120, code: 'fire', title: 'Огонь', emoji: '🔥' },
  { min: 60, code: 'high', title: 'Высокая', emoji: '⚡️' },
  { min: 20, code: 'mid', title: 'Средняя', emoji: '🌤' },
  { min: 1, code: 'low', title: 'Низкая', emoji: '🌱' },
  { min: 0, code: 'none', title: 'Пока нет', emoji: '💤' },
];
export const levelFor = (points) => LEVELS.find((l) => points >= l.min);

export const CHAT_LEVELS = [
  { min: 100, title: 'Душа чата' },
  { min: 30, title: 'Активно пишет' },
  { min: 1, title: 'Иногда пишет' },
  { min: 0, title: 'Пока молчит' },
];
export const chatLevelFor = (n) => CHAT_LEVELS.find((l) => n >= l.min);

// Рейтинг участников группы за месяц
export function ratings(group, date = new Date()) {
  const ms = monthStart(group.tz, date);
  const rows = all(`SELECT u.id AS user_id, u.first_name, u.last_name, u.username, u.photo_url, m.role,
      COALESCE((SELECT SUM(points) FROM activity a WHERE a.group_id = m.group_id AND a.user_id = u.id AND a.at >= ?), 0) AS act_points,
      COALESCE((SELECT SUM(MIN(messages, ${CHAT_DAILY_CAP})) FROM chat_stats c WHERE c.group_id = m.group_id AND c.tg_id = u.tg_id AND c.day >= ?), 0) AS chat_points,
      COALESCE((SELECT SUM(messages) FROM chat_stats c WHERE c.group_id = m.group_id AND c.tg_id = u.tg_id AND c.day >= ?), 0) AS chat_messages
    FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' AND m.role = 'participant'`, ms.iso, ms.day, ms.day, group.id);
  for (const r of rows) {
    r.points = r.act_points + r.chat_points;
    r.level = levelFor(r.points);
  }
  rows.sort((a, b) => b.points - a.points || a.first_name.localeCompare(b.first_name));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points; } r.rank = rank; });
  return { month: ms.key, rows };
}

// Активность одного человека: баллы за месяц по видам + сообщения в чате
export function userActivity(group, userId) {
  const ms = monthStart(group.tz);
  const u = get('SELECT tg_id FROM users WHERE id = ?', userId);
  const byKind = all(`SELECT kind, COUNT(*) AS count, SUM(points) AS points FROM activity
    WHERE group_id = ? AND user_id = ? AND at >= ? GROUP BY kind`, group.id, userId, ms.iso);
  const chat = get(`SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(MIN(messages, ${CHAT_DAILY_CAP})), 0) AS points
    FROM chat_stats WHERE group_id = ? AND tg_id = ? AND day >= ?`, group.id, u?.tg_id ?? -1, ms.day);
  const chatTotal = get('SELECT COALESCE(SUM(messages), 0) AS n FROM chat_stats WHERE group_id = ? AND tg_id = ?', group.id, u?.tg_id ?? -1).n;
  const points = byKind.reduce((s, k) => s + k.points, 0) + chat.points;
  return {
    month: ms.key,
    points,
    level: levelFor(points),
    chat: { messages: chat.messages, total: chatTotal, level: chatLevelFor(chat.messages) },
    byKind: [
      ...(chat.messages ? [{ kind: 'chat_message', title: POINTS.chat_message.title, count: chat.messages, points: chat.points }] : []),
      ...byKind.map((k) => ({ ...k, title: POINTS[k.kind]?.title || k.kind })),
    ].sort((a, b) => b.points - a.points),
  };
}

// ---------- Достижения ----------
export const BADGES = [
  { code: 'profile', emoji: '🪪', title: 'Всё о себе', desc: 'Полностью заполнить профиль' },
  { code: 'first_meeting', emoji: '👋', title: 'Первая встреча', desc: 'Отметиться на встрече' },
  { code: 'streak_5', emoji: '🔥', title: 'Без пропусков', desc: 'Прийти на 5 встреч подряд' },
  { code: 'goal_done', emoji: '🎯', title: 'В цель', desc: 'Достичь первой цели' },
  { code: 'goals_3', emoji: '🏹', title: 'Снайпер', desc: 'Достичь трёх целей' },
  { code: 'tasks_10', emoji: '✅', title: 'Исполнитель', desc: 'Выполнить 10 заданий' },
  { code: 'helper', emoji: '🤝', title: 'Помощник', desc: 'Получить 5 «спасибо»' },
  { code: 'grateful', emoji: '💛', title: 'Благодарный', desc: 'Сказать «спасибо» 10 раз' },
  { code: 'coffee_3', emoji: '☕️', title: 'Кофеман', desc: 'Встретиться в Random Coffee 3 раза' },
  { code: 'voter', emoji: '🗳', title: 'Активный голос', desc: 'Проголосовать в 10 опросах' },
  { code: 'chatter', emoji: '💬', title: 'Душа чата', desc: 'Написать 300 сообщений в чате' },
  { code: 'top1', emoji: '🏆', title: 'Лидер месяца', desc: 'Занять 1 место в рейтинге за месяц' },
];
const BADGE_BY_CODE = Object.fromEntries(BADGES.map((b) => [b.code, b]));

export function isProfileComplete(u) {
  return !!(u.first_name && u.last_name && u.birthdate && u.bio && u.can_help && u.need_help && parseJson(u.tags, []).length);
}

function longestMeetingStreak(groupId, userId) {
  const meetings = all(`SELECT e.id, (SELECT 1 FROM attendance a WHERE a.event_id = e.id AND a.user_id = ?) AS was
    FROM events e WHERE e.group_id = ? AND e.kind = 'meeting' AND e.cancelled = 0 AND e.starts_at <= ?
    AND e.starts_at >= (SELECT joined_at FROM members WHERE group_id = ? AND user_id = ?)
    ORDER BY e.starts_at`, userId, groupId, new Date().toISOString(), groupId, userId);
  let best = 0, cur = 0;
  for (const m of meetings) { cur = m.was ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

export function awardBadge(groupId, userId, code) {
  const r = run('INSERT OR IGNORE INTO badges (group_id, user_id, code) VALUES (?, ?, ?)', groupId, userId, code);
  if (r.changes) {
    const b = BADGE_BY_CODE[code];
    notifyUser(userId, `${b.emoji} Новое достижение: <b>${b.title}</b>\n${b.desc}`, {
      kind: 'badges', buttons: [[{ text: 'Мои достижения', app: '/badges' }]],
    });
  }
  return r.changes > 0;
}

export function checkBadges(groupId, userId) {
  if (!groupId || !userId) return;
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return;
  const c = (sql, ...p) => get(sql, ...p).n;
  const has = new Set(all('SELECT code FROM badges WHERE group_id = ? AND user_id = ?', groupId, userId).map((b) => b.code));
  const want = (code, ok) => { if (!has.has(code) && ok()) awardBadge(groupId, userId, code); };

  want('profile', () => isProfileComplete(u));
  want('first_meeting', () => c('SELECT COUNT(*) n FROM attendance a JOIN events e ON e.id = a.event_id WHERE e.group_id = ? AND a.user_id = ?', groupId, userId) > 0);
  want('streak_5', () => longestMeetingStreak(groupId, userId) >= 5);
  const goalsDone = () => c("SELECT COUNT(*) n FROM goals WHERE group_id = ? AND user_id = ? AND status = 'done'", groupId, userId);
  want('goal_done', () => goalsDone() >= 1);
  want('goals_3', () => goalsDone() >= 3);
  want('tasks_10', () => c('SELECT COUNT(*) n FROM task_done d JOIN tasks t ON t.id = d.task_id WHERE t.group_id = ? AND d.user_id = ?', groupId, userId) >= 10);
  want('helper', () => c('SELECT COUNT(*) n FROM thanks WHERE group_id = ? AND to_user = ?', groupId, userId) >= 5);
  want('grateful', () => c('SELECT COUNT(*) n FROM thanks WHERE group_id = ? AND from_user = ?', groupId, userId) >= 10);
  want('coffee_3', () => c('SELECT COUNT(*) n FROM coffee_pairs WHERE group_id = ? AND met = 1 AND ? IN (a, b, c)', groupId, userId) >= 3);
  want('voter', () => c('SELECT COUNT(DISTINCT v.poll_id) n FROM poll_votes v JOIN polls p ON p.id = v.poll_id WHERE p.group_id = ? AND v.user_id = ?', groupId, userId) >= 10);
  want('chatter', () => c('SELECT COALESCE(SUM(messages), 0) n FROM chat_stats WHERE group_id = ? AND tg_id = ?', groupId, u.tg_id ?? -1) >= 300);
}

export function userBadges(groupId, userId) {
  const got = new Map(all('SELECT code, at FROM badges WHERE group_id = ? AND user_id = ?', groupId, userId).map((b) => [b.code, b.at]));
  return BADGES.map((b) => ({ ...b, at: got.get(b.code) || null }));
}
