// Анонимные вопросы наставнику и любому участнику
import { html, useState, useEffect, useG, gapi, dayMonth } from '../lib.js';
import { Page, Icon, List, Row, Segmented, AutoTextarea, Empty, Async, Avatar, NavButton, openSheet, SheetLayout, actionSheet, confirm, attempt } from '../ui.js';
import { query } from '../router.js';

function AskSheet({ close, to }) {
  const st = useG('/questions/recipients');
  const [who, setWho] = useState(to || null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const send = async () => {
    const r = await attempt(() => gapi('/questions', { method: 'POST', body: { to: who.id, text } }), 'Вопрос отправлен анонимно');
    if (r) close(true);
  };
  return html`<${SheetLayout} title="Анонимный вопрос" close=${close} done=${who && send} doneLabel="Отправить" doneDisabled=${!who || !text.trim()}>
    ${who ? html`<div class="form">
        <div class="row-flex" style="gap:12px"><${Avatar} user=${who} size=${48} />
          <div class="row-main"><div class="card-title">${who.name}</div>${!to && html`<button class="small" style="color:var(--accent-ink)" onClick=${() => setWho(null)}>Выбрать другого</button>`}</div></div>
        <${AutoTextarea} value=${text} onInput=${setText} placeholder="Ваш вопрос" rows=${5} maxLength=${2000} autofocus />
        <div class="banner blue"><div class="bi"><${Icon} name="eye-off" /></div><div class="small">Получатель не узнает, кто спросил. Ответ придёт вам в бота и появится во вкладке «Мои вопросы».</div></div>
      </div>`
      : html`<div class="stack">
        <div class="search"><${Icon} name="search" /><input class="input" placeholder="Кому" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <${Async} state=${st}>${(d) => html`<${List}>${d.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => html`<${Row} key=${p.id} avatar=${p} title=${p.name} sub=${p.role_title} onClick=${() => setWho(p)} />`)}</${List}>`}</${Async}>
      </div>`}
  </${SheetLayout}>`;
}
export const openAskSheet = (props = {}) => openSheet(AskSheet, props);

function AnswerSheet({ close, q }) {
  const [text, setText] = useState('');
  const send = async () => {
    const r = await attempt(() => gapi(`/questions/${q.id}/answer`, { method: 'POST', body: { text } }), 'Ответ отправлен');
    if (r) close(true);
  };
  return html`<${SheetLayout} title="Ответ" close=${close} done=${send} doneLabel="Отправить" doneDisabled=${!text.trim()}>
    <div class="form">
      <div class="card pre" style="font-size:16px">${q.text}</div>
      <${AutoTextarea} value=${text} onInput=${setText} placeholder="Ваш ответ" rows=${5} maxLength=${3000} autofocus />
      <div class="hint">Автор увидит ваше имя и ответ. Его имени не видит никто.</div>
    </div>
  </${SheetLayout}>`;
}

export function QuestionsPage({ tab: tabParam, dir }) {
  const [tab, setTab] = useState(tabParam === 'sent' ? 'sent' : 'inbox');
  const inbox = useG('/questions/inbox');
  const sent = useG('/questions/sent');
  const ask = () => openAskSheet().then((ok) => { if (ok) { sent.reload(); setTab('sent'); } });
  useEffect(() => { if (query().ask) { history.replaceState(history.state, '', '/questions'); ask(); } }, []);

  const menu = (q) => actionSheet([
    { label: 'Скрыть вопрос', onClick: async () => { await attempt(() => gapi(`/questions/${q.id}/hide`, { method: 'POST' })); inbox.reload(); } },
    inbox.data?.can_block && { label: 'Заблокировать автора', danger: true, onClick: async () => {
      if (await confirm('Автор больше не сможет отправлять анонимные вопросы в этой группе. Его имя останется скрытым.', { ok: 'Заблокировать', danger: true })) {
        await attempt(() => gapi(`/questions/${q.id}/block`, { method: 'POST' }), 'Автор заблокирован');
        inbox.reload();
      }
    } },
  ]);

  return html`<${Page} title="Вопросы" back="/menu" dir=${dir} sub="Анонимно — наставнику или любому участнику"
    right=${html`<${NavButton} icon="plus" label="Задать вопрос" accent onClick=${ask} />`}>
    <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'inbox', label: `Мне${inbox.data?.questions.filter((q) => !q.answer).length ? ` · ${inbox.data.questions.filter((q) => !q.answer).length}` : ''}` }, { value: 'sent', label: 'Мои вопросы' }]} />
    ${tab === 'inbox' ? html`<${Async} state=${inbox}>${(d) => d.questions.length ? html`<div class="stack-sm">${d.questions.map((q) => html`<div key=${q.id} class="card stack-sm">
        <div class="row-flex"><span class="chip sm purple"><${Icon} name="eye-off" />Аноним</span><span class="tiny muted">${dayMonth(q.created_day)}</span><span class="spacer"></span>
          <button class="nav-btn round" style="width:30px;height:30px;min-width:30px" onClick=${() => menu(q)} aria-label="Действия"><${Icon} name="ellipsis" size=${18} /></button></div>
        <div class="pre" style="font-size:16px;line-height:1.45">${q.text}</div>
        ${q.answer ? html`<div class="card" style="background:#fff;padding:12px"><div class="small bold" style="margin-bottom:2px">Ваш ответ</div><div class="pre small">${q.answer}</div></div>`
          : html`<button class="btn tinted sm" style="align-self:flex-start" onClick=${() => openSheet(AnswerSheet, { q }).then((ok) => ok && inbox.reload())}><${Icon} name="reply" />Ответить</button>`}
      </div>`)}</div>` : html`<${Empty} emoji="📭" title="Вопросов пока нет" text="Когда вам зададут анонимный вопрос, он появится здесь и придёт в бота." />`}</${Async}>`
    : html`<${Async} state=${sent}>${(d) => d.questions.length ? html`<div class="stack-sm">${d.questions.map((q) => html`<div key=${q.id} class="card stack-sm">
        <div class="row-flex"><${Avatar} user=${q.to} size=${24} /><span class="small">для <b>${q.to.name}</b></span><span class="spacer"></span><span class="tiny muted">${dayMonth(q.created_day)}</span></div>
        <div class="pre" style="font-size:16px">${q.text}</div>
        ${q.answer ? html`<div class="card" style="background:#fff;padding:12px"><div class="small bold" style="color:var(--accent-ink);margin-bottom:2px">Ответ</div><div class="pre">${q.answer}</div></div>`
          : html`<span class="chip sm" style="align-self:flex-start">Ждёт ответа</span>`}
      </div>`)}</div>` : html`<${Empty} emoji="🕶" title="Спросите что угодно" text="Вопрос уйдёт анонимно: ни получатель, ни наставник не узнают, кто спросил." action="Задать вопрос" onAction=${ask} />`}</${Async}>`}
    <div class="hint center">Вопросы можно задавать и в боте: команда /ask</div>
  </${Page}>`;
}

