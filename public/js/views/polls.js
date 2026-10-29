// Опросы и голосования: выбрать время или тему встречи
import { html, useState, useEffect, useG, gapi, currentGroup, wdDayMonth, relative, pl, toLocalInput, fromLocalInput } from '../lib.js';
import { Page, Icon, List, Row, Segmented, Toggle, Field, Empty, Async, AvatarStack, NavButton, openSheet, SheetLayout, actionSheet, confirm, attempt } from '../ui.js';
import { navigate, back, query } from '../router.js';
import { haptic } from '../tg.js';
import { openEventForm } from './calendar.js';

const TEMPLATES = {
  time: { question: 'Когда удобно встретиться?', options: ['', ''] },
  topic: { question: 'Какую тему разберём на встрече?', options: ['', '', ''] },
  free: { question: '', options: ['', ''] },
};

function PollForm({ close, onSaved }) {
  const g = currentGroup();
  const [tpl, setTpl] = useState('time');
  const [question, setQuestion] = useState(TEMPLATES.time.question);
  const [options, setOptions] = useState(TEMPLATES.time.options);
  const [multi, setMulti] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  const [closes, setCloses] = useState('');
  const [toChat, setToChat] = useState(g.chat_linked);
  const pick = (t) => { setTpl(t); setQuestion(TEMPLATES[t].question); setOptions(TEMPLATES[t].options); setMulti(t === 'time'); };
  const save = async () => {
    const r = await attempt(() => gapi('/polls', { method: 'POST', body: { question, options: options.filter((o) => o.trim()), multi, anonymous, closes_at: fromLocalInput(closes), toChat } }), 'Опрос создан');
    if (r) { onSaved?.(r); close(r); }
  };
  const filled = options.filter((o) => o.trim()).length;
  return html`<${SheetLayout} title="Новый опрос" close=${close} done=${save} doneLabel="Создать" doneDisabled=${!question.trim() || filled < 2}>
    <div class="form">
      <${Segmented} value=${tpl} onChange=${pick} options=${[{ value: 'time', label: 'Время' }, { value: 'topic', label: 'Тема' }, { value: 'free', label: 'Свой' }]} />
      <${Field} label="Вопрос"><input class="input" value=${question} onInput=${(e) => setQuestion(e.target.value)} placeholder="Вопрос" maxLength="300" /></${Field}>
      <${Field} label="Варианты" hint=${tpl === 'time' ? 'Например: «Суббота, 12:00» или «Вс 2 ноября, 15:00»' : null}>
        <div class="stack-sm">${options.map((o, i) => html`<input class="input" value=${o} placeholder=${`Вариант ${i + 1}`} maxLength="100"
          onInput=${(e) => setOptions((x) => { const n = [...x]; n[i] = e.target.value; if (i === n.length - 1 && e.target.value && n.length < 10) n.push(''); return n; })} />`)}</div>
      </${Field}>
      <${List}>
        <${Row} title="Несколько вариантов" right=${html`<${Toggle} checked=${multi} onChange=${setMulti} />`} chevron=${false} />
        <${Row} title="Анонимное голосование" sub="Не показывать, кто за что голосовал" right=${html`<${Toggle} checked=${anonymous} onChange=${setAnonymous} />`} chevron=${false} />
        ${g.chat_linked && html`<${Row} title="Опубликовать в чате" sub="Голосовать можно прямо кнопками в чате" right=${html`<${Toggle} checked=${toChat} onChange=${setToChat} />`} chevron=${false} />`}
      </${List}>
      <${Field} label="Завершить автоматически" hint="Необязательно"><input class="input" type="datetime-local" value=${closes} min=${toLocalInput(new Date().toISOString())} onInput=${(e) => setCloses(e.target.value)} /></${Field}>
    </div>
  </${SheetLayout}>`;
}
export const openPollForm = (props) => openSheet(PollForm, props);

export function PollView({ p, onChange, compact }) {
  // при выборе нескольких вариантов процент считается от числа проголосовавших
  const total = p.multi ? p.voters : p.counts.reduce((a, b) => a + b, 0);
  const voted = p.my.length > 0;
  const showResults = voted || p.closed;
  const max = Math.max(...p.counts);
  const vote = async (i) => {
    if (p.closed) return;
    haptic.select();
    let next;
    if (p.multi) next = p.my.includes(i) ? p.my.filter((x) => x !== i) : [...p.my, i];
    else next = p.my.includes(i) ? [] : [i];
    const r = await attempt(() => next.length
      ? gapi(`/polls/${p.id}/vote`, { method: 'POST', body: { options: next } })
      : gapi(`/polls/${p.id}/vote`, { method: 'DELETE' }));
    if (r) onChange(r);
  };
  return html`<div class="stack-sm">
    ${p.options.map((o, i) => {
      const pct = total ? Math.round((p.counts[i] / total) * 100) : 0;
      const mine = p.my.includes(i);
      return html`<button key=${i} class=${`poll-opt ${mine ? 'mine' : ''}`} onClick=${() => vote(i)} disabled=${p.closed}>
        ${showResults && html`<span class="fillbar" style=${{ width: pct + '%' }}></span>`}
        <span class=${`check accent ${mine ? 'on' : ''}`} style=${p.multi ? 'border-radius:8px' : ''}><${Icon} name="check" /></span>
        <span class="row-main" style=${{ fontWeight: p.closed && p.counts[i] === max && max > 0 ? 700 : 500 }}>${o}</span>
        ${showResults && html`<span class="pct">${pct}%</span>`}
      </button>
      ${!compact && showResults && p.by_option?.[i]?.length > 0 && html`<div class="row-flex" style="padding:0 6px 4px;gap:6px"><${AvatarStack} users=${p.by_option[i]} size=${22} max=${6} /><span class="tiny muted">${p.by_option[i].map((u) => u.first_name).slice(0, 3).join(', ')}${p.by_option[i].length > 3 ? ` и ещё ${p.by_option[i].length - 3}` : ''}</span></div>`}`;
    })}
    <div class="tiny muted" style="padding:2px 4px">${pl(p.voters, ['голос', 'голоса', 'голосов'])}${p.multi ? ' · можно несколько' : ''}${p.anonymous ? ' · анонимно' : ''}${p.closed ? ' · завершён' : p.closes_at ? ` · до ${wdDayMonth(p.closes_at)}` : ''}</div>
  </div>`;
}

export function PollsPage({ dir }) {
  const st = useG('/polls');
  const [tab, setTab] = useState('open');
  const create = () => openPollForm({ onSaved: () => st.reload() });
  useEffect(() => { if (query().new) { history.replaceState(history.state, '', '/polls'); create(); } }, []);
  return html`<${Page} title="Опросы" back="/menu" dir=${dir} right=${html`<${NavButton} icon="plus" label="Новый опрос" accent onClick=${create} />`}>
    <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'open', label: 'Активные' }, { value: 'closed', label: 'Завершённые' }]} />
    <${Async} state=${st}>${(d) => {
      const list = d.polls.filter((p) => (tab === 'closed') === p.closed);
      if (!list.length) return html`<${Empty} emoji="🗳" title=${tab === 'open' ? 'Активных опросов нет' : 'Пока пусто'} text="Быстро выберите время встречи или тему — создайте опрос, и бот позовёт всех проголосовать." action=${tab === 'open' ? 'Создать опрос' : null} onAction=${create} />`;
      return html`<div class="stack">${list.map((p) => html`<div key=${p.id} class="card stack">
        <button class="row-flex tap" style="text-align:left;align-items:flex-start" onClick=${() => navigate(`/poll/${p.id}`)}>
          <div class="row-main card-title">${p.question}</div><${Icon} name="chevron-right" class="chev" style="margin-top:2px" />
        </button>
        <${PollView} p=${p} compact onChange=${(r) => st.setData((x) => ({ ...x, polls: x.polls.map((y) => (y.id === r.id ? r : y)) }))} />
      </div>`)}</div>`;
    }}</${Async}>
  </${Page}>`;
}

export function PollPage({ id, dir }) {
  const g = currentGroup();
  const st = useG(`/polls/${id}`);
  const p = st.data;
  const menu = () => actionSheet([
    !p.closed && { label: 'Завершить опрос', onClick: async () => { const r = await attempt(() => gapi(`/polls/${id}/close`, { method: 'POST' }), 'Опрос завершён'); if (r) st.setData(r); } },
    g.is_staff && { label: 'Создать встречу по итогам', onClick: () => openEventForm({ event: null }) },
    { label: 'Удалить', danger: true, onClick: async () => { if (await confirm('Удалить опрос?', { ok: 'Удалить', danger: true }) && await attempt(() => gapi(`/polls/${id}`, { method: 'DELETE' }), 'Удалено')) back('/polls'); } },
  ]);
  return html`<${Page} title="Опрос" back="/polls" dir=${dir} large=${false}
    right=${p && (g.is_staff || p.mine) ? html`<${NavButton} icon="ellipsis" label="Действия" onClick=${menu} />` : null}>
    <${Async} state=${st}>${(p) => html`
      <div class="stack-sm">
        <h1 style="font-size:26px;font-weight:750;letter-spacing:-.025em;line-height:1.2">${p.question}</h1>
        <div class="small muted">${p.author ? `${p.author.name} · ` : ''}${relative(p.created_at)}${p.in_chat ? ' · опубликован в чате' : ''}</div>
      </div>
      <${PollView} p=${p} onChange=${st.setData} />
      ${!p.my.length && !p.closed && html`<div class="hint center">Нажмите на вариант, чтобы проголосовать. Голос можно изменить.</div>`}
    `}</${Async}>
  </${Page}>`;
}

