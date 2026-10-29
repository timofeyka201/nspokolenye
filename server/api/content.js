import express from 'express';
import { get, all, run, parseJson } from '../db.js';
import { requireStaff } from '../auth.js';
import { addPoints, removePoints, checkBadges } from '../points.js';
import { notifyMembers, notifyGroupChat, notifyUser } from '../notify.js';
import { postPollToChat, updatePollMessage } from '../bot.js';
import { humanDateTime } from '../time.js';
import { fail, str, isoOrNull, url, userCard, esc } from './util.js';

export const contentRouter = express.Router({ mergeParams: true });
const r = contentRouter;

// ---------- Материалы: папки и ссылки ----------
r.get('/materials', (req, res) => {
  const gid = req.group.id;
  const folderId = req.query.folder ? +req.query.folder : null;
  let folder = null;
  const path = [];
  if (folderId) {
    folder = get('SELECT * FROM folders WHERE id = ? AND group_id = ?', folderId, gid);
    if (!folder) fail(404, 'Папка не найдена');
    for (let f = folder; f; f = f.parent_id ? get('SELECT * FROM folders WHERE id = ?', f.parent_id) : null) path.unshift({ id: f.id, name: f.name });
  }
  const folders = all(`SELECT f.*, (SELECT COUNT(*) FROM materials m WHERE m.folder_id = f.id) + (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id) AS items
    FROM folders f WHERE f.group_id = ? AND f.parent_id IS ? ORDER BY f.name`, gid, folderId);
  const materials = all('SELECT * FROM materials WHERE group_id = ? AND folder_id IS ? ORDER BY created_at DESC', gid, folderId);
  const q = str(req.query.q, 100);
  const found = q ? all(`SELECT m.*, f.name AS folder_name FROM materials m LEFT JOIN folders f ON f.id = m.folder_id
    WHERE m.group_id = ? AND (m.title LIKE ? OR m.note LIKE ? OR m.url LIKE ?) ORDER BY m.created_at DESC LIMIT 50`, gid, `%${q}%`, `%${q}%`, `%${q}%`) : null;
  res.json({ folder, path, folders, materials, found, can_edit: req.isStaff });
});

r.post('/folders', requireStaff, (req, res) => {
  const parent = req.body.parent_id ? +req.body.parent_id : null;
  if (parent && !get('SELECT 1 FROM folders WHERE id = ? AND group_id = ?', parent, req.group.id)) fail(404, 'Папка не найдена');
  const r2 = run('INSERT INTO folders (group_id, parent_id, name, emoji) VALUES (?, ?, ?, ?)', req.group.id, parent,
    str(req.body.name, 80, { required: true, label: 'Название' }), str(req.body.emoji, 8) || '📁');
  res.json(get('SELECT * FROM folders WHERE id = ?', r2.lastInsertRowid));
});
r.patch('/folders/:id', requireStaff, (req, res) => {
  const f = get('SELECT * FROM folders WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!f) fail(404, 'Папка не найдена');
  run('UPDATE folders SET name = ?, emoji = ? WHERE id = ?', str(req.body.name ?? f.name, 80, { required: true, label: 'Название' }), str(req.body.emoji ?? f.emoji, 8) || '📁', f.id);
  res.json(get('SELECT * FROM folders WHERE id = ?', f.id));
});
r.delete('/folders/:id', requireStaff, (req, res) => {
  run('DELETE FROM folders WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  res.json({ ok: true });
});

r.post('/materials', requireStaff, (req, res) => {
  const folder = req.body.folder_id ? +req.body.folder_id : null;
  if (folder && !get('SELECT 1 FROM folders WHERE id = ? AND group_id = ?', folder, req.group.id)) fail(404, 'Папка не найдена');
  const r2 = run('INSERT INTO materials (group_id, folder_id, title, url, note, created_by) VALUES (?, ?, ?, ?, ?, ?)', req.group.id, folder,
    str(req.body.title, 200, { required: true, label: 'Название' }), url(req.body.url, { required: true }), str(req.body.note, 1000), req.user.id);
  res.json(get('SELECT * FROM materials WHERE id = ?', r2.lastInsertRowid));
});
r.patch('/materials/:id', requireStaff, (req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!m) fail(404, 'Материал не найден');
  run('UPDATE materials SET title = ?, url = ?, note = ?, folder_id = ? WHERE id = ?',
    str(req.body.title ?? m.title, 200, { required: true, label: 'Название' }), req.body.url !== undefined ? url(req.body.url, { required: true }) : m.url,
    str(req.body.note ?? m.note, 1000), req.body.folder_id !== undefined ? (req.body.folder_id ? +req.body.folder_id : null) : m.folder_id, m.id);
  res.json(get('SELECT * FROM materials WHERE id = ?', m.id));
});
r.delete('/materials/:id', requireStaff, (req, res) => {
  run('DELETE FROM materials WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  res.json({ ok: true });
});

// ---------- Задания от наставника ----------
function taskJson(t, req) {
  const done = get('SELECT comment, at FROM task_done WHERE task_id = ? AND user_id = ?', t.id, req.user.id);
  const author = t.created_by ? get('SELECT * FROM users WHERE id = ?', t.created_by) : null;
  return {
    ...t, author: author && userCard(author), done: !!done, done_at: done?.at || null, my_comment: done?.comment || '',
    done_count: get('SELECT COUNT(*) AS n FROM task_done WHERE task_id = ?', t.id).n,
  };
}

r.get('/tasks', (req, res) => {
  const tasks = all('SELECT * FROM tasks WHERE group_id = ? ORDER BY due_at IS NULL, due_at DESC, created_at DESC LIMIT 200', req.group.id).map((t) => taskJson(t, req));
  const participants = get("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'active' AND role = 'participant'", req.group.id).n;
  res.json({ tasks, participants, can_edit: req.isStaff });
});

r.get('/tasks/:id', (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!t) fail(404, 'Задание не найдено');
  const out = taskJson(t, req);
  if (req.isStaff) {
    out.completions = all(`SELECT u.*, d.comment, d.at FROM members m JOIN users u ON u.id = m.user_id
      LEFT JOIN task_done d ON d.task_id = ? AND d.user_id = u.id
      WHERE m.group_id = ? AND m.status = 'active' AND m.role = 'participant' ORDER BY d.at IS NULL, d.at, u.first_name`, t.id, req.group.id)
      .map((u) => ({ ...userCard(u), done: !!u.at, comment: u.comment, at: u.at }));
  }
  res.json(out);
});

r.post('/tasks', requireStaff, (req, res) => {
  const r2 = run('INSERT INTO tasks (group_id, title, description, url, due_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', req.group.id,
    str(req.body.title, 200, { required: true, label: 'Задание' }), str(req.body.description, 4000), url(req.body.url), isoOrNull(req.body.due_at, 'Дедлайн'), req.user.id);
  const t = get('SELECT * FROM tasks WHERE id = ?', r2.lastInsertRowid);
  const text = `📝 Новое задание: <b>${esc(t.title)}</b>${t.due_at ? `\n⏰ Срок: ${humanDateTime(t.due_at, req.group.tz)}` : ''}`;
  const buttons = [[{ text: 'Открыть задание', app: `/task/${t.id}` }]];
  notifyMembers(req.group.id, text, { kind: 'deadlines', buttons, roles: ['participant'] });
  if (req.body.toChat) notifyGroupChat(req.group.id, text, { buttons });
  res.json(taskJson(t, req));
});

r.patch('/tasks/:id', requireStaff, (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!t) fail(404, 'Задание не найдено');
  const due = req.body.due_at !== undefined ? isoOrNull(req.body.due_at, 'Дедлайн') : t.due_at;
  run('UPDATE tasks SET title = ?, description = ?, url = ?, due_at = ?, reminded = CASE WHEN ? THEN 0 ELSE reminded END WHERE id = ?',
    str(req.body.title ?? t.title, 200, { required: true, label: 'Задание' }), str(req.body.description ?? t.description, 4000),
    req.body.url !== undefined ? url(req.body.url) : t.url, due, due !== t.due_at ? 1 : 0, t.id);
  res.json(taskJson(get('SELECT * FROM tasks WHERE id = ?', t.id), req));
});

r.delete('/tasks/:id', requireStaff, (req, res) => {
  run("DELETE FROM activity WHERE group_id = ? AND kind = 'task_done' AND ref = ?", req.group.id, String(+req.params.id));
  run('DELETE FROM tasks WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  res.json({ ok: true });
});

r.post('/tasks/:id/done', (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!t) fail(404, 'Задание не найдено');
  run(`INSERT INTO task_done (task_id, user_id, comment) VALUES (?, ?, ?)
    ON CONFLICT (task_id, user_id) DO UPDATE SET comment = excluded.comment`, t.id, req.user.id, str(req.body.comment, 2000));
  addPoints(req.group.id, req.user.id, 'task_done', t.id);
  checkBadges(req.group.id, req.user.id);
  res.json(taskJson(t, req));
});
r.delete('/tasks/:id/done', (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!t) fail(404, 'Задание не найдено');
  run('DELETE FROM task_done WHERE task_id = ? AND user_id = ?', t.id, req.user.id);
  removePoints(req.group.id, req.user.id, 'task_done', t.id);
  res.json(taskJson(t, req));
});

// ---------- Объявления ----------
r.get('/posts', (req, res) => {
  const posts = all(`SELECT p.*, u.first_name, u.last_name, u.username, u.photo_url FROM posts p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.group_id = ? ORDER BY p.pinned DESC, p.created_at DESC LIMIT 100`, req.group.id)
    .map((p) => ({ id: p.id, text: p.text, pinned: !!p.pinned, created_at: p.created_at, author: userCard({ ...p, id: p.created_by }) }));
  res.json({ posts, can_edit: req.isStaff });
});
r.post('/posts', requireStaff, (req, res) => {
  const text = str(req.body.text, 4000, { required: true, label: 'Текст' });
  const r2 = run('INSERT INTO posts (group_id, text, pinned, created_by) VALUES (?, ?, ?, ?)', req.group.id, text, req.body.pinned ? 1 : 0, req.user.id);
  const msg = `📣 <b>Объявление</b>\n\n${esc(text)}`;
  notifyMembers(req.group.id, msg, { kind: 'posts', except: req.user.id });
  if (req.body.toChat) notifyGroupChat(req.group.id, msg);
  res.json({ id: Number(r2.lastInsertRowid) });
});
r.patch('/posts/:id', requireStaff, (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!p) fail(404, 'Объявление не найдено');
  run('UPDATE posts SET text = ?, pinned = ? WHERE id = ?', req.body.text !== undefined ? str(req.body.text, 4000, { required: true, label: 'Текст' }) : p.text,
    req.body.pinned !== undefined ? (req.body.pinned ? 1 : 0) : p.pinned, p.id);
  res.json({ ok: true });
});
r.delete('/posts/:id', requireStaff, (req, res) => {
  run('DELETE FROM posts WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  res.json({ ok: true });
});

// ---------- Опросы ----------
export function pollJson(p, userId, { staff = false } = {}) {
  const options = parseJson(p.options, []);
  const votes = all('SELECT user_id, option FROM poll_votes WHERE poll_id = ?', p.id);
  const voters = new Set(votes.map((v) => v.user_id));
  const counts = options.map((_, i) => votes.filter((v) => v.option === i).length);
  const my = votes.filter((v) => v.user_id === userId).map((v) => v.option);
  const out = {
    id: p.id, question: p.question, options, multi: !!p.multi, anonymous: !!p.anonymous, closes_at: p.closes_at,
    closed: !!p.closed || (!!p.closes_at && Date.parse(p.closes_at) < Date.now()), created_at: p.created_at,
    counts, voters: voters.size, my, in_chat: !!p.chat_message_id, mine: !!userId && p.created_by === userId,
  };
  // кто за что голосовал — видно, только если опрос не анонимный
  if (!p.anonymous) {
    const users = new Map(all(`SELECT u.* FROM users u WHERE u.id IN (SELECT user_id FROM poll_votes WHERE poll_id = ?)`, p.id).map((u) => [u.id, userCard(u)]));
    out.by_option = options.map((_, i) => votes.filter((v) => v.option === i).map((v) => users.get(v.user_id)).filter(Boolean));
  }
  if (staff && p.created_by) out.author = userCard(get('SELECT * FROM users WHERE id = ?', p.created_by));
  return out;
}

export function votePoll(p, userId, options) {
  const opts = parseJson(p.options, []);
  const chosen = [...new Set(options.map(Number))].filter((i) => i >= 0 && i < opts.length);
  if (!chosen.length) fail(400, 'Выберите вариант');
  if (!p.multi && chosen.length > 1) fail(400, 'Можно выбрать только один вариант');
  run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', p.id, userId);
  for (const i of chosen) run('INSERT INTO poll_votes (poll_id, user_id, option) VALUES (?, ?, ?)', p.id, userId, i);
  addPoints(p.group_id, userId, 'poll_vote', p.id);
  checkBadges(p.group_id, userId);
}

const pollOpen = (p) => !p.closed && !(p.closes_at && Date.parse(p.closes_at) < Date.now());

r.get('/polls', (req, res) => {
  const polls = all('SELECT * FROM polls WHERE group_id = ? ORDER BY closed, created_at DESC LIMIT 100', req.group.id).map((p) => pollJson(p, req.user.id, { staff: req.isStaff }));
  res.json({ polls, can_create: true, can_manage: req.isStaff });
});

export function createPoll(groupId, userId, body) {
  const question = str(body.question, 300, { required: true, label: 'Вопрос' });
  const options = (Array.isArray(body.options) ? body.options : []).map((o) => str(o, 100)).filter(Boolean).slice(0, 10);
  if (options.length < 2) fail(400, 'Нужно минимум два варианта ответа');
  const r2 = run('INSERT INTO polls (group_id, question, options, multi, anonymous, closes_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    groupId, question, JSON.stringify(options), body.multi ? 1 : 0, body.anonymous ? 1 : 0, isoOrNull(body.closes_at, 'Окончание'), userId);
  return get('SELECT * FROM polls WHERE id = ?', r2.lastInsertRowid);
}

// Создать опрос может любой участник (например, выбрать время встречи), закрыть и удалить — автор или команда
r.post('/polls', async (req, res) => {
  const p = createPoll(req.group.id, req.user.id, req.body);
  notifyMembers(req.group.id, `🗳 Новый опрос: <b>${esc(p.question)}</b>`, { kind: 'polls', except: req.user.id, buttons: [[{ text: 'Проголосовать', app: `/poll/${p.id}` }]] });
  if (req.body.toChat) await postPollToChat(p).catch((e) => console.error('Опрос в чат:', e.message));
  res.json(pollJson(get('SELECT * FROM polls WHERE id = ?', p.id), req.user.id, { staff: req.isStaff }));
});

const loadPoll = (req) => {
  const p = get('SELECT * FROM polls WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!p) fail(404, 'Опрос не найден');
  return p;
};

r.get('/polls/:id', (req, res) => res.json(pollJson(loadPoll(req), req.user.id, { staff: req.isStaff })));

r.post('/polls/:id/vote', (req, res) => {
  const p = loadPoll(req);
  if (!pollOpen(p)) fail(400, 'Опрос уже закрыт');
  votePoll(p, req.user.id, Array.isArray(req.body.options) ? req.body.options : [req.body.option]);
  updatePollMessage(p.id).catch(() => {});
  res.json(pollJson(p, req.user.id, { staff: req.isStaff }));
});

r.delete('/polls/:id/vote', (req, res) => {
  const p = loadPoll(req);
  if (!pollOpen(p)) fail(400, 'Опрос уже закрыт');
  run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', p.id, req.user.id);
  removePoints(req.group.id, req.user.id, 'poll_vote', p.id);
  updatePollMessage(p.id).catch(() => {});
  res.json(pollJson(p, req.user.id, { staff: req.isStaff }));
});

export function closePoll(p) {
  run('UPDATE polls SET closed = 1 WHERE id = ?', p.id);
  const j = pollJson(p, null);
  const max = Math.max(...j.counts);
  const winners = j.options.filter((_, i) => j.counts[i] === max && max > 0);
  if (p.created_by) {
    notifyUser(p.created_by, `🗳 Опрос «${esc(p.question)}» завершён.\n${winners.length ? `Победил вариант: <b>${winners.map(esc).join(', ')}</b> (${max})` : 'Никто не проголосовал.'}`,
      { kind: 'polls', buttons: [[{ text: 'Результаты', app: `/poll/${p.id}` }]] });
  }
  updatePollMessage(p.id).catch(() => {});
}

r.post('/polls/:id/close', (req, res) => {
  const p = loadPoll(req);
  if (p.created_by !== req.user.id && !req.isStaff) fail(403, 'Закрыть опрос может автор или команда');
  closePoll(p);
  res.json(pollJson(get('SELECT * FROM polls WHERE id = ?', p.id), req.user.id, { staff: req.isStaff }));
});

r.delete('/polls/:id', (req, res) => {
  const p = loadPoll(req);
  if (p.created_by !== req.user.id && !req.isStaff) fail(403, 'Удалить опрос может автор или команда');
  run("DELETE FROM activity WHERE group_id = ? AND kind = 'poll_vote' AND ref = ?", req.group.id, String(p.id));
  run('DELETE FROM polls WHERE id = ?', p.id);
  res.json({ ok: true });
});
