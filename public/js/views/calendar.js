// Календарь, события, отметка на встрече, анонимная обратная связь
import { html, useState, useMemo, useStore, useG, gapi, currentGroup, time, dayMonth, wdDayMonth, whenLabel, dayLabel, monthYear, sameDay, toLocalInput, fromLocalInput, KIND, pl, copyText, api, refreshMe } from '../lib.js';
import { Page, Icon, List, Row, Section, Button, Segmented, Toggle, Field, AutoTextarea, Empty, Async, Bar, NavButton, openSheet, SheetLayout, actionSheet, confirm, toast, attempt, Skeleton } from '../ui.js';
import { navigate, back } from '../router.js';
import { openLink, downloadFile, canScanQr, scanQr, haptic } from '../tg.js';

const KIND_OPTIONS = [
  { value: 'meeting', label: 'Встреча' }, { value: 'stream', label: 'Эфир' },
  { value: 'deadline', label: 'Дедлайн' }, { value: 'other', label: 'Другое' },
];

// ---------- Строка события в списке ----------
export function EventRow({ e, showDate }) {
  const k = e.type === 'task' ? 'task' : e.kind;
  const go = () => navigate(e.type === 'task' ? `/task/${e.id}` : `/event/${e.id}`);
  const start = e.starts_at || e.due_at;
  return html`<button class=${`ev-row tap kind-${k} ${e.cancelled ? 'cancelled' : ''}`} onClick=${() => { haptic.tap(); go(); }}>
    <div class="stripe"></div>
    <div class="row-main">
      <div class="row-title bold">${e.title}</div>
      <div class="row-sub">${showDate ? whenLabel(start, e.ends_at) : `${time(start)}${e.ends_at ? `–${time(e.ends_at)}` : ''}`}${e.location ? ` · ${e.location}` : ''}</div>
      <div class="row-flex" style="margin-top:6px;gap:6px">
        <span class="chip sm" style="background:var(--k-soft);color:var(--k)">${KIND[k].title}</span>
        ${e.cancelled ? html`<span class="chip sm red">Отменено</span>` : null}
        ${e.checked_in ? html`<span class="chip sm green">Вы были</span>` : null}
        ${e.type === 'task' && e.done ? html`<span class="chip sm green">Сдано</span>` : null}
      </div>
    </div>
  </button>`;
}

// ---------- Отметка на встрече ----------
export async function checkInFlow(e, onDone) {
  const submit = async (code) => {
    const r = await attempt(() => gapi(`/events/${e.id}/checkin`, { method: 'POST', body: { code } }));
    if (r) { haptic.success(); toast('Вы отмечены! +10 баллов'); onDone?.(r); }
    return !!r;
  };
  const byCode = () => openSheet(CodeSheet, { submit });
  if (canScanQr()) {
    return actionSheet([
      { label: 'Сканировать QR-код', onClick: async () => {
        const v = await scanQr('Наведите камеру на QR-код встречи');
        const m = v && v.match(/ci_(\d+)_([A-Z0-9]+)/i);
        if (m) await submit(m[2]);
        else if (v) toast('Это не QR-код встречи', { error: true });
      } },
      { label: 'Ввести код', onClick: byCode },
    ], 'Как отметиться?');
  }
  return byCode();
}

function CodeSheet({ close, submit }) {
  const [code, setCode] = useState('');
  return html`<${SheetLayout} title="Код встречи" close=${close} done=${async () => { if (await submit(code)) close(); }} doneLabel="Отметиться" doneDisabled=${code.length < 4}>
    <div class="stack" style="padding-top:8px">
      <p class="muted center small">Код показывает наставник на встрече</p>
      <input class="input center" style="font-size:32px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;min-height:72px"
        maxLength="4" value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} autofocus autocomplete="off" />
    </div>
  </${SheetLayout}>`;
}

// ---------- Добавить в календарь телефона ----------
export function addToCalendar(e) {
  return actionSheet([
    { label: 'Apple Календарь / файл .ics', onClick: () => downloadFile(e.ics_url, `${e.title}.ics`) },
    { label: 'Google Календарь', onClick: () => openLink(e.google_url) },
  ], 'Добавить в календарь');
}

function SubscribeSheet({ close }) {
  const me = useStore((s) => s.me);
  const cal = me.calendar;
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(cal.webcal)}`;
  return html`<${SheetLayout} title="Подписка на календарь" close=${close} cancelLabel="Закрыть">
    <div class="stack">
      <div class="center" style="font-size:54px">🗓</div>
      <p class="center muted" style="font-size:15px">Подпишитесь один раз — и все встречи, эфиры и дедлайны группы будут сами появляться и обновляться в календаре телефона.</p>
      <${Button} block icon="calendar-plus" onClick=${() => openLink(cal.webcal)}>iPhone, iPad, Mac</${Button}>
      <${Button} block kind="secondary" icon="globe" onClick=${() => openLink(google)}>Google Календарь</${Button}>
      <${Button} block kind="secondary" icon="copy" onClick=${async () => { await copyText(cal.http); toast('Ссылка скопирована'); }}>Скопировать ссылку</${Button}>
      <div class="hint">Google обновляет подписки раз в несколько часов, Apple — примерно раз в час. Ссылка личная — не пересылайте её.</div>
      <button class="btn plain" style="color:var(--red)" onClick=${async () => {
        if (await confirm('Старая ссылка перестанет работать. Подписку нужно будет оформить заново.', { ok: 'Сбросить ссылку', danger: true })) {
          await attempt(() => api('/me/calendar/reset', { method: 'POST' }).then(() => refreshMe()), 'Новая ссылка готова');
        }
      }}>Сбросить ссылку</button>
    </div>
  </${SheetLayout}>`;
}
export const openSubscribe = () => openSheet(SubscribeSheet);

// ---------- Форма события ----------
function EventForm({ close, event, day, onSaved }) {
  const g = currentGroup();
  const base = day ? new Date(day) : new Date(Date.now() + 86400000);
  if (!event) base.setHours(18, 0, 0, 0);
  const [f, setF] = useState(() => event ? {
    ...event, starts_at: toLocalInput(event.starts_at), ends_at: toLocalInput(event.ends_at),
  } : {
    kind: 'meeting', title: '', description: '', location: '', url: '',
    starts_at: toLocalInput(base.toISOString()), ends_at: toLocalInput(new Date(base.getTime() + 90 * 60000).toISOString()),
  });
  const [notify, setNotify] = useState(true);
  const [toChat, setToChat] = useState(g.chat_linked);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const body = { ...f, starts_at: fromLocalInput(f.starts_at), ends_at: f.kind === 'deadline' ? null : fromLocalInput(f.ends_at), notify, toChat };
    const r = await attempt(() => gapi(event ? `/events/${event.id}` : '/events', { method: event ? 'PATCH' : 'POST', body }), event ? 'Сохранено' : 'Событие создано');
    if (r) { onSaved?.(r); close(r); }
  };
  return html`<${SheetLayout} title=${event ? 'Изменить' : 'Новое событие'} close=${close} done=${save} doneLabel=${event ? 'Сохранить' : 'Создать'} doneDisabled=${!f.title.trim() || !f.starts_at}>
    <div class="form">
      <${Segmented} value=${f.kind} options=${KIND_OPTIONS} onChange=${set('kind')} />
      <${Field} label="Название"><input class="input" value=${f.title} onInput=${set('title')} placeholder=${f.kind === 'meeting' ? 'Встреча группы' : f.kind === 'stream' ? 'Эфир с приглашённым гостем' : 'Название'} maxLength="120" /></${Field}>
      <div class="stack-sm">
        <${Field} label=${f.kind === 'deadline' ? 'Срок' : 'Начало'}><input class="input" type="datetime-local" value=${f.starts_at} onInput=${set('starts_at')} /></${Field}>
        ${f.kind !== 'deadline' && html`<${Field} label="Конец"><input class="input" type="datetime-local" value=${f.ends_at} onInput=${set('ends_at')} /></${Field}>`}
      </div>
      ${f.kind !== 'deadline' && html`<${Field} label="Место"><input class="input" value=${f.location} onInput=${set('location')} placeholder="Адрес или «Онлайн»" /></${Field}>`}
      <${Field} label="Ссылка"><input class="input" value=${f.url} onInput=${set('url')} placeholder="Zoom, Telemost, YouTube…" inputmode="url" /></${Field}>
      <${Field} label="Описание"><${AutoTextarea} value=${f.description} onInput=${set('description')} placeholder="План встречи, что взять с собой" /></${Field}>
      <${List}>
        <${Row} title="Уведомить участников" right=${html`<${Toggle} checked=${notify} onChange=${setNotify} />`} chevron=${false} />
        ${g.chat_linked && html`<${Row} title="Написать в чат группы" right=${html`<${Toggle} checked=${toChat} onChange=${setToChat} />`} chevron=${false} />`}
      </${List}>
    </div>
  </${SheetLayout}>`;
}
export const openEventForm = (props) => openSheet(EventForm, props);

// ---------- Вкладка «Календарь» ----------
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - shift);
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

export function CalendarTab({ dir }) {
  const g = currentGroup();
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [sel, setSel] = useState(() => new Date());
  const days = useMemo(() => monthGrid(month), [month]);
  const from = days[0].toISOString(), to = new Date(days[41].getTime() + 86400000).toISOString();
  const st = useG(mode === 'month' ? `/events?from=${from}&to=${to}` : '/events');
  const items = useMemo(() => {
    if (!st.data) return [];
    return [...st.data.events, ...st.data.tasks.map((t) => ({ ...t, type: 'task', starts_at: t.due_at }))].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [st.data]);
  const onDay = (d) => items.filter((e) => sameDay(e.starts_at, d));
  const shiftMonth = (n) => { haptic.select(); const m = new Date(month); m.setMonth(m.getMonth() + n); setMonth(m); };

  const right = html`<${NavButton} icon="calendar-plus" label="Подписаться" onClick=${openSubscribe} />
    ${g.is_staff && html`<${NavButton} icon="plus" label="Новое событие" accent onClick=${() => openEventForm({ day: sel, onSaved: () => st.reload() })} />`}`;

  const upcoming = items.filter((e) => (e.ends_at || e.starts_at) >= new Date().toISOString());
  const groupedUpcoming = [];
  for (const e of upcoming) {
    const key = new Date(e.starts_at).toDateString();
    const last = groupedUpcoming[groupedUpcoming.length - 1];
    if (last?.key === key) last.items.push(e); else groupedUpcoming.push({ key, date: e.starts_at, items: [e] });
  }

  return html`<${Page} title="Календарь" dir=${dir} right=${right}>
    <${Segmented} value=${mode} onChange=${setMode} options=${[{ value: 'month', label: 'Месяц' }, { value: 'list', label: 'Ближайшие' }]} />
    ${mode === 'month' ? html`
      <div class="stack" style="gap:6px">
        <div class="cal-head">
          <h2>${monthYear(month).replace(' г.', '')}</h2>
          <div class="row-flex" style="gap:2px">
            <button class="nav-btn" onClick=${() => shiftMonth(-1)} aria-label="Предыдущий месяц"><${Icon} name="chevron-left" /></button>
            <button class="nav-btn" onClick=${() => shiftMonth(1)} aria-label="Следующий месяц"><${Icon} name="chevron-right" /></button>
          </div>
        </div>
        <div class="cal-grid">
          ${WD.map((w) => html`<div class="cal-wd">${w}</div>`)}
          ${days.map((d) => {
            const evs = onDay(d);
            const kinds = [...new Set(evs.map((e) => (e.type === 'task' ? 'task' : e.kind)))].slice(0, 3);
            return html`<button class=${`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${sameDay(d, new Date()) ? 'today' : ''} ${sameDay(d, sel) ? 'selected' : ''}`}
              onClick=${() => { haptic.select(); setSel(d); if (d.getMonth() !== month.getMonth()) { const m = new Date(d); m.setDate(1); setMonth(m); } }}>
              <span class="n">${d.getDate()}</span>
              <span class="cal-dots">${kinds.map((k) => html`<i class=${`kind-${k}`} style="background:var(--k)"></i>`)}</span>
            </button>`;
          })}
        </div>
      </div>
      <${Section} title=${dayLabel(sel.toISOString())}>
        ${st.loading && !st.data ? html`<${Skeleton} h=${72} />` : onDay(sel).length
          ? html`<div class="stack-sm">${onDay(sel).map((e) => html`<${EventRow} key=${e.type + e.id} e=${e} />`)}</div>`
          : html`<div class="card center muted small" style="padding:22px">Событий нет${g.is_staff ? html`<div style="margin-top:10px"><${Button} kind="tinted" sm icon="plus" onClick=${() => openEventForm({ day: sel, onSaved: () => st.reload() })}>Добавить</${Button}></div>` : ''}</div>`}
      </${Section}>
      <div class="chips" style="justify-content:center">
        ${[['meeting', 'Встречи'], ['stream', 'Эфиры'], ['deadline', 'Дедлайны'], ['task', 'Задания']].map(([k, t]) => html`<span class=${`chip sm kind-${k}`} style="background:transparent;color:var(--label-2)"><span class="kdot"></span>${t}</span>`)}
      </div>`
    : html`<${Async} state=${st}>${() => groupedUpcoming.length ? html`<div class="stack" style="gap:20px">
        ${groupedUpcoming.map((gr) => html`<div class="stack-sm">
          <div class="section-label" style="padding:0 4px">${dayLabel(gr.date)}</div>
          ${gr.items.map((e) => html`<${EventRow} key=${e.type + e.id} e=${e} />`)}
        </div>`)}
      </div>` : html`<${Empty} emoji="🗓" title="Пока пусто" text="Ближайших событий нет. Как только наставник что-то запланирует, оно появится здесь." />`}</${Async}>`}
  </${Page}>`;
}

// ---------- Страница события ----------
export function EventPage({ id, dir }) {
  const g = currentGroup();
  const st = useG(`/events/${id}`);
  const e = st.data;

  const staffMenu = () => actionSheet([
    { label: 'Изменить', onClick: () => openEventForm({ event: e, onSaved: (r) => st.setData((x) => ({ ...x, ...r })) }) },
    { label: e.cancelled ? 'Вернуть событие' : 'Отменить событие', danger: !e.cancelled, onClick: async () => {
      const r = await attempt(() => gapi(`/events/${e.id}/cancel`, { method: 'POST', body: { cancelled: !e.cancelled, toChat: g.chat_linked } }), e.cancelled ? 'Событие восстановлено' : 'Событие отменено, участники получат уведомление');
      if (r) st.reload();
    } },
    { label: 'Удалить', danger: true, onClick: async () => {
      if (await confirm('Удалить событие насовсем? Отметки посещения тоже удалятся.', { ok: 'Удалить', danger: true })) {
        if (await attempt(() => gapi(`/events/${e.id}`, { method: 'DELETE' }), 'Удалено')) back('/calendar');
      }
    } },
  ]);

  return html`<${Page} title=${e?.title || 'Событие'} back="/calendar" dir=${dir} large=${false}
    right=${g.is_staff && e ? html`<${NavButton} icon="ellipsis" label="Действия" onClick=${staffMenu} />` : null}>
    <${Async} state=${st}>${(e) => html`
      <div class=${`card hero kind-${e.kind}`} style=${e.kind === 'meeting' ? '' : 'background:linear-gradient(135deg, var(--k), color-mix(in srgb, var(--k) 60%, white))'}>
        <div class="stack" style="gap:10px;position:relative;z-index:1">
          <div class="row-flex"><span class="chip white sm">${KIND[e.kind].emoji} ${KIND[e.kind].title}</span>${e.cancelled ? html`<span class="chip sm" style="background:#fff;color:var(--red)">Отменено</span>` : null}</div>
          <h1 style="font-size:28px;font-weight:750;letter-spacing:-.03em;line-height:1.15">${e.title}</h1>
          <div style="font-size:17px;font-weight:600">${wdDayMonth(e.starts_at)}</div>
          <div class="muted" style="font-size:16px;margin-top:-6px">${time(e.starts_at)}${e.ends_at ? ` – ${time(e.ends_at)}` : ''}</div>
        </div>
      </div>

      ${e.can_checkin && html`<${Button} block icon="scan-line" onClick=${() => checkInFlow(e, () => st.reload())}>Я на встрече — отметиться</${Button}>`}
      ${e.checked_in && html`<div class="banner green"><div class="bi"><${Icon} name="check" /></div><div><div class="bold">Вы отмечены на встрече</div><div class="small muted">+10 баллов активности</div></div></div>`}
      ${e.can_feedback && !e.feedback_done && html`<button class="banner tap" onClick=${() => navigate(`/event/${e.id}/feedback`)}>
        <div class="bi"><${Icon} name="star" /></div><div class="row-main"><div class="bold">Как прошла встреча?</div><div class="small muted">Оцените анонимно — это поможет наставнику</div></div><${Icon} name="chevron-right" class="chev" /></button>`}
      ${e.can_feedback && e.feedback_done && html`<div class="banner green"><div class="bi"><${Icon} name="heart" /></div><div class="bold">Спасибо за отзыв!</div></div>`}

      <${List}>
        ${e.location && html`<${Row} icon="map-pin" color="red" title=${e.location} sub="Место" onClick=${/онлайн/i.test(e.location) ? null : () => openLink(`https://yandex.ru/maps/?text=${encodeURIComponent(e.location)}`)} />`}
        ${e.url && html`<${Row} icon="link" color="blue" title="Открыть ссылку" sub=${e.url} onClick=${() => openLink(e.url)} />`}
        <${Row} icon="calendar-plus" color="green" title="Добавить в календарь" onClick=${() => addToCalendar(e)} />
      </${List}>

      ${e.description && html`<${Section} title="Описание"><div class="card pre" style="font-size:16px;line-height:1.45">${e.description}</div></${Section}>`}

      ${g.is_staff && e.kind === 'meeting' && html`<${StaffEventBlock} e=${e} reload=${st.reload} />`}
    `}</${Async}>
  </${Page}>`;
}

function QrSheet({ close, eventId, title }) {
  const st = useG(`/events/${eventId}/qr`);
  return html`<${SheetLayout} title="Отметка на встрече" close=${close} cancelLabel="Закрыть">
    <${Async} state=${st}>${(q) => html`<div class="stack center" style="align-items:center">
      <div class="muted">${title}</div>
      <div class="qr-box" style="width:min(300px,80vw)" dangerouslySetInnerHTML=${{ __html: q.svg }}></div>
      <div class="muted small">Отсканируйте камерой телефона или введите код в приложении</div>
      <div style="font-size:48px;font-weight:800;letter-spacing:.25em;font-variant-numeric:tabular-nums">${q.code}</div>
    </div>`}</${Async}>
  </${SheetLayout}>`;
}

function StaffEventBlock({ e, reload }) {
  const toggle = async (u) => {
    haptic.select();
    await attempt(() => gapi(`/events/${e.id}/attendance`, { method: 'POST', body: { user_id: u.id, present: !u.present } }));
    reload();
  };
  const present = (e.attendance || []).filter((u) => u.present).length;
  return html`<${Section} title="Для команды">
    <div class="grid-2">
      <button class="card tap stack-sm" onClick=${() => openSheet(QrSheet, { eventId: e.id, title: e.title })}>
        <${Icon} name="qr-code" size=${26} style="color:var(--accent-ink)" />
        <div class="card-title">QR-код</div><div class="card-sub">Код: <b style="letter-spacing:.1em">${e.checkin_code}</b></div>
      </button>
      <button class="card tap stack-sm" onClick=${() => navigate(`/event/${e.id}/feedback-summary`)}>
        <${Icon} name="message-square" size=${26} style="color:var(--accent-ink)" />
        <div class="card-title">Отзывы</div><div class="card-sub">Анонимно</div>
      </button>
    </div>
    <div class="section-label" style="margin-top:8px">Посещаемость · ${present} из ${(e.attendance || []).length}</div>
    <${List}>
      ${(e.attendance || []).map((u) => html`<${Row} key=${u.id} avatar=${u} title=${u.name} chevron=${false}
        right=${html`<button class=${`check ${u.present ? 'on' : ''}`} onClick=${() => toggle(u)} aria-label="Отметить"><${Icon} name="check" /></button>`} />`)}
    </${List}>
  </${Section}>`;
}

// ---------- Анонимный отзыв ----------
const RATING_WORDS = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично!'];
export function FeedbackPage({ id, dir }) {
  const st = useG(`/events/${id}`);
  const [rating, setRating] = useState(0);
  const [liked, setLiked] = useState('');
  const [improve, setImprove] = useState('');
  const send = async () => {
    const r = await attempt(() => gapi(`/events/${id}/feedback`, { method: 'POST', body: { rating, liked, improve } }));
    if (r) { haptic.success(); toast('Спасибо! Отзыв отправлен анонимно'); back(`/event/${id}`); }
  };
  return html`<${Page} title="Отзыв о встрече" back=${`/event/${id}`} dir=${dir} large=${false}>
    <${Async} state=${st}>${(e) => e.feedback_done ? html`<${Empty} emoji="💛" title="Вы уже оставили отзыв" text="Спасибо! Он помогает делать встречи лучше." />` : html`
      <div class="stack center" style="align-items:center;gap:6px;padding-top:8px">
        <div style="font-size:15px" class="muted">${dayMonth(e.starts_at)}</div>
        <h1 style="font-size:24px;font-weight:750;letter-spacing:-.02em">${e.title}</h1>
      </div>
      <div class="card stack center" style="align-items:center">
        <div class="card-title">Как вам встреча?</div>
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => html`<button class=${n <= rating ? 'on' : ''} onClick=${() => { haptic.select(); setRating(n); }} aria-label=${`${n} из 5`}>⭐️</button>`)}</div>
        <div class="muted small" style="height:18px">${RATING_WORDS[rating]}</div>
      </div>
      <${Field} label="Что понравилось"><${AutoTextarea} value=${liked} onInput=${setLiked} placeholder="Необязательно" maxLength=${2000} /></${Field}>
      <${Field} label="Что можно улучшить"><${AutoTextarea} value=${improve} onInput=${setImprove} placeholder="Необязательно" maxLength=${2000} /></${Field}>
      <div class="banner blue"><div class="bi"><${Icon} name="eye-off" /></div><div class="small">Отзыв полностью анонимный: наставник увидит оценки и текст, но не узнает, кто их оставил. Баллы за отзывы не начисляются — тоже ради анонимности.</div></div>
      <${Button} block onClick=${send} disabled=${!rating}>Отправить анонимно</${Button}>
    `}</${Async}>
  </${Page}>`;
}

function Stars({ value, size = 18 }) {
  return html`<span style=${{ fontSize: size + 'px', letterSpacing: '1px' }}>${[1, 2, 3, 4, 5].map((n) => html`<span style=${{ opacity: n <= Math.round(value) ? 1 : 0.2 }}>⭐️</span>`)}</span>`;
}

export function FeedbackSummary({ id, dir }) {
  const st = useG(`/events/${id}/feedback`);
  return html`<${Page} title="Отзывы" back=${`/event/${id}`} dir=${dir}>
    <${Async} state=${st}>${(f) => html`
      <div class="muted" style="margin-top:-10px">${f.event.title} · ${dayMonth(f.event.starts_at)}</div>
      ${f.count ? html`
        <div class="card row-flex" style="gap:18px">
          <div class="stat"><div class="num" style="font-size:44px">${f.avg}</div><div class="lbl">${pl(f.count, ['отзыв', 'отзыва', 'отзывов'])}</div></div>
          <div class="stack-sm" style="flex:1">
            ${[5, 4, 3, 2, 1].map((n) => html`<div class="dist-row"><span style="width:12px">${n}</span><${Bar} value=${f.count ? (f.dist[n - 1] / f.count) * 100 : 0} /><span class="muted" style="width:18px;text-align:right">${f.dist[n - 1]}</span></div>`)}
          </div>
        </div>
        ${f.comments.length ? html`<${Section} title="Комментарии">
          ${f.comments.map((c) => html`<div class="card stack-sm">
            <${Stars} value=${c.rating} size=${14} />
            ${c.liked && html`<div><div class="small bold" style="color:#1f9e46">Понравилось</div><div class="pre">${c.liked}</div></div>`}
            ${c.improve && html`<div><div class="small bold" style="color:var(--accent-ink)">Улучшить</div><div class="pre">${c.improve}</div></div>`}
          </div>`)}
        </${Section}>` : null}
        <div class="hint center">Порядок комментариев случайный, время не показывается — чтобы сохранить анонимность.</div>
      ` : html`<${Empty} emoji="🕊" title="Отзывов пока нет" text="После встречи бот сам попросит участников её оценить." />`}
    `}</${Async}>
  </${Page}>`;
}

export function FeedbackOverview({ dir }) {
  const st = useG('/feedback');
  return html`<${Page} title="Обратная связь" back="/menu" dir=${dir} sub="Анонимные оценки встреч от участников">
    <${Async} state=${st}>${(d) => html`
      <div class="grid-2">
        <div class="card stat"><div class="num">${d.total.avg ?? '—'}</div><div class="lbl">Средняя оценка</div></div>
        <div class="card stat"><div class="num">${d.total.n}</div><div class="lbl">Всего отзывов</div></div>
      </div>
      ${d.events.length ? html`<${List}>${d.events.map((e) => html`<${Row} key=${e.id} title=${e.title}
        sub=${`${dayMonth(e.starts_at)} · пришли ${e.attendees} · ${pl(e.count, ['отзыв', 'отзыва', 'отзывов'])}`}
        value=${e.avg ? `★ ${e.avg}` : '—'} onClick=${() => navigate(`/event/${e.id}/feedback-summary`)} />`)}</${List}>`
        : html`<${Empty} emoji="🗓" title="Встреч ещё не было" />`}
    `}</${Async}>
  </${Page}>`;
}

