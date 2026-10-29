# CLAUDE.md: архитектура и правила проекта «Поколение»

Этот файл читают Claude Code и разработчики. В нём описано, как устроен проект, какие правила нельзя нарушать и как добавлять новое. Описание для пользователей и инструкция по установке лежат в `README.md`.

## Что это

Сервис для малой группы проекта наставничества «Поколение» (подростки 15–19 лет, наставник, менторы, куратор). Он работает в трёх видах, и у всех один сервер и одна база:

1. **Веб-приложение**: `https://nspokolonye.site`, вход через Telegram-бота.
2. **Telegram Mini App**: то же самое веб-приложение, открытое внутри Telegram.
3. **Telegram-бот**: регистрация, уведомления, анонимные вопросы, оценка встреч кнопками, работа в чате группы.

Весь интерфейс, тексты, комментарии в коде и сообщения коммитов пишутся **на русском**.

## Стек и почему он такой

- **Node.js ≥ 22.13, ES-модули** (`"type": "module"`). Сервер на **Express 5**, бот на **grammY**.
- **SQLite через встроенный `node:sqlite`** (`DatabaseSync`, синхронные запросы). Отдельного сервера базы данных нет: он не поместился бы в 1 ГБ памяти рядом с другим проектом.
- **Фронтенд без сборки**: Preact + htm одним файлом (`public/vendor/htm-preact.js`), обычные ES-модули в браузере. Нет ни webpack, ни vite, ни npm-зависимостей у фронта. Сервер слабый (1 ГБ RAM, 10 ГБ диска), сборка на нём могла бы упасть, а так выкладка — это просто `git pull`.
- Зависимостей у сервера всего три: `express`, `grammy`, `qrcode-generator`. **Новые зависимости добавлять только при реальной необходимости.**

## Карта проекта

```
server/
  index.js        точка входа: Express, статика, /cal/*.ics, запуск бота и фоновых задач
  config.js       переменные окружения (BOT_TOKEN, PUBLIC_URL, ADMIN_TG_IDS, DEV_LOGIN, PORT)
  db.js           схема SQLite (CREATE TABLE IF NOT EXISTS), хелперы get/all/run/tx, ensureColumn, секрет
  auth.js         проверка initData Mini App, сессии, middleware requireAuth / groupScope / requireStaff / requireCurator, роли
  membership.js   вступление в группу по коду приглашения (используется и API, и ботом)
  notify.js       очередь уведомлений (таблица notifications): тихие часы, повторы, отключаемые виды уведомлений
  points.js       баллы активности, уровни, рейтинг, достижения (бейджи)
  anon.js         HMAC-хэши авторов анонимных отзывов и вопросов
  ical.js         iCalendar: личная подписка /cal/<token>.ics и файл одного события; ссылка в Google Calendar
  time.js         часовые пояса без библиотек (localParts, zonedToUtc, monthStart, weekKey, humanDateTime)
  jobs.js         фоновые задачи раз в минуту: напоминания, просьбы оценить встречу, автозакрытие опросов,
                  Random Coffee (пн 10:00), напоминание о кофе (пт 18:00), дни рождения (10:00), итоги месяца (1-го)
  bot.js          Telegram-бот: setupBot(bot) регистрирует все обработчики, startBot() запускает long polling
  api/
    index.js      /api: вход (telegram / login через бота / dev), /me, /join, /groups; монтирует /api/g/:gid/*
    util.js       HttpError/fail, str/url/isoOrNull/dateOrNull (валидация), userCard/userProfile, esc
    group.js      /home (сводка для главной), участники, роли, заявки, /admin (приглашение, привязка чата, настройки)
    events.js     события, отметка на встрече (код/QR), посещаемость, анонимные отзывы
    goals.js      цели, шаги, отметки прогресса, общая картина для команды
    content.js    материалы (папки+ссылки), задания, объявления, опросы
    social.js     анонимные вопросы, Random Coffee, «спасибо», рейтинг, активность, бейджи, подбор «кто поможет»
public/
  index.html      оболочка; подключает telegram-web-app.js (в браузере ничего не делает) и js/app.js
  css/app.css     вся дизайн-система (токены в :root, компоненты iOS-стиля)
  js/lib.js       Preact-хуки, store (глобальное состояние), api()/gapi(), useApi()/useG() с кэшем, форматирование дат
  js/router.js    навигация по History API: navigate(), back(), useRoute(), match(); TABS — корневые вкладки
  js/tg.js        обёртка над Telegram.WebApp: haptic, BackButton, openLink, downloadFile, scanQr, shareUrl
  js/ui.js        компоненты: Page, TabBar, List/Row, Button, Toggle, Segmented, Ring, Bar, Avatar, Empty, Async,
                  Field, AutoTextarea, TagInput, openSheet/SheetLayout, actionSheet, confirm, toast, attempt
  js/icons.js     SVG-иконки Lucide (только нужные; добавлять из пакета lucide-static)
  js/app.js       загрузка (boot), выбор группы, таблица маршрутов ROUTES, Shell с таббаром
  js/views/*.js   экраны: auth, home, calendar, goals, people, menu, materials, tasks, polls, questions, coffee, rating, posts
deploy/           install.sh / update.sh / bootstrap.sh / caddy-import.sh — установка и автообновление на сервере
scripts/seed-demo.mjs  тестовые данные для локальной разработки
```

## Модель данных (server/db.js)

Все даты и время хранятся в **UTC в виде ISO-строк** (`2026-10-29T18:00:00.000Z`), даты без времени — `YYYY-MM-DD`. «Местное» время (10 утра, понедельник, начало месяца) считается по `groups.tz` через `time.js`.

| Таблица | Назначение |
|---|---|
| `users` | Человек; `tg_id` — Telegram ID (у тестовых пользователей отрицательный). Профиль, `tags` (JSON), `notify` (JSON с отключёнными видами), тихие часы, `cal_token`, `bot_started` (=профиль подтверждён, бот может писать), `is_admin` (главный администратор) |
| `sessions`, `login_requests` | Сессии (Bearer-токен) и одноразовые токены входа на сайт через бота |
| `groups` | Группа; `chat_id` — привязанный чат Telegram, `invite_code`, `link_code` (для `/setup КОД`), `tz` |
| `members` | Членство: `role` (`participant`/`mentor`/`nastavnik`/`curator`), `status` (`pending`/`active`/`left`), `coffee` (участвует в Random Coffee) |
| `events`, `attendance` | События (`meeting`/`stream`/`deadline`/`other`), `checkin_code`, флаги разосланных напоминаний; посещаемость |
| `feedback` | **Анонимные** отзывы о встречах: без user_id, только `author_hash` |
| `questions`, `anon_blocks` | **Анонимные** вопросы (`to_user` — получатель, автора нет, только `author_hash`), блокировки по хэшу |
| `folders`, `materials` | Материалы: дерево папок и ссылки |
| `goals`, `goal_steps`, `goal_updates` | Цели, шаги (прогресс считается по ним), отметки «что сделано» |
| `tasks`, `task_done` | Задания от команды и их сдача |
| `polls`, `poll_votes` | Опросы (`options` — JSON-массив, голос = индекс варианта), `chat_message_id` — сообщение в чате с кнопками |
| `coffee_rounds`, `coffee_pairs` | Random Coffee: раунд на неделю (`week` = дата понедельника), пары/тройки |
| `chat_stats` | Число сообщений в чате по дням: **только счётчики, тексты не храним** |
| `thanks`, `posts` | «Спасибо» и объявления |
| `activity` | Журнал баллов: `UNIQUE(group_id, user_id, kind, ref)` защищает от двойного начисления |
| `badges` | Полученные достижения |
| `notifications` | Очередь исходящих сообщений бота |
| `job_marks` | Отметки «фоновая задача уже выполнена» (`markOnce(key)`) |

### Как менять базу (важно!)

На сервере база **уже существует** и содержит настоящие данные. Поэтому:
- новая таблица — `CREATE TABLE IF NOT EXISTS` в `SCHEMA` (это безопасно);
- новая колонка в существующей таблице — вызовом `ensureColumn('таблица', 'колонка', 'ТИП DEFAULT ...')` в разделе «Миграции» в `db.js`. Простая правка `CREATE TABLE` на сервере ничего не изменит;
- колонки и таблицы **не удалять и не переименовывать** — максимум перестать использовать;
- менять `CHECK`-ограничения в существующих таблицах SQLite не умеет — лучше проверять значения в коде.

## Сервер: как устроен запрос

1. `requireAuth` берёт `Authorization: Bearer <token>`, кладёт пользователя в `req.user`.
2. Всё внутри группы — под `/api/g/:gid/...`. `groupScope` проверяет членство и выставляет `req.group`, `req.role`, `req.isStaff` (ментор/наставник/куратор), `req.isCurator`. Главный администратор (`is_admin`) имеет в любой группе права куратора.
3. Права: `requireStaff` (управление: события, задания, материалы, объявления, заявки, обратная связь), `requireCurator` (роли, настройки группы, привязка чата). **Роли назначает только куратор.**
4. Ошибки: `fail(400, 'Понятный текст по-русски')` — фронтенд покажет его в тосте. Express 5 сам ловит исключения в async-обработчиках.
5. Входные данные всегда пропускаем через `str()/url()/isoOrNull()/dateOrNull()` из `api/util.js` (они обрезают длину и проверяют формат).
6. Каждый запрос к данным группы должен фильтровать по `group_id = req.group.id`, иначе можно увидеть чужую группу по id.

**Вход:**
- в Mini App: `POST /api/auth/telegram { initData }` — подпись проверяется `verifyInitData` (HMAC от токена бота);
- на сайте: `POST /api/auth/login/start` выдаёт ссылку `t.me/бот?start=login_<token>` (и QR), человек нажимает «Войти» в боте, сайт опрашивает `GET /api/auth/login/poll`;
- локально: `POST /api/auth/dev` (только при `DEV_LOGIN=1`).

## Анонимность — правила, которые нельзя нарушать

- В `feedback` и `questions` **нет и не должно быть** `user_id` автора. Автор = `author_hash` из `anon.js` (HMAC с секретом сервера `DATA_DIR/secret.key`).
- По хэшу можно: не дать оставить второй отзыв, показать автору его вопросы, доставить ответ (`findQuestionAuthor` перебирает участников группы), заблокировать спамера (`anon_blocks`). Нельзя: показывать хэш или что-то, что позволяет связать запись с человеком.
- **Баллы за анонимные действия не начисляются** — иначе по таблице `activity` можно вычислить автора.
- Отзывы отдаются команде в случайном порядке и без времени (только `created_day`). Доставка анонимного вопроса задерживается на случайные 0–90 секунд.

## Баллы, уровни, достижения (server/points.js)

- `POINTS` — сколько баллов за какое действие. Начисление: `addPoints(groupId, userId, kind, ref)`, отмена: `removePoints(...)`. `ref` делает начисление идемпотентным (например, id задания или `goalId:дата` для «раз в день»).
- Рейтинг = сумма `activity` за календарный месяц (по поясу группы) + сообщения в чате (не больше `CHAT_DAILY_CAP` в день). В рейтинге только участники (`role = participant`).
- Видимость: топ-5 видят все; своё место — каждый; полный список — только команда (`req.isStaff`).
- Достижения: `BADGES` + проверки в `checkBadges()`. Вызывайте `checkBadges(groupId, userId)` после действий, которые могут дать бейдж.

## Уведомления и бот

- **Не вызывайте Telegram API напрямую из API-обработчиков.** Используйте `notifyUser(userId, text, { kind, buttons })`, `notifyMembers(groupId, ...)`, `notifyGroupChat(groupId, ...)` из `notify.js`. Сообщение попадёт в очередь: там учитываются тихие часы, отключённые виды уведомлений (`NOTIFY_KINDS`), лимиты Telegram и повторы.
- Текст — **HTML parse mode**: любые пользовательские строки оборачивайте в `esc()`.
- Кнопки: `[[{ text, app: '/event/12' }], [{ text, url }], [{ text, data: 'callback' }]]`. `app` в личке превращается в кнопку Mini App (`web_app`), в группах — в ссылку `t.me/бот?startapp=event-12`. Путь кодируется так: `/` → `-` (см. `pathToStartParam` и `handleStart` в `app.js`).
- `bot.js`: `setupBot(bot)` регистрирует обработчики, `startBot()` запускает long polling. Диалоги из нескольких шагов (анонимный вопрос, ответ, комментарий к оценке) хранятся в памяти в `states` (тайм-аут 30 минут).
- Callback-данные: `login:`, `ask`, `askp:`, `askto:`, `asksend`, `cancel`, `qa:<id>` (ответить на вопрос), `fb:<event>:<1-5>` (оценка встречи), `cm:<pair>:<0|1>` (Random Coffee), `pv:<poll>:<option>` (голос в чате).
- Deep links `/start`: `login_<token>`, `join_<invite>`, `ci_<event>_<code>` (отметка по QR), `ask`, `verify`.
- Без `BOT_TOKEN` бот выключен, а уведомления просто пишутся в лог — удобно для локальной разработки.

## Фронтенд

- **Шаблоны** — htm: `` html`<${Button} kind="primary" onClick=${fn}>Текст</${Button}>` ``. Хуки и `html` импортируются из `./lib.js` (не из vendor напрямую).
- **Состояние**: `store` (`me` — профиль, группы, настройки; `gid` — текущая группа; `badges` — счётчики на таббаре), `useStore(selector)`. `currentGroup()` — текущая группа с `role`, `is_staff`, `is_curator`.
- **Данные**: `useG('/path')` — GET-запрос к `/api/g/<gid>/path` с кэшем (при возврате на экран сразу показывается прошлый ответ, данные тихо обновляются); возвращает `{ data, error, loading, reload, setData }`. Мутации — `gapi(path, { method, body })`, обычно внутри `attempt(fn, 'Текст успеха')`, чтобы ошибка показалась тостом.
- **Экран** = функция в `js/views/*.js`, которая возвращает `<${Page} title=... back="/родитель" dir=${dir} right=${кнопки}>`. Внутри `<${Async} state=${st}>${(data) => ...}</${Async}>` — скелетон при загрузке и ошибка с кнопкой «Повторить».
- **Маршрут** добавляется в `ROUTES` в `js/app.js`. Корневые вкладки перечислены в `TABS` (`router.js`): Главная, Календарь, Цели, Люди, Ещё.
- **Формы** открываются шторкой: `openSheet(Component, props)`; внутри `<${SheetLayout} title close done doneLabel>`. Меню действий — `actionSheet([{ label, danger, onClick }])`, подтверждение — `await confirm('Текст', { ok, danger })`.
- **Telegram**: `isTelegram`, `haptic.*`, `openLink` (сам выбирает openTelegramLink/openLink), `downloadFile`, `scanQr`. В Telegram «Назад» — системная кнопка (Page включает её сам), в браузере — своя.
- **Дизайн**: стиль iOS, **белый фон**, карточки — светло-серые (`--fill`), акцент — оранжевый градиент «Поколения» (`--gradient`, `--accent`). Только классы и токены из `app.css`: `.card`, `.card.hero`, `.list` + `Row`, `.btn.primary/.secondary/.tinted`, `.chip`, `.stack`, `.grid-2`, `.section-label`, `.banner`. Тёмной темы нет намеренно: так попросили.
- Логотип: `<div class="logo">Поколение</div>` (шрифт Unbounded 800, градиент).

## Рецепты

**Новый экран:** создать компонент в `js/views/x.js` → добавить `['/x', X]` в `ROUTES` (`app.js`) → ссылка на него из `MenuTab` (`views/menu.js`) через `<${Row} icon=... title=... href="/x" />`. Иконки — только те, что есть в `js/icons.js`. Новую иконку берите из пакета `lucide-static` (внутренности `<svg>`).

**Новый API-эндпоинт в группе:** добавить `r.get/post(...)` в подходящий `server/api/*.js` (роутеры уже смонтированы под `/api/g/:gid`), проверить права (`requireStaff`/`requireCurator` или сравнение с `req.user.id`), фильтровать по `req.group.id`, валидировать вход через `util.js`.

**Новый вид баллов:** ключ в `POINTS` → `addPoints(...)` в нужном обработчике. Он автоматически появится в «Как начисляются баллы».

**Новый вид уведомлений:** ключ и подпись в `NOTIFY_KINDS` (`notify.js`) → передавать `kind` в `notifyUser/notifyMembers`. Переключатель в «Уведомлениях» появится сам.

**Новая фоновая задача:** функция в `jobs.js`, вызов из `tick()`. Задачи «раз в день/неделю» защищайте `markOnce('ключ:группа:дата')`, а время считайте по `group.tz` через `localParts`.

**Новая команда бота:** `bot.command('name', ...)` внутри `setupBot` и описание в `registerCommands()`.

## Запуск и проверка

```bash
npm install
npm run dev                    # http://localhost:3100, DEV_LOGIN=1, перезапуск при изменениях сервера
node scripts/seed-demo.mjs     # в другом терминале: тестовая группа с данными
```

Вход на экране «Тестовый вход»: «Тимофей Морозов» (куратор и администратор), «Игорь Столяров» (наставник), «Анна Ковалёва» (ментор), «Маша Петрова» (участник). Переключатель «Администратор» для обычных людей не включайте. Данные хранятся в `./data/` (папка в `.gitignore`); чтобы начать с нуля, удалите её.

Автотестов пока нет. Перед тем как влить ветку в `main`:
- `node --check` для изменённых серверных файлов;
- пройти затронутые экраны в браузере (ширина как у телефона, ~390px) и посмотреть, что в консоли нет ошибок;
- для изменений в боте — запустить с тестовым ботом (`BOT_TOKEN=... npm run dev`) или проверить обработчики через `setupBot` с подменой API (`bot.api.config.use`).

## Выкладка

- **Ветка `main` = продакшен.** Сервер раз в минуту делает `git fetch`, при новом коммите — `git reset --hard origin/main` и `deploy/install.sh` (зависимости переустанавливаются, только если поменялся `package-lock.json`). Поэтому работаем в ветках и вливаем в `main` через Pull Request.
- На сервере: код `/opt/pokolenie`, база и `secret.key` в `/var/lib/pokolenie`, настройки `/etc/pokolenie/env`, служба `pokolenie` (порт 3100), таймер `pokolenie-update`. Логи: `journalctl -u pokolenie -f`.
- На том же сервере живёт другой проект («Порядок», порт 3000). Caddy раздаёт оба: у каждого свой файл в `/etc/caddy/sites/`, а главный `Caddyfile` только подключает их (`import /etc/caddy/sites/*.caddy`). **Не перезаписывайте `/etc/caddy/Caddyfile` целиком.**
- Память сервера — 1 ГБ: служба ограничена `MemoryMax=350M`. Не держите в памяти большие объёмы данных, не добавляйте тяжёлые зависимости.

## Переменные окружения

| Переменная | Где | Зачем |
|---|---|---|
| `BOT_TOKEN` | `/etc/pokolenie/env` | токен бота от @BotFather |
| `ADMIN_TG_IDS` | `/etc/pokolenie/env` | Telegram ID главных администратора(ов) через запятую |
| `DOMAIN` | `/etc/pokolenie/env` | домен сайта (`nspokolonye.site`); по нему install.sh собирает `PUBLIC_URL` |
| `PUBLIC_URL` | выставляет install.sh | адрес сайта для кнопок Mini App и ссылок календаря |
| `DATA_DIR`, `PORT` | выставляет install.sh | папка базы, порт (3100) |
| `TELEGRAM_API_ROOT` | `/etc/pokolenie/env`, по необходимости | адрес посредника для Telegram API, если хостинг не пускает к api.telegram.org (`deploy/telegram-proxy-worker.js`) |
| `DEV_LOGIN=1` | **только локально** | тестовый вход без Telegram |
