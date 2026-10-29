import { get, all, run, markOnce } from './db.js';
import { flushNotifications, notifyUser, notifyMembers, notifyGroupChat } from './notify.js';
import { ratings, awardBadge } from './points.js';
import { closePoll } from './api/content.js';
import { localParts, localDate, weekKey, prevMonthStart, humanDateTime, humanTime } from './time.js';
import { esc, fullName } from './api/util.js';

// Фоновые задачи: раз в минуту проверяем, не пора ли что-то напомнить или подвести итоги
const MIN = 60_000, HOUR = 60 * MIN;
const KIND_EMOJI = { meeting: '🤝', stream: '📺', deadline: '⏰', other: '📌' };

function eventReminders(now) {
  const t = now.getTime();
  const upcoming = all(`SELECT e.*, g.tz FROM events e JOIN groups g ON g.id = e.group_id
    WHERE e.cancelled = 0 AND e.starts_at > ? AND e.starts_at <= ? AND (e.reminded_day = 0 OR e.reminded_hour = 0)`,
  now.toISOString(), new Date(t + 24 * HOUR).toISOString());
  for (const e of upcoming) {
    const left = Date.parse(e.starts_at) - t;
    const place = `${e.location ? `\n📍 ${esc(e.location)}` : ''}${e.url ? `\n🔗 ${esc(e.url)}` : ''}`;
    const buttons = [[{ text: 'Подробнее', app: `/event/${e.id}` }]];
    if (e.kind === 'deadline') {
      if (!e.reminded_day) {
        notifyMembers(e.group_id, `⏰ Завтра дедлайн: <b>${esc(e.title)}</b>\n🗓 ${humanDateTime(e.starts_at, e.tz)}`, { kind: 'deadlines', buttons });
        run('UPDATE events SET reminded_day = 1, reminded_hour = 1 WHERE id = ?', e.id);
      }
      continue;
    }
    if (left <= HOUR && !e.reminded_hour) {
      const text = `${KIND_EMOJI[e.kind]} Через ${Math.max(1, Math.round(left / MIN))} мин: <b>${esc(e.title)}</b>${place}`;
      notifyMembers(e.group_id, text, { kind: 'meetings', buttons });
      notifyGroupChat(e.group_id, text, { buttons });
      run('UPDATE events SET reminded_day = 1, reminded_hour = 1 WHERE id = ?', e.id);
    } else if (left > 2 * HOUR && !e.reminded_day) {
      const text = `${KIND_EMOJI[e.kind]} Напоминаю: <b>${esc(e.title)}</b>\n🗓 ${humanDateTime(e.starts_at, e.tz)}${e.ends_at ? `–${humanTime(e.ends_at, e.tz)}` : ''}${place}`;
      notifyMembers(e.group_id, text, { kind: 'meetings', buttons });
      notifyGroupChat(e.group_id, text, { buttons });
      run('UPDATE events SET reminded_day = 1 WHERE id = ?', e.id);
    }
  }

  // Задания: за сутки напоминаем тем, кто ещё не сдал
  const tasks = all(`SELECT t.*, g.tz FROM tasks t JOIN groups g ON g.id = t.group_id
    WHERE t.reminded = 0 AND t.due_at > ? AND t.due_at <= ?`, now.toISOString(), new Date(t + 24 * HOUR).toISOString());
  for (const task of tasks) {
    const todo = all(`SELECT m.user_id FROM members m WHERE m.group_id = ? AND m.status = 'active' AND m.role = 'participant'
      AND NOT EXISTS (SELECT 1 FROM task_done d WHERE d.task_id = ? AND d.user_id = m.user_id)`, task.group_id, task.id);
    for (const m of todo) {
      notifyUser(m.user_id, `📝 Скоро дедлайн задания <b>${esc(task.title)}</b>\n⏰ ${humanDateTime(task.due_at, task.tz)}`,
        { kind: 'deadlines', buttons: [[{ text: 'Открыть задание', app: `/task/${task.id}` }]] });
    }
    run('UPDATE tasks SET reminded = 1 WHERE id = ?', task.id);
  }
}

// После встречи просим участников оценить её — анонимно, прямо кнопками в боте
function feedbackPrompts(now) {
  const t = now.getTime();
  const events = all(`SELECT * FROM events WHERE kind = 'meeting' AND cancelled = 0 AND feedback_sent = 0 AND starts_at <= ?`, now.toISOString());
  for (const e of events) {
    const end = e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 2 * HOUR;
    if (end > t) continue;
    run('UPDATE events SET feedback_sent = 1 WHERE id = ?', e.id);
    if (t - end > 12 * HOUR) continue; // давно прошла — не беспокоим
    const attended = all('SELECT user_id FROM attendance WHERE event_id = ?', e.id).map((a) => a.user_id);
    const participants = all("SELECT user_id FROM members WHERE group_id = ? AND status = 'active' AND role = 'participant'", e.group_id).map((m) => m.user_id);
    const targets = attended.length ? participants.filter((id) => attended.includes(id)) : participants;
    for (const uid of targets) {
      notifyUser(uid, `Как прошла встреча «<b>${esc(e.title)}</b>»?\n\nОценка анонимная: наставник увидит только оценки и комментарии, но не авторов.`, {
        kind: 'feedback',
        buttons: [[1, 2, 3, 4, 5].map((n) => ({ text: `${n} ⭐️`, data: `fb:${e.id}:${n}` })), [{ text: 'Подробный отзыв', app: `/event/${e.id}/feedback` }]],
      });
    }
  }
}

function closeExpiredPolls(now) {
  for (const p of all('SELECT * FROM polls WHERE closed = 0 AND closes_at IS NOT NULL AND closes_at <= ?', now.toISOString())) closePoll(p);
}

// ---------- Random Coffee ----------
function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function makeCoffeePairs(group, week) {
  const people = all("SELECT user_id FROM members WHERE group_id = ? AND status = 'active' AND coffee = 1", group.id).map((m) => m.user_id);
  if (people.length < 2) {
    for (const uid of people) notifyUser(uid, '☕️ На этой неделе в Random Coffee записался только один человек. Позови друзей присоединиться!', { kind: 'coffee' });
    return [];
  }
  // недавние пары — стараемся не повторять
  const recent = new Set();
  for (const p of all(`SELECT p.* FROM coffee_pairs p JOIN coffee_rounds r ON r.id = p.round_id WHERE p.group_id = ? ORDER BY r.week DESC LIMIT 60`, group.id)) {
    const ids = [p.a, p.b, p.c].filter(Boolean);
    for (const x of ids) for (const y of ids) if (x !== y) recent.add(`${x}:${y}`);
  }
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 200 && bestScore > 0; i++) {
    const s = shuffle(people);
    const groups = [];
    for (let j = 0; j + 1 < s.length; j += 2) groups.push([s[j], s[j + 1]]);
    if (s.length % 2) groups[groups.length - 1].push(s[s.length - 1]);
    const score = groups.reduce((acc, g) => acc + g.filter((x, k) => g.slice(k + 1).some((y) => recent.has(`${x}:${y}`))).length, 0);
    if (score < bestScore) { best = groups; bestScore = score; }
  }
  const round = run('INSERT OR IGNORE INTO coffee_rounds (group_id, week) VALUES (?, ?)', group.id, week);
  if (!round.changes) return [];
  for (const g of best) {
    run('INSERT INTO coffee_pairs (round_id, group_id, a, b, c) VALUES (?, ?, ?, ?, ?)', round.lastInsertRowid, group.id, g[0], g[1], g[2] ?? null);
    for (const uid of g) {
      const partners = g.filter((x) => x !== uid).map((id) => get('SELECT * FROM users WHERE id = ?', id));
      const names = partners.map((p) => `<b>${esc(fullName(p))}</b>${p.username ? ` (@${esc(p.username)})` : ''}`).join(' и ');
      const buttons = partners.filter((p) => p.username).map((p) => [{ text: `Написать ${p.first_name || p.username}`, url: `https://t.me/${p.username}` }]);
      buttons.push([{ text: 'Профиль и темы для разговора', app: `/coffee` }]);
      notifyUser(uid, `☕️ <b>Random Coffee</b>\n\nНа этой неделе ваша пара — ${names}.\nДоговоритесь о созвоне или встрече: 20–30 минут, чтобы познакомиться поближе.`, { kind: 'coffee', buttons, quiet: true });
    }

  }
  notifyGroupChat(group.id, `☕️ Random Coffee: на этой неделе ${best.length} ${best.length === 1 ? 'пара' : best.length < 5 ? 'пары' : 'пар'}. Проверьте личные сообщения от бота!`);
  return best;
}

function coffeeReminder(group, week) {
  const round = get('SELECT * FROM coffee_rounds WHERE group_id = ? AND week = ?', group.id, week);
  if (!round || round.reminded) return;
  run('UPDATE coffee_rounds SET reminded = 1 WHERE id = ?', round.id);
  for (const p of all('SELECT * FROM coffee_pairs WHERE round_id = ? AND met = 0', round.id)) {
    for (const uid of [p.a, p.b, p.c].filter(Boolean)) {
      notifyUser(uid, '☕️ Получилось встретиться с парой по Random Coffee на этой неделе?', {
        kind: 'coffee', buttons: [[{ text: 'Да, встретились', data: `cm:${p.id}:1` }, { text: 'Пока нет', data: `cm:${p.id}:0` }]],
      });
    }
  }
}

// ---------- Ежедневное по поясу группы ----------
function groupDaily(group, now) {
  const p = localParts(now, group.tz);
  const today = localDate(now, group.tz);

  if (p.hour >= 10 && markOnce(`bday:${group.id}:${today}`)) {
    const md = today.slice(5);
    const people = all(`SELECT u.* FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND m.status = 'active' AND substr(u.birthdate, 6, 5) = ?`, group.id, md);
    for (const u of people) {
      notifyGroupChat(group.id, `🎂 Сегодня день рождения у <b>${esc(fullName(u))}</b>${u.username ? ` (@${esc(u.username)})` : ''}! Поздравляем! 🎉`);
      notifyMembers(group.id, `🎂 Сегодня день рождения у <b>${esc(fullName(u))}</b>. Не забудьте поздравить!`, { except: u.id, kind: 'posts' });
      notifyUser(u.id, `🎂 С днём рождения, ${esc(u.first_name)}! Вся группа желает тебе ярких целей и сил на их достижение 🧡`);
    }
  }

  const week = weekKey(group.tz, now);
  if (p.weekday === 1 && p.hour >= 10 && markOnce(`coffee:${group.id}:${week}`)) makeCoffeePairs(group, week);
  if (p.weekday === 5 && p.hour >= 18) coffeeReminder(group, week);

  // 1-го числа: «Лидер месяца» и итоги прошлого месяца в чат
  if (p.day === 1 && p.hour >= 10) {
    const prev = prevMonthStart(group.tz, now);
    if (markOnce(`top:${group.id}:${prev.key}`)) {
      const rt = ratings(group, new Date(Date.parse(prev.iso) + 86400_000)).rows.filter((x) => x.points > 0);
      if (rt.length) {
        for (const x of rt.filter((r) => r.rank === 1)) awardBadge(group.id, x.user_id, 'top1');
        const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
        notifyGroupChat(group.id, `🏆 <b>Итоги месяца</b>\n\n${rt.slice(0, 5).map((x, i) => `${medals[i]} ${esc(fullName(x))} — ${x.points}`).join('\n')}\n\nНовый месяц — новый рейтинг. Вперёд! 🚀`);
      }
    }
  }
}

function cleanup() {
  if (!markOnce(`cleanup:${new Date().toISOString().slice(0, 10)}`)) return;
  run("DELETE FROM sessions WHERE last_seen < strftime('%Y-%m-%dT%H:%M:%fZ','now','-120 days')");
  run("DELETE FROM login_requests WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')");
  run("DELETE FROM job_marks WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')");
}

export function tick(now = new Date()) {
  const steps = [
    () => eventReminders(now),
    () => feedbackPrompts(now),
    () => closeExpiredPolls(now),
    () => { for (const g of all('SELECT * FROM groups')) groupDaily(g, now); },
    cleanup,
  ];
  for (const s of steps) {
    try { s(); } catch (e) { console.error('Фоновая задача:', e); }
  }
  flushNotifications();
}

export function startJobs() {
  setTimeout(() => tick(), 5000);
  setInterval(() => tick(), MIN);
  // очередь уведомлений разбираем чаще, чтобы ответы и вопросы приходили быстро
  setInterval(() => flushNotifications(), 10_000);
}


