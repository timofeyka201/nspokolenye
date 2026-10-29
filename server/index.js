import express from 'express';
import path from 'node:path';
import { ROOT } from './db.js';
import { config } from './config.js';
import { api } from './api/index.js';
import { userCalendar, singleEventCalendar } from './ical.js';
import { startBot, stopBot } from './bot.js';
import { startJobs } from './jobs.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
// в Express 5 у запроса без тела req.body не определён — обработчикам проще всегда получать объект
app.use((req, res, next) => { req.body ??= {}; next(); });

app.use('/api', api);

// Календарь: личная подписка (Google/Apple Calendar) и файл одного события
app.get('/cal/:token.ics', (req, res) => {
  const ics = userCalendar(req.params.token);
  if (!ics) return res.status(404).send('Календарь не найден');
  res.type('text/calendar; charset=utf-8').setHeader('Cache-Control', 'no-cache');
  res.send(ics);
});
app.get('/cal/event/:id.ics', (req, res) => {
  const ics = singleEventCalendar(+req.params.id, String(req.query.s || ''));
  if (!ics) return res.status(404).send('Событие не найдено');
  res.type('text/calendar; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="event-${+req.params.id}.ics"`);
  res.send(ics);
});

const pub = path.join(ROOT, 'public');
for (const dir of ['fonts', 'vendor']) {
  app.use(`/${dir}`, express.static(path.join(pub, dir), { index: false, maxAge: '30d', immutable: true, fallthrough: false }));
}
// no-cache: браузер сверяет файлы с сервером, чтобы после обновления не смешались старые и новые модули
app.use(express.static(pub, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get(/^(?!\/(api|cal)\/).*/, (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(pub, 'index.html'));
});

const server = app.listen(config.port, () => {
  console.log(`«Поколение» запущено: http://localhost:${config.port}`);
  // фоновые задачи не ждут бота: уведомления копятся в очереди и уйдут, когда бот подключится
  startJobs();
  startBot().catch((e) => console.error('Не удалось запустить бота:', e.message));
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await stopBot().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
