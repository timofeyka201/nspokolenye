// Работа с часовыми поясами без внешних библиотек.
// В базе всё время хранится в UTC (ISO-строки), а «10 утра» и «понедельник» считаются по поясу группы.

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(date = new Date(), tz = 'Europe/Moscow') {
  const p = Object.fromEntries(fmt(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: WD[p.weekday] };
}

const pad = (n) => String(n).padStart(2, '0');
export function localDate(date = new Date(), tz = 'Europe/Moscow') {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Местное время в поясе tz → момент в UTC
export function zonedToUtc(y, m, d, h = 0, min = 0, tz = 'Europe/Moscow') {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return new Date(guess);
}

export function monthStart(tz, date = new Date()) {
  const p = localParts(date, tz);
  return { iso: zonedToUtc(p.year, p.month, 1, 0, 0, tz).toISOString(), day: `${p.year}-${pad(p.month)}-01`, key: `${p.year}-${pad(p.month)}` };
}

export function prevMonthStart(tz, date = new Date()) {
  const p = localParts(date, tz);
  const y = p.month === 1 ? p.year - 1 : p.year;
  const m = p.month === 1 ? 12 : p.month - 1;
  return { iso: zonedToUtc(y, m, 1, 0, 0, tz).toISOString(), day: `${y}-${pad(m)}-01`, key: `${y}-${pad(m)}` };
}

// Ключ недели: дата понедельника в поясе группы
export function weekKey(tz, date = new Date()) {
  const p = localParts(date, tz);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - (p.weekday - 1)));
  return monday.toISOString().slice(0, 10);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

// «пт, 31 октября, 18:30» — для сообщений бота
export function humanDateTime(iso, tz = 'Europe/Moscow', { weekday = true } = {}) {
  const p = localParts(new Date(iso), tz);
  return `${weekday ? WEEKDAYS[p.weekday] + ', ' : ''}${p.day} ${MONTHS[p.month - 1]}, ${pad(p.hour)}:${pad(p.minute)}`;
}
export function humanDate(iso, tz = 'Europe/Moscow') {
  const p = localParts(new Date(iso), tz);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}
export function humanTime(iso, tz = 'Europe/Moscow') {
  const p = localParts(new Date(iso), tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
