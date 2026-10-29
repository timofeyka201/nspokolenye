import express from 'express';
import { get, all, run, nowIso } from '../db.js';
import { requireStaff } from '../auth.js';
import { addPoints, removePoints, checkBadges } from '../points.js';
import { notifyGroupChat } from '../notify.js';
import { localDate } from '../time.js';
import { fail, str, dateOrNull, userCard, fullName, esc } from './util.js';

export const goalsRouter = express.Router({ mergeParams: true });
const r = goalsRouter;

function stepsOf(goalId) {
  return all('SELECT id, title, done, done_at FROM goal_steps WHERE goal_id = ? ORDER BY sort, id', goalId).map((s) => ({ ...s, done: !!s.done }));
}

// Если у цели есть шаги — прогресс считается по ним, иначе его отмечают вручную
function recalcProgress(goalId) {
  const s = get('SELECT COUNT(*) AS total, SUM(done) AS done FROM goal_steps WHERE goal_id = ?', goalId);
  if (s.total) run('UPDATE goals SET progress = ?, updated_at = ? WHERE id = ?', Math.round((s.done / s.total) * 100), nowIso(), goalId);
}

function goalJson(g) {
  const steps = stepsOf(g.id);
  return { ...g, steps, steps_total: steps.length, steps_done: steps.filter((s) => s.done).length };
}

function loadGoal(req, { own = false } = {}) {
  const g = get('SELECT * FROM goals WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!g) fail(404, 'Цель не найдена');
  if (own && g.user_id !== req.user.id) fail(403, 'Изменять цель может только её автор');
  return g;
}

r.get('/goals', (req, res) => {
  const uid = req.query.user ? +req.query.user : req.user.id;
  const goals = all(`SELECT * FROM goals WHERE group_id = ? AND user_id = ? AND status != 'archived'
    ORDER BY status = 'done', COALESCE(due_date, '9999'), created_at DESC`, req.group.id, uid).map(goalJson);
  res.json({ goals });
});

// Общая картина для наставника: цели всех участников
r.get('/goals/overview', requireStaff, (req, res) => {
  const people = all(`SELECT u.* FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' AND m.role = 'participant' ORDER BY u.first_name`, req.group.id);
  const goals = all("SELECT * FROM goals WHERE group_id = ? AND status != 'archived' ORDER BY status = 'done', updated_at DESC", req.group.id);
  const lastUpdate = new Map(all(`SELECT g.user_id, MAX(x.at) AS at FROM goals g JOIN (
      SELECT goal_id, created_at AS at FROM goal_updates UNION ALL SELECT goal_id, done_at FROM goal_steps WHERE done_at IS NOT NULL
    ) x ON x.goal_id = g.id WHERE g.group_id = ? GROUP BY g.user_id`, req.group.id).map((x) => [x.user_id, x.at]));
  const rows = people.map((u) => {
    const mine = goals.filter((g) => g.user_id === u.id);
    const active = mine.filter((g) => g.status === 'active');
    return {
      user: userCard(u),
      active: active.length,
      done: mine.length - active.length,
      avg: active.length ? Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length) : null,
      last_activity: lastUpdate.get(u.id) || mine[0]?.updated_at || null,
      goals: mine.map((g) => ({ id: g.id, title: g.title, progress: g.progress, status: g.status, due_date: g.due_date })),
    };
  });
  const active = goals.filter((g) => g.status === 'active');
  res.json({
    people: rows,
    summary: {
      with_goals: rows.filter((x) => x.active + x.done > 0).length,
      participants: rows.length,
      active: active.length,
      done: goals.length - active.length,
      avg: active.length ? Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length) : 0,
    },
  });
});

r.post('/goals', (req, res) => {
  const title = str(req.body.title, 120, { required: true, label: 'Цель' });
  const r2 = run('INSERT INTO goals (group_id, user_id, title, description, due_date) VALUES (?, ?, ?, ?, ?)',
    req.group.id, req.user.id, title, str(req.body.description, 2000), dateOrNull(req.body.due_date));
  const id = Number(r2.lastInsertRowid);
  const steps = Array.isArray(req.body.steps) ? req.body.steps.map((s) => str(s, 200)).filter(Boolean).slice(0, 30) : [];
  steps.forEach((s, i) => run('INSERT INTO goal_steps (goal_id, title, sort) VALUES (?, ?, ?)', id, s, i));
  recalcProgress(id);
  res.json(goalJson(get('SELECT * FROM goals WHERE id = ?', id)));
});

r.get('/goals/:id', (req, res) => {
  const g = loadGoal(req);
  const owner = get('SELECT * FROM users WHERE id = ?', g.user_id);
  const updates = all('SELECT id, text, progress, created_at FROM goal_updates WHERE goal_id = ? ORDER BY created_at DESC LIMIT 100', g.id);
  res.json({ goal: goalJson(g), owner: userCard(owner), updates, mine: g.user_id === req.user.id });
});

function onDone(req, g) {
  addPoints(req.group.id, g.user_id, 'goal_done', g.id);
  checkBadges(req.group.id, g.user_id);
  if (req.body.announce !== false) {
    notifyGroupChat(req.group.id, `🎉 <b>${esc(fullName(req.user))}</b> достиг(ла) цели «${esc(g.title)}»! Поздравляем!`);
  }
}

r.patch('/goals/:id', (req, res) => {
  const g = loadGoal(req, { own: true });
  const b = req.body;
  const status = b.status ?? g.status;
  if (!['active', 'done', 'archived'].includes(status)) fail(400, 'Неизвестный статус');
  const hasSteps = get('SELECT COUNT(*) AS n FROM goal_steps WHERE goal_id = ?', g.id).n > 0;
  let progress = !hasSteps && b.progress !== undefined ? Math.max(0, Math.min(100, Math.round(+b.progress) || 0)) : g.progress;
  if (status === 'done') progress = 100;
  run(`UPDATE goals SET title = ?, description = ?, due_date = ?, status = ?, progress = ?, updated_at = ?,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, ?) ELSE NULL END WHERE id = ?`,
    b.title !== undefined ? str(b.title, 120, { required: true, label: 'Цель' }) : g.title,
    b.description !== undefined ? str(b.description, 2000) : g.description,
    b.due_date !== undefined ? dateOrNull(b.due_date) : g.due_date,
    status, progress, nowIso(), status, nowIso(), g.id);
  if (status === 'done' && g.status !== 'done') onDone(req, g);
  if (status !== 'done' && g.status === 'done') removePoints(req.group.id, g.user_id, 'goal_done', g.id);
  if (status !== 'done') recalcProgress(g.id);
  res.json(goalJson(get('SELECT * FROM goals WHERE id = ?', g.id)));
});

r.delete('/goals/:id', (req, res) => {
  const g = loadGoal(req, { own: true });
  run('DELETE FROM goals WHERE id = ?', g.id);
  res.json({ ok: true });
});

r.post('/goals/:id/steps', (req, res) => {
  const g = loadGoal(req, { own: true });
  const max = get('SELECT COALESCE(MAX(sort), 0) AS m FROM goal_steps WHERE goal_id = ?', g.id).m;
  run('INSERT INTO goal_steps (goal_id, title, sort) VALUES (?, ?, ?)', g.id, str(req.body.title, 200, { required: true, label: 'Шаг' }), max + 1);
  recalcProgress(g.id);
  res.json(goalJson(get('SELECT * FROM goals WHERE id = ?', g.id)));
});

r.patch('/goals/:id/steps/:sid', (req, res) => {
  const g = loadGoal(req, { own: true });
  const s = get('SELECT * FROM goal_steps WHERE id = ? AND goal_id = ?', +req.params.sid, g.id);
  if (!s) fail(404, 'Шаг не найден');
  const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : s.done;
  run('UPDATE goal_steps SET title = ?, done = ?, done_at = ? WHERE id = ?',
    req.body.title !== undefined ? str(req.body.title, 200, { required: true, label: 'Шаг' }) : s.title, done, done ? s.done_at || nowIso() : null, s.id);
  if (done && !s.done) addPoints(req.group.id, req.user.id, 'goal_step', s.id);
  if (!done && s.done) removePoints(req.group.id, req.user.id, 'goal_step', s.id);
  recalcProgress(g.id);
  let fresh = get('SELECT * FROM goals WHERE id = ?', g.id);
  // все шаги выполнены — цель достигнута
  if (fresh.progress === 100 && fresh.status === 'active' && req.body.done) {
    run("UPDATE goals SET status = 'done', done_at = ? WHERE id = ?", nowIso(), g.id);
    onDone(req, fresh);
    fresh = get('SELECT * FROM goals WHERE id = ?', g.id);
  }
  res.json(goalJson(fresh));
});

r.delete('/goals/:id/steps/:sid', (req, res) => {
  const g = loadGoal(req, { own: true });
  run('DELETE FROM goal_steps WHERE id = ? AND goal_id = ?', +req.params.sid, g.id);
  recalcProgress(g.id);
  res.json(goalJson(get('SELECT * FROM goals WHERE id = ?', g.id)));
});

// Отметка движения к цели: короткая запись «что сделал» и, если шагов нет, новый процент
r.post('/goals/:id/updates', (req, res) => {
  const g = loadGoal(req, { own: true });
  const text = str(req.body.text, 1000, { required: true, label: 'Что сделано' });
  const hasSteps = get('SELECT COUNT(*) AS n FROM goal_steps WHERE goal_id = ?', g.id).n > 0;
  const progress = !hasSteps && req.body.progress != null ? Math.max(0, Math.min(100, Math.round(+req.body.progress) || 0)) : null;
  run('INSERT INTO goal_updates (goal_id, text, progress) VALUES (?, ?, ?)', g.id, text, progress);
  if (progress != null) run('UPDATE goals SET progress = ? WHERE id = ?', progress, g.id);
  run('UPDATE goals SET updated_at = ? WHERE id = ?', nowIso(), g.id);
  addPoints(req.group.id, req.user.id, 'goal_update', `${g.id}:${localDate(new Date(), req.group.tz)}`);
  checkBadges(req.group.id, req.user.id);
  res.json({ ok: true });
});
