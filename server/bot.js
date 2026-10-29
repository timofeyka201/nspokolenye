import { Bot, InlineKeyboard, GrammyError } from 'grammy';
import { config } from './config.js';
import { get, all, run, randomCode } from './db.js';
import { upsertTelegramUser } from './auth.js';
import { setSender, flushNotifications } from './notify.js';
import { feedbackAuthorHash } from './anon.js';
import { ratings } from './points.js';
import { localDate, humanDateTime, humanTime } from './time.js';
import { joinGroup } from './membership.js';
import { createPoll, votePoll, pollJson } from './api/content.js';
import { createQuestion, answerQuestion, markCoffeeMet } from './api/social.js';
import { checkIn } from './api/events.js';
import { esc, fullName } from './api/util.js';

let bot = null;
const info = { username: config.botUsername };
export const botInfo = () => info;
export const startLink = (payload) => `https://t.me/${info.username}?start=${payload}`;
// Ссылка, которая сразу открывает Mini App (нужно включить Main Mini App в @BotFather)
export const appLink = (param = '') => `https://t.me/${info.username}?startapp=${param}`;
// Путь приложения → параметр startapp (разрешены только буквы, цифры, _ и -)
export const pathToStartParam = (path) => path.replace(/^\/+/, '').replace(/\//g, '-').slice(0, 64);
const appUrl = (path) => `${config.publicUrl}${path.startsWith('/') ? path : '/' + path}`;
const httpsApp = () => config.publicUrl.startsWith('https://');

export async function isChatMember(chatId, tgId) {
  if (!bot) return false;
  try {
    const m = await bot.api.getChatMember(chatId, tgId);
    return ['creator', 'administrator', 'member', 'restricted'].includes(m.status);
  } catch {
    return false;
  }
}

// Кнопки: { text, url } | { text, app: '/путь' } | { text, data }
function keyboard(rows, chatId) {
  if (!rows?.length) return undefined;
  const kb = new InlineKeyboard();
  for (const row of rows) {
    for (const b of row) {
      if (b.url) kb.url(b.text, b.url);
      else if (b.data) kb.text(b.text, b.data);
      else if (b.app != null) {
        // в личке Mini App открывается кнопкой web_app, в группах — ссылкой t.me/бот?startapp
        if (chatId > 0 && httpsApp()) kb.webApp(b.text, appUrl(b.app));
        else if (info.username) kb.url(b.text, appLink(pathToStartParam(b.app)));
      }
    }
    kb.row();
  }
  return kb;
}

async function send(chatId, text, buttons) {
  return bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard(buttons, chatId), link_preview_options: { is_disabled: true } });
}
const reply = (ctx, text, buttons) => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard(buttons, ctx.chat.id), link_preview_options: { is_disabled: true } });

// ---------- Состояние диалогов (анонимный вопрос, ответ, комментарий к отзыву) ----------
const states = new Map();
const setState = (tgId, s) => states.set(tgId, { ...s, at: Date.now() });
const getState = (tgId) => {
  const s = states.get(tgId);
  if (s && Date.now() - s.at > 30 * 60_000) { states.delete(tgId); return null; }
  return s;
};

const userOf = (ctx) => get('SELECT * FROM users WHERE tg_id = ?', ctx.from.id);
const activeGroups = (userId) => all(`SELECT g.* FROM members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? AND m.status = 'active' ORDER BY g.name`, userId);
const groupByChat = (chatId) => get('SELECT * FROM groups WHERE chat_id = ?', chatId);
const isPrivate = (ctx) => ctx.chat?.type === 'private';

function welcome(ctx, user) {
  const groups = activeGroups(user.id);
  const name = esc(user.first_name || ctx.from.first_name || '');
  let text = `Привет, ${name}! 👋\n\nЭто бот вашей группы проекта <b>«Поколение»</b>. Здесь расписание встреч, цели, материалы, опросы, анонимные вопросы и Random Coffee.`;
  if (!groups.length) text += '\n\nЧтобы попасть в свою группу, откройте ссылку-приглашение от куратора.';
  const buttons = [[{ text: '🚀 Открыть приложение', app: '/' }]];
  if (groups.length) buttons.push([{ text: '❓ Задать анонимный вопрос', data: 'ask' }]);
  return reply(ctx, text, buttons);
}

// ---------- Анонимный вопрос в боте ----------
async function askChooseGroup(ctx, user) {
  const groups = activeGroups(user.id);
  if (!groups.length) return reply(ctx, 'Вы пока не состоите в группе. Откройте ссылку-приглашение от куратора.');
  if (groups.length === 1) return askChooseRecipient(ctx, groups[0], 0);
  return reply(ctx, 'В какой группе задать вопрос?', groups.map((g) => [{ text: g.name, data: `askp:${g.id}:0` }]));
}

async function askChooseRecipient(ctx, group, page, edit = false) {
  const people = all(`SELECT u.*, m.role FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' AND u.tg_id != ?
    ORDER BY CASE m.role WHEN 'nastavnik' THEN 0 WHEN 'mentor' THEN 1 WHEN 'curator' THEN 2 ELSE 3 END, u.first_name`, group.id, ctx.from.id);
  const per = 8;
  const slice = people.slice(page * per, page * per + per);
  const rows = slice.map((u) => [{ text: `${fullName(u)}${u.role !== 'participant' ? ' · ' + { nastavnik: 'наставник', mentor: 'ментор', curator: 'куратор' }[u.role] : ''}`, data: `askto:${group.id}:${u.id}` }]);
  const nav = [];
  if (page > 0) nav.push({ text: '←', data: `askp:${group.id}:${page - 1}` });
  if ((page + 1) * per < people.length) nav.push({ text: '→', data: `askp:${group.id}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: 'Отмена', data: 'cancel' }]);
  const text = '🕶 <b>Анонимный вопрос</b>\n\nКому хотите задать вопрос? Получатель не узнает, кто его отправил.';
  if (edit) return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard(rows, ctx.chat.id) });
  return reply(ctx, text, rows);
}

// ---------- Опросы в чате группы ----------
function pollText(p) {
  const j = pollJson(p, null);
  const lines = [`🗳 <b>${esc(j.question)}</b>`, ''];
  const total = j.multi ? j.voters : j.counts.reduce((a, b) => a + b, 0);
  j.options.forEach((o, i) => {
    const n = j.counts[i];
    const pct = total ? Math.round((n / total) * 100) : 0;
    lines.push(`${esc(o)} — <b>${n}</b>${total ? ` (${pct}%)` : ''}`);
  });
  lines.push('', j.closed ? '✅ Опрос завершён' : `Проголосовали: ${j.voters}${j.multi ? ' · можно выбрать несколько' : ''}${j.anonymous ? ' · анонимно' : ''}`);
  return { text: lines.join('\n'), j };
}
function pollKeyboard(p, j) {
  if (j.closed) return [[{ text: 'Результаты', app: `/poll/${p.id}` }]];
  return [...j.options.map((o, i) => [{ text: o, data: `pv:${p.id}:${i}` }]), [{ text: 'Открыть в приложении', app: `/poll/${p.id}` }]];
}

export async function postPollToChat(p) {
  if (!bot) return;
  const g = get('SELECT chat_id FROM groups WHERE id = ?', p.group_id);
  if (!g?.chat_id) return;
  const { text, j } = pollText(p);
  const m = await send(g.chat_id, text, pollKeyboard(p, j));
  run('UPDATE polls SET chat_message_id = ? WHERE id = ?', m.message_id, p.id);
}

export async function updatePollMessage(pollId) {
  if (!bot) return;
  const p = get('SELECT * FROM polls WHERE id = ?', pollId);
  const g = p && get('SELECT chat_id FROM groups WHERE id = ?', p.group_id);
  if (!p?.chat_message_id || !g?.chat_id) return;
  const { text, j } = pollText(p);
  try {
    await bot.api.editMessageText(g.chat_id, p.chat_message_id, text, { parse_mode: 'HTML', reply_markup: keyboard(pollKeyboard(p, j), g.chat_id) });
  } catch (e) {
    if (!(e instanceof GrammyError && /not modified/.test(e.description))) throw e;
  }
}

// ---------- Расписание для команд в чате ----------
function scheduleText(group, days = 7) {
  const to = new Date(Date.now() + days * 86400_000).toISOString();
  const now = new Date().toISOString();
  const events = all('SELECT * FROM events WHERE group_id = ? AND cancelled = 0 AND COALESCE(ends_at, starts_at) >= ? AND starts_at <= ? ORDER BY starts_at', group.id, now, to);
  const tasks = all('SELECT * FROM tasks WHERE group_id = ? AND due_at >= ? AND due_at <= ? ORDER BY due_at', group.id, now, to);
  if (!events.length && !tasks.length) return `На ближайшие ${days} дней ничего не запланировано.`;
  const emoji = { meeting: '🤝', stream: '📺', deadline: '⏰', other: '📌' };
  const lines = [`🗓 <b>Ближайшие ${days} дней</b>`, ''];
  for (const e of events) lines.push(`${emoji[e.kind]} ${humanDateTime(e.starts_at, group.tz)} — <b>${esc(e.title)}</b>${e.location ? `\n     📍 ${esc(e.location)}` : ''}`);
  for (const t of tasks) lines.push(`📝 до ${humanDateTime(t.due_at, group.tz)} — ${esc(t.title)}`);
  return lines.join('\n');
}

// ---------- Запуск ----------
export async function startBot() {
  if (!config.botToken) {
    console.log('BOT_TOKEN не задан — бот выключен, уведомления пишутся в лог');
    setSender(async (chatId, text) => console.log(`[уведомление → ${chatId}] ${text.replace(/<[^>]+>/g, '')}`));
    return;
  }
  bot = new Bot(config.botToken);
  await bot.init();
  setupBot(bot);

  await registerCommands();
  bot.start({
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    onStart: () => console.log(`Бот @${info.username} запущен`),
  }).catch((e) => console.error('Бот остановился:', e.message));
  flushNotifications();
}

// Все обработчики бота. Отдельно от запуска — чтобы их можно было проверить без Telegram
export function setupBot(b) {
  bot = b;
  info.username = b.botInfo.username;
  setSender(send);

  // Активность в чате: считаем только количество сообщений, тексты не сохраняем
  bot.on('message', async (ctx, next) => {
    const m = ctx.message;
    if (m.migrate_to_chat_id) run('UPDATE groups SET chat_id = ? WHERE chat_id = ?', m.migrate_to_chat_id, ctx.chat.id);
    if (ctx.chat.type !== 'private' && ctx.from && !ctx.from.is_bot && !m.new_chat_members && !m.left_chat_member) {
      const g = groupByChat(ctx.chat.id);
      if (g) {
        run(`INSERT INTO chat_stats (group_id, tg_id, day, messages) VALUES (?, ?, ?, 1)
          ON CONFLICT (group_id, tg_id, day) DO UPDATE SET messages = messages + 1`, g.id, ctx.from.id, localDate(new Date(), g.tz));
      }
    }
    return next();
  });

  bot.command('start', async (ctx) => {
    if (!isPrivate(ctx)) return;
    const user = upsertTelegramUser(ctx.from, { botStarted: true });
    const payload = ctx.match || '';
    if (payload.startsWith('login_')) {
      return reply(ctx, '🔐 Подтвердите вход на сайт «Поколение».\n\nЕсли вы не пытались войти — просто проигнорируйте это сообщение.',
        [[{ text: '✅ Войти на сайт', data: `login:${payload.slice(6)}` }]]);
    }
    if (payload.startsWith('join_')) {
      try {
        const r = await joinGroup(user, payload.slice(5));
        if (r.status === 'active') {
          return reply(ctx, `🎉 Вы в группе «${esc(r.group.name)}»!${r.already ? '' : '\n\nЗаполните профиль, чтобы ребята и наставник узнали вас получше.'}`, [[{ text: '🚀 Открыть приложение', app: '/' }]]);
        }
        return reply(ctx, `Заявка в группу «${esc(r.group.name)}» отправлена. Как только её одобрят, я пришлю сообщение.\n\nА пока можно заполнить профиль.`, [[{ text: 'Заполнить профиль', app: '/' }]]);
      } catch (e) {
        return reply(ctx, e.message);
      }
    }
    if (payload.startsWith('ci_')) {
      const [, eventId, code] = payload.split('_');
      const e = get('SELECT * FROM events WHERE id = ?', +eventId);
      const g = e && get('SELECT * FROM groups WHERE id = ?', e.group_id);
      const m = e && get("SELECT 1 FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", e.group_id, user.id);
      if (!e || !m) return reply(ctx, 'Не получилось отметиться: вы не состоите в этой группе.');
      if (e.checkin_code !== code) return reply(ctx, 'QR-код устарел. Попросите наставника показать его ещё раз.');
      const start = Date.parse(e.starts_at) - 30 * 60_000, end = Date.parse(e.ends_at || e.starts_at) + (e.ends_at ? 60 : 180) * 60_000;
      if (Date.now() < start || Date.now() > end) return reply(ctx, 'Отметиться можно за 30 минут до начала встречи и в течение часа после.');
      checkIn(g, e, user.id);
      return reply(ctx, `✅ Вы отмечены на встрече «${esc(e.title)}». +10 баллов активности!`);
    }
    if (payload === 'ask') return askChooseGroup(ctx, user);
    if (payload === 'verify') {
      return reply(ctx, '✅ Профиль подтверждён через Telegram. Теперь я смогу присылать напоминания о встречах и ответы на ваши вопросы.', [[{ text: '🚀 Открыть приложение', app: '/' }]]);
    }
    return welcome(ctx, user);
  });

  bot.command('app', (ctx) => isPrivate(ctx) ? reply(ctx, 'Открыть приложение:', [[{ text: '🚀 Открыть', app: '/' }]]) : reply(ctx, 'Приложение группы:', [[{ text: '🚀 Открыть', app: '/' }]]));

  bot.command('ask', (ctx) => {
    if (!isPrivate(ctx)) return reply(ctx, 'Анонимные вопросы задаются в личке с ботом — так никто не увидит, кто спрашивает.', [[{ text: '🕶 Задать вопрос', url: startLink('ask') }]]);
    const user = userOf(ctx);
    if (!user) return reply(ctx, 'Сначала нажмите /start');
    return askChooseGroup(ctx, user);
  });

  bot.command('help', (ctx) => reply(ctx, isPrivate(ctx)
    ? '<b>Что я умею</b>\n\n/app — открыть приложение\n/ask — задать анонимный вопрос наставнику или участнику\n/cancel — отменить текущее действие\n\nЕщё я напоминаю о встречах, присылаю ответы на ваши вопросы и пары Random Coffee.'
    : '<b>Команды в чате</b>\n\n/next — ближайшая встреча\n/schedule — расписание на неделю\n/top — топ-5 активности за месяц\n/poll Вопрос | вариант 1 | вариант 2 — быстрый опрос\n/ask — анонимный вопрос (в личке)\n/app — открыть приложение'));

  bot.command('cancel', (ctx) => { states.delete(ctx.from.id); return reply(ctx, 'Отменено.'); });

  // ---------- Команды в чате группы ----------
  bot.command('setup', async (ctx) => {
    if (isPrivate(ctx)) return reply(ctx, 'Эту команду нужно отправить в чате группы.');
    const linked = groupByChat(ctx.chat.id);
    if (linked) return reply(ctx, `Этот чат уже подключён к группе «${esc(linked.name)}» ✅`);
    const user = userOf(ctx);
    const code = (ctx.match || '').trim().toUpperCase();
    if (code) {
      const g = get('SELECT * FROM groups WHERE link_code = ?', code);
      if (!g) return reply(ctx, 'Код не подошёл. Возьмите свежий код в приложении: Меню → Управление группой → Чат.');
      run('UPDATE groups SET chat_id = ?, chat_title = ?, link_code = NULL WHERE id = ?', ctx.chat.id, ctx.chat.title, g.id);
      return reply(ctx, `✅ Чат подключён к группе «${esc(g.name)}».\n\nТеперь я буду напоминать о встречах, считать активность и приветствовать новичков.\n\nВажно: сделайте меня администратором чата, иначе я не увижу сообщения.`,
        [[{ text: '📲 Вступить в группу', url: startLink(`join_${g.invite_code}`) }]]);
    }
    if (user?.is_admin) {
      const r = run('INSERT INTO groups (name, invite_code, chat_id, chat_title) VALUES (?, ?, ?, ?)', ctx.chat.title || 'Моя группа', randomCode(10), ctx.chat.id, ctx.chat.title);
      run("INSERT INTO members (group_id, user_id, role, status) VALUES (?, ?, 'curator', 'active')", r.lastInsertRowid, user.id);
      run('UPDATE users SET current_group = COALESCE(current_group, ?) WHERE id = ?', r.lastInsertRowid, user.id);
      const g = get('SELECT * FROM groups WHERE id = ?', r.lastInsertRowid);
      return reply(ctx, `✅ Создана группа «${esc(g.name)}», чат подключён. Вы — куратор.\n\nУчастникам нужно нажать кнопку ниже и запустить бота:`,
        [[{ text: '📲 Вступить в группу', url: startLink(`join_${g.invite_code}`) }]]);
    }
    return reply(ctx, 'Чтобы подключить чат, куратор берёт код в приложении (Меню → Управление группой → Чат) и отправляет сюда: /setup КОД');
  });

  bot.command('next', (ctx) => {
    const g = groupByChat(ctx.chat.id) || (isPrivate(ctx) && userOf(ctx) && activeGroups(userOf(ctx).id)[0]);
    if (!g) return reply(ctx, 'Чат не подключён к группе. Команда /setup');
    const e = get("SELECT * FROM events WHERE group_id = ? AND cancelled = 0 AND kind IN ('meeting','stream','other') AND starts_at >= ? ORDER BY starts_at LIMIT 1", g.id, new Date().toISOString());
    if (!e) return reply(ctx, 'Ближайших встреч пока нет.');
    return reply(ctx, `${e.kind === 'stream' ? '📺' : '🤝'} <b>${esc(e.title)}</b>\n🗓 ${humanDateTime(e.starts_at, g.tz)}${e.ends_at ? `–${humanTime(e.ends_at, g.tz)}` : ''}${e.location ? `\n📍 ${esc(e.location)}` : ''}${e.url ? `\n🔗 ${esc(e.url)}` : ''}`,
      [[{ text: 'Подробнее', app: `/event/${e.id}` }]]);
  });

  bot.command('schedule', (ctx) => {
    const g = groupByChat(ctx.chat.id) || (isPrivate(ctx) && userOf(ctx) && activeGroups(userOf(ctx).id)[0]);
    if (!g) return reply(ctx, 'Чат не подключён к группе. Команда /setup');
    return reply(ctx, scheduleText(g), [[{ text: '🗓 Календарь', app: '/calendar' }]]);
  });

  bot.command('top', (ctx) => {
    const g = groupByChat(ctx.chat.id) || (isPrivate(ctx) && userOf(ctx) && activeGroups(userOf(ctx).id)[0]);
    if (!g) return reply(ctx, 'Чат не подключён к группе. Команда /setup');
    const top = ratings(g).rows.slice(0, 5).filter((x) => x.points > 0);
    if (!top.length) return reply(ctx, 'В этом месяце рейтинг пока пуст — самое время проявить себя!');
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    return reply(ctx, `🏆 <b>Топ-5 активности за месяц</b>\n\n${top.map((x, i) => `${medals[i]} ${esc(fullName(x))} — ${x.points}`).join('\n')}`,
      [[{ text: 'Мой рейтинг', app: '/rating' }]]);
  });

  bot.command('poll', async (ctx) => {
    const g = groupByChat(ctx.chat.id);
    if (!g) return reply(ctx, 'Опрос через команду создаётся в чате группы. В личке — через приложение.', [[{ text: 'Создать опрос', app: '/polls' }]]);
    const user = userOf(ctx);
    if (!user || !get("SELECT 1 FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", g.id, user.id)) {
      return reply(ctx, 'Создавать опросы могут участники группы. Зарегистрируйтесь:', [[{ text: '📲 Вступить', url: startLink(`join_${g.invite_code}`) }]]);
    }
    const parts = (ctx.match || '').split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) return reply(ctx, 'Формат: /poll Вопрос | вариант 1 | вариант 2\n\nНапример: /poll Когда встречаемся? | Суббота 12:00 | Воскресенье 15:00');
    try {
      const p = createPoll(g.id, user.id, { question: parts[0], options: parts.slice(1) });
      await postPollToChat(p);
    } catch (e) {
      return reply(ctx, e.message);
    }
  });

  // Приветствие новичков в чате
  bot.on('message:new_chat_members', async (ctx) => {
    const g = groupByChat(ctx.chat.id);
    const humans = ctx.message.new_chat_members.filter((u) => !u.is_bot);
    if (ctx.message.new_chat_members.some((u) => u.id === ctx.me.id)) {
      return reply(ctx, '👋 Привет! Я бот группы «Поколение».\n\nЧтобы подключить этот чат, куратор отправляет сюда /setup КОД (код — в приложении: Меню → Управление группой → Чат).\n\nИ сделайте меня администратором, чтобы я видел сообщения.');
    }
    if (!g || !humans.length) return;
    const names = humans.map((u) => esc(u.first_name)).join(', ');
    return reply(ctx, `Привет, ${names}! 👋 Добро пожаловать в группу.\n\nНажми кнопку ниже и запусти бота — там расписание встреч, цели, материалы и Random Coffee.`,
      [[{ text: '📲 Зарегистрироваться', url: startLink(`join_${g.invite_code}`) }]]);
  });

  // ---------- Кнопки ----------
  bot.callbackQuery(/^login:(.+)$/, async (ctx) => {
    const user = upsertTelegramUser(ctx.from, { botStarted: true });
    const r = run(`UPDATE login_requests SET user_id = ? WHERE token = ? AND user_id IS NULL
      AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')`, user.id, ctx.match[1]);
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(r.changes ? '✅ Готово! Вернитесь на сайт — вход выполнен.' : 'Ссылка для входа устарела. Нажмите «Войти» на сайте ещё раз.');
  });

  bot.callbackQuery('ask', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = userOf(ctx);
    return user ? askChooseGroup(ctx, user) : null;
  });
  bot.callbackQuery(/^askp:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const g = get('SELECT * FROM groups WHERE id = ?', +ctx.match[1]);
    return g && askChooseRecipient(ctx, g, +ctx.match[2], true);
  });
  bot.callbackQuery(/^askto:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const to = get('SELECT * FROM users WHERE id = ?', +ctx.match[2]);
    if (!to) return;
    setState(ctx.from.id, { mode: 'ask', gid: +ctx.match[1], to: to.id });
    return ctx.editMessageText(`Напишите вопрос для <b>${esc(fullName(to))}</b> одним сообщением.\n\nОн придёт анонимно. /cancel — отменить.`, { parse_mode: 'HTML' });
  });
  bot.callbackQuery('asksend', async (ctx) => {
    const s = getState(ctx.from.id);
    if (s?.mode !== 'askconfirm') return ctx.answerCallbackQuery('Вопрос уже отправлен или устарел');
    states.delete(ctx.from.id);
    try {
      const g = get('SELECT * FROM groups WHERE id = ?', s.gid);
      createQuestion(g, userOf(ctx), s.to, s.text);
      await ctx.answerCallbackQuery('Отправлено');
      return ctx.editMessageText('✅ Вопрос отправлен анонимно. Когда на него ответят, я пришлю ответ сюда.');
    } catch (e) {
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(e.message);
    }
  });
  bot.callbackQuery('cancel', async (ctx) => {
    states.delete(ctx.from.id);
    await ctx.answerCallbackQuery();
    return ctx.editMessageText('Отменено.');
  });

  bot.callbackQuery(/^qa:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = userOf(ctx);
    const q = get('SELECT * FROM questions WHERE id = ?', +ctx.match[1]);
    if (!q || q.to_user !== user?.id) return;
    if (q.answer) return reply(ctx, 'Вы уже ответили на этот вопрос.');
    setState(ctx.from.id, { mode: 'answer', qid: q.id });
    return reply(ctx, `Напишите ответ одним сообщением:\n\n<i>${esc(q.text.slice(0, 500))}</i>\n\n/cancel — отменить`);
  });

  // Оценка встречи прямо в боте
  bot.callbackQuery(/^fb:(\d+):([1-5])$/, async (ctx) => {
    const user = userOf(ctx);
    const e = get('SELECT * FROM events WHERE id = ?', +ctx.match[1]);
    const m = e && user && get("SELECT role FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", e.group_id, user.id);
    if (!m) return ctx.answerCallbackQuery('Недоступно');
    const g = get('SELECT * FROM groups WHERE id = ?', e.group_id);
    const r = run(`INSERT OR IGNORE INTO feedback (event_id, group_id, rating, author_hash, created_day) VALUES (?, ?, ?, ?, ?)`,
      e.id, e.group_id, +ctx.match[2], feedbackAuthorHash(e.id, user.id), localDate(new Date(), g.tz));
    await ctx.answerCallbackQuery(r.changes ? 'Спасибо!' : 'Вы уже оценили эту встречу');
    if (!r.changes) return;
    setState(ctx.from.id, { mode: 'fbtext', eventId: e.id });
    return ctx.editMessageText(`Оценка ${'⭐️'.repeat(+ctx.match[2])} сохранена анонимно.\n\nХотите добавить пару слов? Напишите, что понравилось и что можно улучшить — или нажмите «Готово».`,
      { reply_markup: keyboard([[{ text: 'Готово', data: 'cancel' }]], ctx.chat.id) });
  });

  bot.callbackQuery(/^cm:(\d+):([01])$/, async (ctx) => {
    const user = userOf(ctx);
    const p = get('SELECT * FROM coffee_pairs WHERE id = ?', +ctx.match[1]);
    if (!p || ![p.a, p.b, p.c].includes(user?.id)) return ctx.answerCallbackQuery('Недоступно');
    markCoffeeMet(p, ctx.match[2] === '1');
    await ctx.answerCallbackQuery('Записал!');
    return ctx.editMessageText(ctx.match[2] === '1' ? '☕️ Отлично! Встреча засчитана (+5 баллов).' : 'Понял. Может, получится на следующей неделе!');
  });

  bot.callbackQuery(/^pv:(\d+):(\d+)$/, async (ctx) => {
    const p = get('SELECT * FROM polls WHERE id = ?', +ctx.match[1]);
    if (!p) return ctx.answerCallbackQuery('Опрос не найден');
    const user = userOf(ctx);
    const member = user && get("SELECT 1 FROM members WHERE group_id = ? AND user_id = ? AND status = 'active'", p.group_id, user.id);
    if (!member) return ctx.answerCallbackQuery({ text: 'Голосовать могут участники группы. Запустите бота и вступите в группу.', show_alert: true });
    const j = pollJson(p, user.id);
    if (j.closed) return ctx.answerCallbackQuery('Опрос уже закрыт');
    const opt = +ctx.match[2];
    let chosen;
    if (p.multi) chosen = j.my.includes(opt) ? j.my.filter((x) => x !== opt) : [...j.my, opt];
    else chosen = j.my.includes(opt) ? [] : [opt];
    try {
      if (chosen.length) votePoll(p, user.id, chosen);
      else run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', p.id, user.id);
    } catch (e) {
      return ctx.answerCallbackQuery(e.message);
    }
    await ctx.answerCallbackQuery(chosen.includes(opt) ? `Ваш голос: ${j.options[opt]}` : 'Голос снят');
    return updatePollMessage(p.id).catch(() => {});
  });

  // ---------- Текстовые сообщения в личке: шаги диалогов ----------
  bot.on('message:text', async (ctx) => {
    if (!isPrivate(ctx)) return;
    const s = getState(ctx.from.id);
    const user = userOf(ctx);
    if (!s || !user) return welcome(ctx, user || upsertTelegramUser(ctx.from, { botStarted: true }));
    const text = ctx.message.text;
    if (s.mode === 'ask') {
      setState(ctx.from.id, { ...s, mode: 'askconfirm', text });
      const to = get('SELECT * FROM users WHERE id = ?', s.to);
      return reply(ctx, `Отправить анонимно для <b>${esc(fullName(to))}</b>?\n\n<i>${esc(text)}</i>`,
        [[{ text: '🕶 Отправить', data: 'asksend' }, { text: 'Отмена', data: 'cancel' }]]);
    }
    if (s.mode === 'answer') {
      states.delete(ctx.from.id);
      const q = get('SELECT * FROM questions WHERE id = ?', s.qid);
      try {
        answerQuestion(q, user, text);
        return reply(ctx, '✅ Ответ отправлен автору вопроса.');
      } catch (e) {
        return reply(ctx, e.message);
      }
    }
    if (s.mode === 'fbtext') {
      states.delete(ctx.from.id);
      run('UPDATE feedback SET liked = ? WHERE event_id = ? AND author_hash = ?', text.slice(0, 2000), s.eventId, feedbackAuthorHash(s.eventId, user.id));
      return reply(ctx, '🙏 Спасибо! Наставник увидит ваш отзыв анонимно.');
    }
  });

  bot.on('my_chat_member', async (ctx) => {
    const st = ctx.myChatMember.new_chat_member.status;
    if ((st === 'left' || st === 'kicked') && ctx.chat.type !== 'private') {
      run('UPDATE groups SET chat_id = NULL WHERE chat_id = ?', ctx.chat.id);
    }
  });

  bot.catch((err) => console.error('Ошибка бота:', err.error?.description || err.error?.message || err.message));
}

async function registerCommands() {
  await bot.api.setMyCommands([
    { command: 'app', description: 'Открыть приложение' },
    { command: 'ask', description: 'Задать анонимный вопрос' },
    { command: 'help', description: 'Что умеет бот' },
  ], { scope: { type: 'all_private_chats' } }).catch(() => {});
  await bot.api.setMyCommands([
    { command: 'next', description: 'Ближайшая встреча' },
    { command: 'schedule', description: 'Расписание на неделю' },
    { command: 'top', description: 'Топ-5 активности' },
    { command: 'poll', description: 'Опрос: Вопрос | вариант | вариант' },
    { command: 'app', description: 'Открыть приложение' },
    { command: 'help', description: 'Команды бота' },
  ], { scope: { type: 'all_group_chats' } }).catch(() => {});
  if (httpsApp()) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: config.publicUrl } } }).catch((e) => console.error('Кнопка меню:', e.message));
  }
}

export async function stopBot() {
  if (bot) await bot.stop();
}

