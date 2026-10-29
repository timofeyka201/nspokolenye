import { parseJson } from '../db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

// Строка из запроса: обрезаем пробелы и длину; required — обязательное поле с понятной ошибкой
export function str(v, max = 500, { required = false, label = 'Поле' } = {}) {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max);
  if (required && !s) fail(400, `${label}: заполните, пожалуйста`);
  return s;
}
export function isoOrNull(v, label = 'Дата') {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) fail(400, `${label}: неверный формат`);
  return new Date(t).toISOString();
}
export function dateOrNull(v) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, 'Дата: неверный формат');
  return v;
}
export function url(v, { required = false } = {}) {
  let s = str(v, 2000, { required, label: 'Ссылка' });
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  if (!/^(https?|tg|mailto):/i.test(s)) fail(400, 'Ссылка должна начинаться с https://');
  return s;
}

export const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : 'Без имени');

// Короткая карточка человека — для списков
export function userCard(u) {
  if (!u) return null;
  return {
    id: u.id ?? u.user_id,
    name: fullName(u),
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    photo_url: u.photo_url,
    role: u.role,
  };
}

// Полный профиль. День рождения без года видят все, полную дату — сам человек и команда
export function userProfile(u, { self = false, staff = false } = {}) {
  return {
    ...userCard(u),
    verified: !!u.bot_started,
    birthdate: self || staff ? u.birthdate : null,
    birthday: u.birthdate ? u.birthdate.slice(5) : null,
    bio: u.bio,
    can_help: u.can_help,
    need_help: u.need_help,
    tags: parseJson(u.tags, []),
  };
}

export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
