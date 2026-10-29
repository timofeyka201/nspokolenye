// Тестовые данные для разработки: группа, 9 человек, встречи, цели, задания, опросы, вопросы.
// Запуск: в одном терминале `npm run dev`, в другом `node scripts/seed-demo.mjs`.
// Потом на экране входа в «Тестовый вход» введите имя: «Тимофей Морозов» (куратор и администратор),
// «Игорь Столяров» (наставник), «Анна Ковалёва» (ментор) или «Маша Петрова» (участник).
// Переключатель «Администратор» для участников оставьте выключенным. Работает только при DEV_LOGIN=1.
const B = (process.env.APP_URL || 'http://localhost:3100') + '/api';
async function call(token, path, method = 'GET', body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + ' ' + JSON.stringify(j)); return j;
}
// tgId считается от имени так же, как на экране «Тестовый вход» — чтобы потом войти под этим человеком
const nameId = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h || 1); };
const login = async (name, _tgId, admin = false, username) => (await call(null, '/auth/dev', 'POST', { name, tgId: nameId(name), admin, username })).token;
const H = (d, h = 18, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };

const admin = await login('Тимофей Морозов', 1001, true, 'timofey');
const { id: gid } = await call(admin, '/groups', 'POST', { name: 'Группа Игоря Столярова' });
await call(admin, '/me', 'PATCH', { onboarded: true, birthdate: '2009-03-14', tags: ['IT', 'Дизайн', 'Бизнес'], bio: 'Делаю сервис для нашей группы 🙂', can_help: 'Программирование, Figma, сделать сайт', need_help: 'Подготовка к ЕГЭ по профильной математике' });
const admin2 = await call(admin, `/g/${gid}/admin`);
const code = admin2.invite.code;
const people = [
  ['Игорь Столяров', 2001, 'nastavnik', 'stolyarov'], ['Анна Ковалёва', 2002, 'mentor', 'anna_k'],
  ['Маша Петрова', 3001, 'participant', 'masha_p'], ['Артём Соколов', 3002, 'participant', 'artem'], ['Лиза Смирнова', 3003, 'participant', 'liza'],
  ['Даня Волков', 3004, 'participant', 'danya'], ['Соня Лебедева', 3005, 'participant', null], ['Кирилл Орлов', 3006, 'participant', 'kirill'],
];
const tokens = {};
const ids = {};
for (const [name, tg, role, un] of people) {
  const t = await login(name, tg, false, un); tokens[name] = t;
  const r = await call(t, '/join', 'POST', { code });
  const me = await call(t, '/me');
  ids[name] = me.user.id;
  await call(admin, `/g/${gid}/members/${me.user.id}/approve`, 'POST');
  if (role !== 'participant') await call(admin, `/g/${gid}/members/${me.user.id}`, 'PATCH', { role });
}
const bios = {
  'Маша Петрова': ['2008-11-02', ['Журналистика', 'Блогинг', 'Кино'], 'Веду блог про книги, мечтаю поступить на журфак МГУ', 'Тексты, сторителлинг, монтаж видео', 'Математика и уверенность в публичных выступлениях'],
  'Артём Соколов': ['2009-05-20', ['IT', 'Робототехника', 'Олимпиады'], 'Пишу на Python, люблю олимпиадную информатику', 'Программирование на Python, олимпиадные задачи', 'Английский язык для IELTS'],
  'Лиза Смирнова': ['2008-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(Math.min(28, new Date().getDate() + 2)).padStart(2, '0'), ['Дизайн', 'Искусство', 'Фотография'], 'Рисую и снимаю, хочу в дизайн', 'Дизайн презентаций, фотография', 'Как запустить свой проект и найти клиентов'],
  'Даня Волков': ['2009-08-11', ['Спорт', 'Бизнес', 'Финансы'], 'КМС по плаванию, интересуюсь инвестициями', 'Спорт и режим, финансовая грамотность', 'Публичные выступления'],
};
for (const [n, [b, tags, bio, can, need]] of Object.entries(bios)) await call(tokens[n], '/me', 'PATCH', { birthdate: b, tags, bio, can_help: can, need_help: need, onboarded: true });
for (const n of ['Игорь Столяров', 'Анна Ковалёва', 'Соня Лебедева', 'Кирилл Орлов']) await call(tokens[n], '/me', 'PATCH', { onboarded: true });

const g = (p) => `/g/${gid}${p}`;
const ign = tokens['Игорь Столяров'];
const past = await call(ign, g('/events'), 'POST', { kind: 'meeting', title: 'Встреча: как ставить цели по SMART', starts_at: H(-3, 18), ends_at: H(-3, 19, 30), location: 'Москва, Сколково, корпус B', notify: false });
const now = await call(ign, g('/events'), 'POST', { kind: 'meeting', title: 'Встреча группы: личный бренд', starts_at: new Date(Date.now() + 10 * 60000).toISOString(), ends_at: new Date(Date.now() + 100 * 60000).toISOString(), location: 'Москва, Ленинский пр-т, 32', description: 'Разбираем, как подростку выстроить личный бренд в соцсетях. Возьмите ноутбуки.' });
await call(ign, g('/events'), 'POST', { kind: 'stream', title: 'Эфир с основателем Phygital International', starts_at: H(3, 19), ends_at: H(3, 20), url: 'https://telemost.yandex.ru/j/123' });
await call(ign, g('/events'), 'POST', { kind: 'meeting', title: 'Нетворкинг-завтрак', starts_at: H(6, 11), ends_at: H(6, 13), location: 'Кофейня «Зерно», Тверская 7' });
await call(ign, g('/events'), 'POST', { kind: 'deadline', title: 'Сдать заявку на грант', starts_at: H(9, 23, 59) });
// посещение и отзывы о прошлой встрече (через базу не лезем: окно отметки прошло — отмечает наставник вручную)
for (const n of ['Маша Петрова', 'Артём Соколов', 'Лиза Смирнова', 'Даня Волков']) await call(ign, g(`/events/${past.id}/attendance`), 'POST', { user_id: ids[n], present: true });
const qr = await call(ign, g(`/events/${now.id}/qr`));
await call(tokens['Артём Соколов'], g(`/events/${now.id}/checkin`), 'POST', { code: qr.code });
const fbs = [[5, 'Очень понравились примеры из реальной жизни', ''], [4, 'Полезно и по делу', 'Хотелось бы больше практики в парах'], [5, '', ''], [3, 'Интересная тема', 'Начали поздно, не успели обсудить вопросы']];
for (const [i, n] of ['Маша Петрова', 'Артём Соколов', 'Лиза Смирнова', 'Даня Волков'].entries()) await call(tokens[n], g(`/events/${past.id}/feedback`), 'POST', { rating: fbs[i][0], liked: fbs[i][1], improve: fbs[i][2] });

// цели
const goal = await call(admin, g('/goals'), 'POST', { title: 'Сдать ЕГЭ по профильной математике на 85+', due_date: '2027-06-01', steps: ['Пройти диагностику', 'Решить 200 задач второй части', 'Написать 5 пробников', 'Разобрать ошибки с репетитором'] });
await call(admin, g(`/goals/${goal.id}/steps/${goal.steps[0].id}`), 'PATCH', { done: true });
await call(admin, g(`/goals/${goal.id}/updates`), 'POST', { text: 'Прошёл диагностику: 68 баллов. Слабые места — параметры и экономические задачи' });
await call(admin, g('/goals'), 'POST', { title: 'Запустить сервис для группы', steps: ['Собрать требования', 'Сделать прототип', 'Запустить бота'] });
for (const [n, t, p] of [['Маша Петрова', 'Набрать 1000 подписчиков в блоге', 40], ['Артём Соколов', 'Выйти на заключительный этап ВсОШ по информатике', 65], ['Лиза Смирнова', 'Собрать портфолио из 10 работ', 30], ['Даня Волков', 'Выступить на конференции', 10]]) {
  const gg = await call(tokens[n], g('/goals'), 'POST', { title: t });
  await call(tokens[n], g(`/goals/${gg.id}/updates`), 'POST', { text: 'Начало положено', progress: p });
}
// задания, материалы, опросы, объявления
await call(ign, g('/tasks'), 'POST', { title: 'Написать 3 сильные стороны и подтвердить их примерами', description: 'Коротко, по 2–3 предложения. Обсудим на встрече.', due_at: H(2, 21) });
const t2 = await call(ign, g('/tasks'), 'POST', { title: 'Посмотреть лекцию о личном бренде', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', due_at: H(-1, 21) });
await call(tokens['Маша Петрова'], g(`/tasks/${t2.id}/done`), 'POST', { comment: 'Посмотрела, выписала идеи' });
const f1 = await call(ign, g('/folders'), 'POST', { name: 'Поступление', emoji: '🎓' });
await call(ign, g('/folders'), 'POST', { name: 'Записи эфиров', emoji: '🎬' });
await call(ign, g('/folders'), 'POST', { name: 'Книги', emoji: '📚' });
await call(ign, g('/materials'), 'POST', { title: 'Шаблон SMART-цели', url: 'https://docs.google.com/document/d/abc', note: 'Скопируйте себе и заполните до встречи' });
await call(ign, g('/materials'), 'POST', { folder_id: f1.id, title: 'Как выбрать вуз', url: 'https://postupi.online' });
await call(ign, g('/materials'), 'POST', { title: 'Канал проекта «Поколение»', url: 'https://t.me/pokolenie' });
const poll = await call(tokens['Анна Ковалёва'], g('/polls'), 'POST', { question: 'Когда удобнее провести нетворкинг-завтрак?', options: ['Суббота, 11:00', 'Воскресенье, 12:00', 'Суббота, 15:00'], multi: true });
for (const [n, o] of [['Маша Петрова', [0]], ['Артём Соколов', [0, 1]], ['Лиза Смирнова', [1]], ['Даня Волков', [0]]]) await call(tokens[n], g(`/polls/${poll.id}/vote`), 'POST', { options: o });
await call(ign, g('/polls'), 'POST', { question: 'Какую тему разберём в ноябре?', options: ['Финансовая грамотность', 'Публичные выступления', 'Тайм-менеджмент'] });
await call(ign, g('/posts'), 'POST', { text: 'Друзья, в эту субботу встречаемся в Сколково! Не забудьте паспорт для пропуска 🙌', pinned: true });
// спасибо, вопросы, кофе
await call(tokens['Маша Петрова'], g('/thanks'), 'POST', { to: ids['Артём Соколов'], text: 'За помощь с Python для проекта 🙌' });
await call(tokens['Лиза Смирнова'], g('/thanks'), 'POST', { to: ids['Маша Петрова'], text: 'Классный разбор моего текста!' });
await call(tokens['Даня Волков'], g('/thanks'), 'POST', { to: 1, text: 'За то, что делаешь для нас этот сервис' });
await call(tokens['Маша Петрова'], g('/questions'), 'POST', { to: ids['Игорь Столяров'], text: 'Как вы справлялись со страхом публичных выступлений в начале карьеры?' });
await call(tokens['Артём Соколов'], g('/questions'), 'POST', { to: 1, text: 'Как ты научился делать такие сервисы? С чего начать?' });
const q = await call(tokens['Даня Волков'], g('/questions'), 'POST', { to: ids['Игорь Столяров'], text: 'Стоит ли идти в бизнес сразу после школы?' });
for (const n of ['Маша Петрова', 'Артём Соколов', 'Лиза Смирнова', 'Даня Волков', 'Кирилл Орлов']) await call(tokens[n], g('/coffee'), 'POST', { on: true });
await call(admin, g('/coffee'), 'POST', { on: true });
console.log(`Готово: группа ${gid}, вопрос ${q.id}, встреча сейчас ${now.id}, прошедшая ${past.id}. Откройте http://localhost:3100`);
