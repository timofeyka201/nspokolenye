// Навигация по адресам /event/12 и т.п. с историей браузера: «назад» работает и кнопкой Telegram, и жестом
import { useState, useEffect } from './lib.js';

export const TABS = ['/', '/calendar', '/goals', '/people', '/menu'];
const subs = new Set();
let dir = 'none';

const emit = () => subs.forEach((f) => f({ path: location.pathname, search: location.search, dir }));

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search && !replace) return;
  const isTab = TABS.includes(path.split('?')[0]);
  const depth = isTab ? 0 : (history.state?.depth || 0) + (replace ? 0 : 1);
  history[replace ? 'replaceState' : 'pushState']({ depth }, '', path);
  dir = isTab ? 'none' : replace ? 'none' : 'forward';
  window.scrollTo(0, 0);
  emit();
}

// Назад: по истории, если пришли изнутри приложения, иначе — на «родительский» экран
export function back(fallback = '/') {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

window.addEventListener('popstate', () => { dir = 'back'; emit(); });

export function useRoute() {
  const [r, set] = useState({ path: location.pathname, search: location.search, dir });
  useEffect(() => {
    subs.add(set);
    set({ path: location.pathname, search: location.search, dir });
    return () => subs.delete(set);
  }, []);
  return r;
}

export const query = (search = location.search) => Object.fromEntries(new URLSearchParams(search));

// '/event/:id' + '/event/12' → { id: '12' }
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean), b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
