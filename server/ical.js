import crypto from 'node:crypto';
import { all, get, SECRET } from './db.js';
import { config } from './config.js';

// Календарь в формате iCalendar (RFC 5545): подписка для Google/Apple Calendar и файлы отдельных событий
const KIND_PREFIX = { meeting: '', stream: '📺 ', deadline: '⏰ ', other: '' };

const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Строки длиннее 75 байт переносятся (с пробелом в начале продолжения)
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 74) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

function vevent({ uid, start, end, title, description, location, url, cancelled, alarm }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end || new Date(Date.parse(start) + 3600_000).toISOString())}`,
    `SUMMARY:${icsEscape(title)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (url) lines.push(`URL:${icsEscape(url)}`);
  if (cancelled) lines.push('STATUS:CANCELLED');
  if (alarm && !cancelled) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, `TRIGGER:-PT${alarm}M`, 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

function calendar(name, events) {
  const host = new URL(config.publicUrl).hostname;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pokolenie//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`, 'X-WR-TIMEZONE:Europe/Moscow', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of events) lines.push(...vevent({ ...e, uid: `${e.uid}@${host}` }));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const eventToIcs = (e, groupName) => ({
  uid: `event-${e.id}`, start: e.starts_at, end: e.ends_at,
  title: `${KIND_PREFIX[e.kind] || ''}${e.title}`,
  description: [e.description, e.url, groupName && `Группа: ${groupName}`].filter(Boolean).join('\n\n'),
  location: e.location, url: e.url, cancelled: !!e.cancelled, alarm: e.kind === 'deadline' ? 0 : 60,
});

export function userCalendar(token) {
  const u = get('SELECT * FROM users WHERE cal_token = ?', token);
  if (!u) return null;
  const groups = all("SELECT g.* FROM members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? AND m.status = 'active'", u.id);
  const items = [];
  for (const g of groups) {
    for (const e of all(`SELECT * FROM events WHERE group_id = ? AND starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')`, g.id)) {
      items.push(eventToIcs(e, groups.length > 1 ? g.name : ''));
    }
    for (const t of all(`SELECT * FROM tasks WHERE group_id = ? AND due_at IS NOT NULL AND due_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')`, g.id)) {
      items.push({ uid: `task-${t.id}`, start: new Date(Date.parse(t.due_at) - 1800_000).toISOString(), end: t.due_at, title: `📝 Задание: ${t.title}`, description: [t.description, t.url].filter(Boolean).join('\n\n'), alarm: 24 * 60 });
    }
  }
  return calendar(groups.length === 1 ? `Поколение · ${groups[0].name}` : 'Поколение', items);
}

export const eventSig = (id) => crypto.createHmac('sha256', SECRET).update(`ics:${id}`).digest('base64url').slice(0, 16);
export const eventIcsUrl = (id) => `${config.publicUrl}/cal/event/${id}.ics?s=${eventSig(id)}`;

export function singleEventCalendar(id, sig) {
  if (sig !== eventSig(id)) return null;
  const e = get('SELECT * FROM events WHERE id = ?', id);
  if (!e) return null;
  return calendar(e.title, [eventToIcs(e)]);
}

// Ссылка «Добавить в Google Календарь» для одного события
export function googleCalendarUrl(e) {
  const end = e.ends_at || new Date(Date.parse(e.starts_at) + 3600_000).toISOString();
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: e.title, dates: `${icsDate(e.starts_at)}/${icsDate(end)}`,
    details: [e.description, e.url].filter(Boolean).join('\n\n'), location: e.location || '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
