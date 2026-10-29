// Общие вещи: Preact + htm, состояние приложения, запросы к серверу, форматирование
import { html, render, useState, useEffect, useRef, useMemo, useCallback, useReducer, useLayoutEffect } from '/vendor/htm-preact.js';

export { html, render, useState, useEffect, useRef, useMemo, useCallback, useReducer, useLayoutEffect };

// ---------- Хранилище ----------
const state = { me: null, gid: null, booted: false };
const subs = new Set();
export const store = {
  get: () => state,
  set(patch) { Object.assign(state, patch); subs.forEach((f) => f()); },
};
export function useStore(select = (s) => s) {
  const [, force] = useReducer((x) => x + 1, 0);
  // после подписки сразу перерисовываемся: состояние могло измениться до неё
  useEffect(() => { subs.add(force); force(); return () => subs.delete(force); }, []);
  return select(state);
}
export const currentGroup = () => state.me?.groups.find((g) => g.id === state.gid) || null;

// ---------- localStorage (может быть недоступен) ----------
export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

// ---------- Сервер ----------
let token = storage.get('pk_token');
export const setToken = (t) => { token = t; storage.set('pk_token', t); };
export const hasToken = () => !!token;

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/telegram') {
    setToken(null);
    window.dispatchEvent(new Event('pk:logout'));
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Что-то пошло не так');
  return data;
}
export const gpath = (path) => `/g/${state.gid}${path}`;
export const gapi = (path, opts) => api(gpath(path), opts);

// Данные с кэшем: при возврате на экран сразу показываем прошлый ответ и тихо обновляем
const cache = new Map();
export function useApi(path) {
  const [s, set] = useState(() => ({ data: path ? cache.get(path) : null, error: null, loading: !!path && !cache.has(path) }));
  const pathRef = useRef(path);
  pathRef.current = path;
  const load = useCallback(async () => {
    if (!path) return null;
    try {
      const d = await api(path);
      cache.set(path, d);
      if (pathRef.current === path) set({ data: d, error: null, loading: false });
      return d;
    } catch (e) {
      if (pathRef.current === path) set((x) => ({ ...x, error: e, loading: false }));
      return null;
    }
  }, [path]);
  useEffect(() => {
    set({ data: path ? cache.get(path) : null, error: null, loading: !!path && !cache.has(path) });
    load();
  }, [path]);
  const setData = useCallback((d) => set((x) => {
    const data = typeof d === 'function' ? d(x.data) : d;
    cache.set(path, data);
    return { ...x, data };
  }), [path]);
  return { ...s, reload: load, setData };
}
export const useG = (path) => useApi(state.gid ? gpath(path) : null);
export const clearCache = () => cache.clear();

export async function refreshMe() {
  const me = await api('/me');
  store.set({ me });
  return me;
}

// ---------- Форматирование ----------
const RU = 'ru-RU';
const f = (opts) => new Intl.DateTimeFormat(RU, opts);
const fmtTime = f({ hour: '2-digit', minute: '2-digit' });
const fmtDayMonth = f({ day: 'numeric', month: 'long' });
const fmtWdDayMonth = f({ weekday: 'short', day: 'numeric', month: 'long' });
const fmtMonthYear = f({ month: 'long', year: 'numeric' });
const fmtShortMonth = f({ month: 'short' });

export const time = (iso) => fmtTime.format(new Date(iso));
export const dayMonth = (iso) => fmtDayMonth.format(new Date(iso));
export const wdDayMonth = (iso) => fmtWdDayMonth.format(new Date(iso));
export const monthYear = (d) => fmtMonthYear.format(d);
export const shortMonth = (iso) => fmtShortMonth.format(new Date(iso)).replace('.', '');

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
export function dayLabel(iso) {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  return wdDayMonth(iso);
}
export const whenLabel = (iso, end) => `${dayLabel(iso)}, ${time(iso)}${end ? `–${time(end)}` : ''}`;

export function relative(iso) {
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000), h = Math.round(abs / 3600000), d = Math.round(abs / 86400000);
  let s;
  if (m < 1) return 'только что';
  if (m < 60) s = `${m} ${plural(m, ['минуту', 'минуты', 'минут'])}`;
  else if (h < 24) s = `${h} ${plural(h, ['час', 'часа', 'часов'])}`;
  else if (d < 30) s = `${d} ${plural(d, ['день', 'дня', 'дней'])}`;
  else return dayMonth(iso);
  return diff > 0 ? `через ${s}` : `${s} назад`;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const pl = (n, forms) => `${n} ${plural(n, forms)}`;

const pad = (n) => String(n).padStart(2, '0');
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const todayInput = () => toLocalInput(new Date().toISOString()).slice(0, 10);

export function initials(name = '') {
  const p = name.replace('@', '').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}
export const firstName = (u) => u?.first_name || u?.name?.split(' ')[0] || '';

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function birthdayLabel(md) {
  if (!md) return '';
  const [m, d] = md.split('-').map(Number);
  return fmtDayMonth.format(new Date(2000, m - 1, d));
}

export function ageFrom(date) {
  if (!date) return null;
  const b = new Date(date), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

export const KIND = {
  meeting: { title: 'Встреча', emoji: '🤝' },
  stream: { title: 'Эфир', emoji: '📺' },
  deadline: { title: 'Дедлайн', emoji: '⏰' },
  other: { title: 'Событие', emoji: '📌' },
  task: { title: 'Задание', emoji: '📝' },
};

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove();
    return ok;
  }
}
