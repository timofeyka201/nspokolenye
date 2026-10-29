import express from 'express';
import { get, all, run, nowIso, parseJson } from '../db.js';
import { ROLE_TITLES } from '../auth.js';
import { POINTS, LEVELS, addPoints, checkBadges, ratings, userActivity, userBadges } from '../points.js';
import { notifyUser } from '../notify.js';
import { questionAuthorHash, findQuestionAuthor } from '../anon.js';
import { localDate, weekKey } from '../time.js';
import { fail, str, userCard, fullName, esc } from './util.js';

export const socialRouter = express.Router({ mergeParams: true });
const r = socialRouter;

// ---------- Анонимные вопросы ----------
const QUESTIONS_PER_DAY = 10;

export function createQuestion(group, user, toId, rawText) {
  const text = str(rawText, 2000, { required: true, label: 'Вопрос' });
  if (toId === user.id) fail(400, 'Нельзя задать вопрос самому себе');
  const to = get("SELECT u.* FROM members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.user_id = ? AND m.status = 'active'", group.id, toId);
  if (!to) fail(404, 'Получатель не найден');
  const hash = questionAuthorHash(group.id, user.id);
  if (get('SELECT 1 FROM anon_blocks WHERE group_id = ? AND author_hash = ?', group.id, hash)) fail(403, 'Отправка анонимных вопросов для вас ограничена командой группы');
  const today = localDate(new Date(), group.tz);
  const sentToday = get('SELECT COUNT(*) AS n FROM questions WHERE group_id = ? AND author_hash = ? AND created_day = ?', group.id, hash, today).n;
  if (sentToday >= QUESTIONS_PER_DAY) fail(429, `Можно отправить не больше ${QUESTIONS_PER_DAY} вопросов в день`);
  const r2 = run('INSERT INTO questions (group_id, to_user, author_hash, text, created_day) VALUES (?, ?, ?, ?, ?)', group.id, toId, hash, text, today);
  const id = Number(r2.lastInsertRowid);
  // небольшая случайная задержка доставки, чтобы по времени было сложнее угадать автора
  notifyUser(toId, `❓ <b>Вам анонимный вопрос</b>\n\n${esc(text)}`, {
    kind: 'questions', delayMs: Math.floor(Math.random() * 90_000),
    buttons: [[{ text: '✍️ Ответить', data: `qa:${id}` }], [{ text: 'Открыть в приложении', app: '/questions' }]],
  });
  return id;
}

export function answerQuestion(q, user, rawText) {
  if (q.to_user !== user.id) fail(403, 'Ответить может только получатель');
  if (q.answer) fail(400, 'Вы уже ответили на этот вопрос');
  const text = str(rawText, 3000, { required: true, label: 'Ответ' });
  run('UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?', text, nowIso(), q.id);
  const author = findQuestionAuthor(q.group_id, q.author_hash);
  if (author) {
    notifyUser(author, `💬 <b>${esc(fullName(user))}</b> ответил(а) на ваш анонимный вопрос:\n\n<i>${esc(q.text.slice(0, 300))}</i>\n\n${esc(text)}`, {
      kind: 'questions', buttons: [[{ text: 'Мои вопросы', app: '/questions/sent' }]],
    });
  }
}

const questionJson = (q) => ({ id: q.id, text: q.text, answer: q.answer, created_day: q.created_day, answered_at: q.answered_at });

r.get('/questions/recipients', (req, res) => {
  const people = all(`SELECT u.*, m.role FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' AND u.id != ?
    ORDER BY CASE m.role WHEN 'nastavnik' THEN 0 WHEN 'mentor' THEN 1 WHEN 'curator' THEN 2 ELSE 3 END, u.first_name`, req.group.id, req.user.id)
    .map((u) => ({ ...userCard(u), role_title: ROLE_TITLES[u.role] }));
  res.json({ people });
});

r.get('/questions/inbox', (req, res) => {
  const qs = all('SELECT * FROM questions WHERE group_id = ? AND to_user = ? AND hidden = 0 ORDER BY answer IS NOT NULL, id DESC LIMIT 200', req.group.id, req.user.id);
  res.json({ questions: qs.map(questionJson), can_block: req.isStaff });
});

r.get('/questions/sent', (req, res) => {
  const qs = all(`SELECT q.*, u.first_name, u.last_name, u.username, u.photo_url FROM questions q JOIN users u ON u.id = q.to_user
    WHERE q.group_id = ? AND q.author_hash = ? ORDER BY q.id DESC LIMIT 200`, req.group.id, questionAuthorHash(req.group.id, req.user.id));
  res.json({ questions: qs.map((q) => ({ ...questionJson(q), to: userCard({ ...q, id: q.to_user }) })) });
});

r.post('/questions', (req, res) => {
  const id = createQuestion(req.group, req.user, +req.body.to, req.body.text);
  res.json({ id });
});

const loadQuestion = (req) => {
  const q = get('SELECT * FROM questions WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!q || q.to_user !== req.user.id) fail(404, 'Вопрос не найден');
  return q;
};

r.post('/questions/:id/answer', (req, res) => {
  answerQuestion(loadQuestion(req), req.user, req.body.text);
  res.json({ ok: true });
});
r.post('/questions/:id/hide', (req, res) => {
  run('UPDATE questions SET hidden = 1 WHERE id = ?', loadQuestion(req).id);
  res.json({ ok: true });
});
// Заблокировать автора (не раскрывая его) может только команда группы
r.post('/questions/:id/block', (req, res) => {
  if (!req.isStaff) fail(403, 'Блокировать может только команда группы');
  const q = loadQuestion(req);
  run('INSERT OR IGNORE INTO anon_blocks (group_id, author_hash) VALUES (?, ?)', req.group.id, q.author_hash);
  run('UPDATE questions SET hidden = 1 WHERE group_id = ? AND author_hash = ? AND to_user = ?', req.group.id, q.author_hash, req.user.id);
  res.json({ ok: true });
});

// ---------- Random Coffee ----------
r.get('/coffee', (req, res) => {
  const gid = req.group.id, me = req.user.id;
  const opted = !!get('SELECT coffee FROM members WHERE group_id = ? AND user_id = ?', gid, me)?.coffee;
  const count = get("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND status = 'active' AND coffee = 1", gid).n;
  const pairs = all(`SELECT p.*, r.week FROM coffee_pairs p JOIN coffee_rounds r ON r.id = p.round_id
    WHERE p.group_id = ? AND ? IN (p.a, p.b, p.c) ORDER BY r.week DESC LIMIT 12`, gid, me)
    .map((p) => ({
      id: p.id, week: p.week, met: !!p.met,
      partners: [p.a, p.b, p.c].filter((x) => x && x !== me).map((id) => {
        const u = get('SELECT * FROM users WHERE id = ?', id);
        return { ...userCard(u), tags: parseJson(u.tags, []), bio: u.bio };
      }),
    }));
  const thisWeek = weekKey(req.group.tz);
  res.json({ opted, count, current: pairs[0]?.week === thisWeek ? pairs[0] : null, history: pairs.filter((p) => p.week !== thisWeek), week: thisWeek });
});

r.post('/coffee', (req, res) => {
  run('UPDATE members SET coffee = ? WHERE group_id = ? AND user_id = ?', req.body.on ? 1 : 0, req.group.id, req.user.id);
  res.json({ ok: true });
});

export function markCoffeeMet(pair, met) {
  run('UPDATE coffee_pairs SET met = ? WHERE id = ?', met ? 1 : 0, pair.id);
  if (met) for (const uid of [pair.a, pair.b, pair.c].filter(Boolean)) { addPoints(pair.group_id, uid, 'coffee_met', pair.id); checkBadges(pair.group_id, uid); }
}

r.post('/coffee/pairs/:id/met', (req, res) => {
  const p = get('SELECT * FROM coffee_pairs WHERE id = ? AND group_id = ?', +req.params.id, req.group.id);
  if (!p || ![p.a, p.b, p.c].includes(req.user.id)) fail(404, 'Пара не найдена');
  markCoffeeMet(p, !!req.body.met);
  res.json({ ok: true });
});

// ---------- Спасибо ----------
r.get('/thanks', (req, res) => {
  const rows = all(`SELECT t.*, f.first_name AS f_first, f.last_name AS f_last, f.username AS f_username, f.photo_url AS f_photo,
      o.first_name AS o_first, o.last_name AS o_last, o.username AS o_username, o.photo_url AS o_photo
    FROM thanks t JOIN users f ON f.id = t.from_user JOIN users o ON o.id = t.to_user
    WHERE t.group_id = ? ORDER BY t.created_at DESC LIMIT 60`, req.group.id);
  res.json({
    thanks: rows.map((t) => ({
      id: t.id, text: t.text, created_at: t.created_at,
      from: userCard({ id: t.from_user, first_name: t.f_first, last_name: t.f_last, username: t.f_username, photo_url: t.f_photo }),
      to: userCard({ id: t.to_user, first_name: t.o_first, last_name: t.o_last, username: t.o_username, photo_url: t.o_photo }),
    })),
  });
});

r.post('/thanks', (req, res) => {
  const to = +req.body.to;
  if (to === req.user.id) fail(400, 'Себя поблагодарить нельзя 🙂');
  if (!get("SELECT 1 FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", req.group.id, to)) fail(404, 'Человек не найден');
  const text = str(req.body.text, 500, { required: true, label: 'За что спасибо' });
  const today = localDate(new Date(), req.group.tz);
  const givenToday = get(`SELECT COUNT(*) AS n FROM thanks WHERE group_id = ? AND from_user = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`, req.group.id, req.user.id).n;
  if (givenToday >= 20) fail(429, 'На сегодня достаточно благодарностей — продолжим завтра');
  const r2 = run('INSERT INTO thanks (group_id, from_user, to_user, text) VALUES (?, ?, ?, ?)', req.group.id, req.user.id, to, text);
  if (givenToday < 3) addPoints(req.group.id, req.user.id, 'thanks_given', `${today}:${givenToday}`);
  addPoints(req.group.id, to, 'thanks_received', r2.lastInsertRowid);
  checkBadges(req.group.id, req.user.id);
  checkBadges(req.group.id, to);
  notifyUser(to, `💛 <b>${esc(fullName(req.user))}</b> говорит вам спасибо:\n\n${esc(text)}`, { buttons: [[{ text: 'Открыть', app: '/thanks' }]] });
  res.json({ ok: true });
});

// ---------- Рейтинг, активность, достижения ----------
r.get('/rating', (req, res) => {
  const rt = ratings(req.group);
  const me = rt.rows.find((x) => x.user_id === req.user.id);
  const row = (x) => ({ ...userCard(x), points: x.points, rank: x.rank, level: x.level, chat_messages: x.chat_messages });
  res.json({
    month: rt.month,
    top: rt.rows.filter((x) => x.points > 0).slice(0, 5).map(row),
    me: me ? row(me) : null,
    total: rt.rows.length,
    all: req.isStaff ? rt.rows.map(row) : null,
    rules: Object.entries(POINTS).map(([kind, p]) => ({ kind, ...p })),
    levels: LEVELS,
  });
});

r.get('/activity', (req, res) => {
  const uid = req.query.user ? +req.query.user : req.user.id;
  if (uid !== req.user.id && !req.isStaff) fail(403, 'Подробная активность видна только самому человеку и команде');
  const rt = ratings(req.group).rows.find((x) => x.user_id === uid);
  res.json({ ...userActivity(req.group, uid), rank: rt?.rank ?? null });
});

r.get('/badges', (req, res) => {
  const uid = req.query.user ? +req.query.user : req.user.id;
  res.json({ badges: userBadges(req.group.id, uid) });
});

// ---------- «Могу помочь ↔ ищу помощь» ----------
// Простое сопоставление по словам (первые 5 букв — грубая замена морфологии) и тегам
const STOP = new Set(['котор', 'чтобы', 'когда', 'очень', 'могу', 'хочу', 'нужно', 'помоч', 'помощ', 'также', 'этого', 'свой', 'своих', 'своим', 'можно', 'людей', 'тольк', 'будет']);
function stems(text, tags = []) {
  const words = String(text || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9+#]{4,}/g) || [];
  const s = new Set(words.map((w) => w.slice(0, 5)).filter((w) => !STOP.has(w)));
  for (const t of tags) s.add('#' + String(t).toLowerCase().replace(/ё/g, 'е'));
  return s;
}
const overlap = (a, b) => [...a].filter((x) => b.has(x));

r.get('/match', (req, res) => {
  const me = req.user;
  const myTags = parseJson(me.tags, []);
  const myNeed = stems(me.need_help), myCan = stems(me.can_help);
  const people = all(`SELECT u.*, m.role FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' AND u.id != ?`, req.group.id, me.id);
  const canHelpMe = [], iCanHelp = [], similar = [];
  for (const u of people) {
    const tags = parseJson(u.tags, []);
    const a = overlap(myNeed, stems(u.can_help, []));
    if (a.length) canHelpMe.push({ ...userCard(u), score: a.length, text: u.can_help });
    const b = overlap(myCan, stems(u.need_help, []));
    if (b.length) iCanHelp.push({ ...userCard(u), score: b.length, text: u.need_help });
    const common = tags.filter((t) => myTags.map((x) => x.toLowerCase()).includes(String(t).toLowerCase()));
    if (common.length) similar.push({ ...userCard(u), score: common.length, common });
  }
  const top = (arr) => arr.sort((x, y) => y.score - x.score).slice(0, 6);
  res.json({
    canHelpMe: top(canHelpMe), iCanHelp: top(iCanHelp), similar: top(similar),
    filled: { need: !!me.need_help, can: !!me.can_help, tags: myTags.length > 0 },
  });
});

