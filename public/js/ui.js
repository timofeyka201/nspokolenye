// Компоненты интерфейса в стиле iOS
import { html, render, useState, useEffect, useRef, initials } from './lib.js';
import { ICONS } from './icons.js';
import { back as goBack, navigate } from './router.js';
import { haptic, setBackButton, isTelegram } from './tg.js';

export function Icon({ name, size, class: cls = '', style }) {
  return html`<svg class=${cls} style=${style} width=${size || 24} height=${size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

export const Verified = () => html`<svg class="verified" viewBox="0 0 24 24" aria-label="Профиль подтверждён"><path fill="currentColor" d="M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1L2.6 15.8l1-3.1-1-3.1L5.2 7.7l1-3.1 3.2.2z"/><path d="M8 12.2l2.7 2.7L16.3 9.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- Страница с навбаром и большим заголовком ----------
export function Page({ title, eyebrow, sub, back, right, left, children, large = true, dir, noTabs = false, titleNode }) {
  const sentinel = useRef();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, []);
  const onBack = back ? () => { haptic.tap(); goBack(typeof back === 'string' ? back : '/'); } : null;
  // В Telegram «назад» — системная кнопка в шапке, в браузере — своя
  useEffect(() => { setBackButton(onBack); return () => setBackButton(null); }, [!!back, typeof back === 'string' ? back : '']);
  return html`<div class=${`screen ${noTabs ? 'no-tabs' : ''} ${dir === 'forward' ? 'page-enter' : dir === 'back' ? 'page-back' : 'fade-in'}`}>
    <div class=${`navbar ${scrolled ? 'scrolled' : ''} ${large ? '' : 'always-title'}`}>
      <div class="nav-left">
        ${onBack && !isTelegram ? html`<button class="nav-btn nav-back" onClick=${onBack} aria-label="Назад"><${Icon} name="chevron-left" /></button>` : left}
      </div>
      <div class="nav-title">${title}</div>
      <div class="nav-right">${right}</div>
    </div>
    ${large ? html`<div class="large-title" ref=${sentinel}>
      ${eyebrow && html`<div class="eyebrow">${eyebrow}</div>`}
      ${titleNode || html`<h1>${title}</h1>`}
      ${sub && html`<div class="sub">${sub}</div>`}
    </div>` : html`<div ref=${sentinel} style="height:12px"></div>`}
    <div class="content">${children}</div>
  </div>`;
}

export function NavButton({ icon, label, onClick, accent, round = true }) {
  return html`<button class=${`nav-btn ${round ? 'round' : ''} ${accent ? 'accent' : ''}`} onClick=${() => { haptic.tap(); onClick(); }} aria-label=${label}>
    ${icon ? html`<${Icon} name=${icon} size=${20} />` : label}
  </button>`;
}

// ---------- Таббар ----------
const TAB_ITEMS = [
  { path: '/', icon: 'house', label: 'Главная' },
  { path: '/calendar', icon: 'calendar', label: 'Календарь' },
  { path: '/goals', icon: 'target', label: 'Цели' },
  { path: '/people', icon: 'users', label: 'Люди' },
  { path: '/menu', icon: 'layout-grid', label: 'Ещё' },
];
export function TabBar({ path, badges = {} }) {
  return html`<nav class="tabbar">
    ${TAB_ITEMS.map((t) => html`<button class=${`tab ${path === t.path ? 'active' : ''}`} onClick=${() => { if (path !== t.path) { haptic.select(); navigate(t.path); } else window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
      <${Icon} name=${t.icon} />
      <span>${t.label}</span>
      ${badges[t.path] ? html`<span class="dot">${badges[t.path]}</span>` : null}
    </button>`)}
  </nav>`;
}

// ---------- Аватар ----------
const GRADS = ['#ff4b0f,#ff9a5c', '#ff7a33,#ffb37a', '#ff5e3a,#ff2a68', '#f7971e,#ffd200', '#ff6a00,#ee0979', '#fc4a1a,#f7b733'];
export function Avatar({ user, size = 40 }) {
  const name = user?.name || [user?.first_name, user?.last_name].join(' ');
  const g = GRADS[(user?.id || 0) % GRADS.length];
  const [broken, setBroken] = useState(false);
  return html`<div class="avatar" style=${{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px', background: `linear-gradient(135deg, ${g})` }}>
    ${user?.photo_url && !broken ? html`<img src=${user.photo_url} alt="" loading="lazy" onError=${() => setBroken(true)} />` : initials(name)}
  </div>`;
}
export function AvatarStack({ users = [], size = 28, max = 4 }) {
  return html`<div class="avatar-stack">${users.slice(0, max).map((u) => html`<${Avatar} key=${u.id} user=${u} size=${size} />`)}</div>`;
}

// ---------- Списки ----------
export function List({ children, white, class: cls = '' }) {
  return html`<div class=${`list ${white ? 'white' : ''} ${cls}`}>${children}</div>`;
}

const ICON_COLORS = { orange: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', blue: 'var(--blue)', purple: 'var(--purple)', yellow: '#ff9500', gray: '#8e8e93', pink: '#ff2d55', teal: '#30b0c7', indigo: '#5856d6' };
export function Row({ icon, color = 'orange', emoji, avatar, title, sub, value, chevron, onClick, href, danger, accent, right, bold, class: cls = '', badge }) {
  const Tag = onClick || href ? 'button' : 'div';
  const click = onClick || (href ? () => navigate(href) : null);
  return html`<${Tag} class=${`row ${icon || emoji ? 'has-icon' : ''} ${avatar ? 'has-avatar' : ''} ${danger ? 'danger' : ''} ${accent ? 'accent' : ''} ${cls}`}
    onClick=${click ? () => { haptic.tap(); click(); } : undefined}>
    ${icon && html`<div class="row-icon" style=${{ background: ICON_COLORS[color] || color }}><${Icon} name=${icon} /></div>`}
    ${emoji && html`<div class="row-icon" style=${{ background: 'var(--fill-2)', fontSize: '19px' }}>${emoji}</div>`}
    ${avatar && html`<${Avatar} user=${avatar} size=${44} />`}
    <div class="row-main">
      <div class=${`row-title ${bold ? 'bold' : ''}`}>${title}</div>
      ${sub && html`<div class="row-sub">${sub}</div>`}
    </div>
    ${badge ? html`<span class="badge-count">${badge}</span>` : null}
    ${value != null && value !== '' && html`<div class="row-value">${value}</div>`}
    ${right}
    ${(chevron ?? !!(onClick || href)) && !danger && !accent ? html`<${Icon} name="chevron-right" class="chev" />` : null}
  </${Tag}>`;
}

export function Section({ title, action, onAction, children, foot }) {
  return html`<section class="section">
    ${title && html`<div class="section-head"><h2>${title}</h2>${action && html`<button class="link" onClick=${() => { haptic.tap(); onAction(); }}>${action}</button>`}</div>`}
    ${children}
    ${foot && html`<div class="section-foot">${foot}</div>`}
  </section>`;
}

// ---------- Элементы управления ----------
export function Button({ kind = 'primary', icon, children, onClick, block, sm, disabled, type = 'button', loading }) {
  const [busy, setBusy] = useState(false);
  const click = async (e) => {
    if (!onClick) return;
    haptic.tap();
    const r = onClick(e);
    if (r?.then) { setBusy(true); try { await r; } finally { setBusy(false); } }
  };
  const isBusy = busy || loading;
  return html`<button type=${type} class=${`btn ${kind} ${block ? 'block' : ''} ${sm ? 'sm' : ''}`} onClick=${click} disabled=${disabled || isBusy}>
    ${isBusy ? html`<span class="spinner" style=${kind === 'primary' ? 'border-color:rgba(255,255,255,.35);border-top-color:#fff' : ''}></span>` : icon && html`<${Icon} name=${icon} />`}
    ${children}
  </button>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle" aria-label=${label}>
    <input type="checkbox" checked=${checked} onChange=${(e) => { haptic.select(); onChange(e.target.checked); }} />
    <span></span>
  </label>`;
}

export function Segmented({ value, options, onChange }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return html`<div class="segmented" role="tablist">
    <div class="seg-pill" style=${{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)`, left: '2px' }}></div>
    ${options.map((o) => html`<button role="tab" aria-selected=${o.value === value} onClick=${() => { if (o.value !== value) { haptic.select(); onChange(o.value); } }}>${o.label}</button>`)}
  </div>`;
}

export function Ring({ value = 0, size = 56, stroke = 6, label, color = 'url(#ringGrad)', track = 'var(--fill-2)', fontSize }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return html`<div class="ring" style=${{ width: size + 'px', height: size + 'px' }}>
    <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`}>
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4b0f" /><stop offset="1" stop-color="#ff9a5c" /></linearGradient></defs>
      <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${track} stroke-width=${stroke} />
      <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${color} stroke-width=${stroke} stroke-linecap="round"
        stroke-dasharray=${c} stroke-dashoffset=${c * (1 - v / 100)} style="transition: stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)" />
    </svg>
    <span class="ring-label" style=${{ fontSize: (fontSize || Math.round(size * 0.26)) + 'px' }}>${label ?? `${Math.round(v)}%`}</span>
  </div>`;
}

export const Bar = ({ value = 0, green }) => html`<div class=${`bar ${green ? 'green' : ''}`}><div style=${{ width: `${Math.max(0, Math.min(100, value))}%` }}></div></div>`;

export function Empty({ emoji = '✨', title, text, action, onAction, icon }) {
  return html`<div class="empty">
    <div class="em">${emoji}</div>
    ${title && html`<h3>${title}</h3>`}
    ${text && html`<p>${text}</p>`}
    ${action && html`<${Button} kind="tinted" sm icon=${icon} onClick=${onAction}>${action}</${Button}>`}
  </div>`;
}

export const Skeleton = ({ h = 80, r }) => html`<div class="skeleton" style=${{ height: h + 'px', borderRadius: r ? r + 'px' : undefined }}></div>`;
export const Loading = () => html`<div class="stack"><${Skeleton} h=${120} /><${Skeleton} h=${64} /><${Skeleton} h=${64} /></div>`;

// Обёртка: скелетон при первой загрузке, ошибка с кнопкой «Повторить»
export function Async({ state, children, skeleton }) {
  if (state.data) return children(state.data);
  if (state.error) {
    return html`<${Empty} emoji="😕" title="Не загрузилось" text=${state.error.message} action="Повторить" onAction=${state.reload} />`;
  }
  return skeleton || html`<${Loading} />`;
}

export function Field({ label, hint, children }) {
  return html`<div class="field">${label && html`<label>${label}</label>`}${children}${hint && html`<div class="hint">${hint}</div>`}</div>`;
}

// Многострочное поле, которое растёт по мере ввода
export function AutoTextarea({ value, onInput, placeholder, rows = 3, maxLength, autofocus }) {
  const ref = useRef();
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 360) + 'px'; };
  useEffect(fit, [value]);
  useEffect(() => { if (autofocus) setTimeout(() => ref.current?.focus(), 350); }, []);
  return html`<textarea ref=${ref} class="textarea" rows=${rows} value=${value} placeholder=${placeholder} maxLength=${maxLength}
    onInput=${(e) => { onInput(e.target.value); fit(); }}></textarea>`;
}

export function TagInput({ value = [], onChange, suggestions = [] }) {
  const [text, setText] = useState('');
  const add = (t) => {
    const v = t.trim().replace(/^#/, '');
    if (!v || value.some((x) => x.toLowerCase() === v.toLowerCase()) || value.length >= 15) return;
    haptic.select();
    onChange([...value, v]);
    setText('');
  };
  const rest = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase()));
  return html`<div class="stack-sm">
    ${value.length ? html`<div class="chips">${value.map((t) => html`<button class="chip accent" onClick=${() => onChange(value.filter((x) => x !== t))}>${t} <${Icon} name="x" /></button>`)}</div>` : null}
    <input class="input" value=${text} placeholder="Добавить интерес и нажать Enter" maxLength="30"
      onInput=${(e) => { const v = e.target.value; if (v.endsWith(',')) add(v.slice(0, -1)); else setText(v); }}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }} onBlur=${() => text && add(text)} />
    ${rest.length ? html`<div class="chips">${rest.slice(0, 14).map((s) => html`<button class="chip" onClick=${() => add(s)}>+ ${s}</button>`)}</div>` : null}
  </div>`;
}

export const TAG_SUGGESTIONS = ['Бизнес', 'Предпринимательство', 'IT', 'Программирование', 'Дизайн', 'Маркетинг', 'Финансы', 'Спорт', 'Музыка', 'Кино', 'Книги', 'Психология', 'Наука', 'Медицина', 'Право', 'Журналистика', 'Блогинг', 'Фотография', 'Путешествия', 'Языки', 'Волонтёрство', 'Олимпиады', 'Поступление', 'Публичные выступления', 'Лидерство', 'Искусство', 'Театр', 'Танцы', 'Робототехника', 'Экология'];

// ---------- Шторки, диалоги, тосты ----------
let sheetHost = null;
export function SheetHost() {
  const [sheets, setSheets] = useState([]);
  useEffect(() => { sheetHost = setSheets; return () => { sheetHost = null; }; }, []);
  return html`${sheets.map((s) => html`<${SheetFrame} key=${s.id} ...${s} />`)}`;
}

function SheetFrame({ id, Comp, props, resolve }) {
  const [closing, setClosing] = useState(false);
  const close = (result) => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => { sheetHost?.((list) => list.filter((s) => s.id !== id)); resolve(result); }, 210);
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, []);
  return html`<div class=${`sheet-backdrop ${closing ? 'closing' : ''}`} onClick=${(e) => e.target === e.currentTarget && close()}>
    <div class="sheet" role="dialog"><${Comp} ...${props} close=${close} /></div>
  </div>`;
}

let sheetSeq = 0;
export function openSheet(Comp, props = {}) {
  haptic.soft();
  return new Promise((resolve) => sheetHost?.((list) => [...list, { id: ++sheetSeq, Comp, props, resolve }]));
}

export function SheetLayout({ title, close, done, doneLabel = 'Готово', doneDisabled, children, cancelLabel = 'Отмена' }) {
  const [busy, setBusy] = useState(false);
  const onDone = async () => {
    if (!done) return;
    haptic.tap();
    setBusy(true);
    try { await done(); } finally { setBusy(false); }
  };
  return html`<div class="sheet-grab"></div>
    <div class="sheet-head">
      <div><button class="nav-btn" onClick=${() => close()}>${cancelLabel}</button></div>
      <h3>${title}</h3>
      <div style="display:flex;justify-content:flex-end">${done && html`<button class="nav-btn" style="font-weight:650" disabled=${doneDisabled || busy} onClick=${onDone}>${busy ? html`<span class="spinner"></span>` : doneLabel}</button>`}</div>
    </div>
    <div class="sheet-body">${children}</div>`;
}

function ActionSheet({ title, actions, close }) {
  return html`<div class="sheet-body actions" style="padding-top:12px">
    <div class="list">
      ${title && html`<div class="title">${title}</div>`}
      ${actions.map((a, i) => html`<button class=${`row ${a.danger ? 'danger' : ''}`} onClick=${() => { haptic.tap(); close(i); }}>${a.label}</button>`)}
    </div>
    <div class="list"><button class="row cancel" onClick=${() => close(null)}>Отмена</button></div>
  </div>`;
}

export async function actionSheet(actions, title) {
  const list = actions.filter(Boolean);
  const i = await openSheet(ActionSheet, { actions: list, title });
  if (i != null) await list[i].onClick?.();
  return i;
}

export async function confirm(text, { ok = 'Да', danger = false } = {}) {
  const i = await openSheet(ActionSheet, { title: text, actions: [{ label: ok, danger }] });
  return i === 0;
}

let toastHost = null;
export function ToastHost() {
  const [items, set] = useState([]);
  useEffect(() => { toastHost = set; }, []);
  return html`<div class="toast-host">${items.map((t) => html`<div key=${t.id} class=${`toast ${t.error ? 'error' : ''}`}>
    ${t.icon && html`<${Icon} name=${t.icon} />`}<span>${t.text}</span></div>`)}</div>`;
}
let toastSeq = 0;
export function toast(text, { error = false, icon } = {}) {
  if (!toastHost) return;
  if (error) haptic.error(); else haptic.success();
  const id = ++toastSeq;
  toastHost((l) => [...l.slice(-2), { id, text, error, icon: icon ?? (error ? 'circle-help' : 'circle-check') }]);
  setTimeout(() => toastHost((l) => l.filter((t) => t.id !== id)), error ? 4000 : 2400);
}

// Обёртка для действий: показывает ошибку тостом
export async function attempt(fn, success) {
  try {
    const r = await fn();
    if (success) toast(success);
    return r ?? true;
  } catch (e) {
    toast(e.message, { error: true });
    return null;
  }
}

export function mount(el, vnode) { render(vnode, el); }
